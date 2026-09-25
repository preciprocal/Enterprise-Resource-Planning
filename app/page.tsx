"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { getSupabaseBrowser, setAdminToken } from "@/lib/supabase/client";
import AdminDashboard from "@/components/AdminDashboard";
import Image from "next/image";

// ─── Types ────────────────────────────────────────────────────────────────────

type AuthState = "checking" | "authed" | "unauthed";
interface AdminMe { uid: string; name: string; email: string }

// ─── Root ─────────────────────────────────────────────────────────────────────

export default function Home() {
  const [authState, setAuthState] = useState<AuthState>("checking");
  const [token,     setToken]     = useState("");
  const [me,        setMe]        = useState<AdminMe | null>(null);
  const [denied,    setDenied]    = useState("");
  const verifiedFor = useRef<string | null>(null);   // user id already verified this session

  // Verify an access token server-side — checks the Supabase session + profiles.is_admin
  // isLogin: a real sign-in (not a page load with a stored session) — only those get logged
  const verify = useCallback(async (accessToken: string, isLogin = false): Promise<AdminMe | null> => {
    try {
      const res  = await fetch(`/api/admin?action=verify${isLogin ? "&login=1" : ""}`, { headers: { "x-admin-token": accessToken } });
      const json = await res.json() as { ok?: boolean; uid?: string; name?: string; email?: string };
      return res.ok && json.ok === true ? { uid: json.uid ?? "", name: json.name ?? "", email: json.email ?? "" } : null;
    } catch {
      return null;
    }
  }, []);

  // Session is persisted by supabase-js; this fires on load (INITIAL_SESSION),
  // on sign-in (incl. the Google OAuth redirect back), and on every token refresh.
  useEffect(() => {
    const sb = getSupabaseBrowser();
    const { data: { subscription } } = sb.auth.onAuthStateChange((event, session) => {
      if (!session) {
        verifiedFor.current = null;
        setAdminToken(""); setToken(""); setMe(null);
        setAuthState("unauthed");
        return;
      }
      // Token refresh for an already-verified admin: just swap the token.
      if (verifiedFor.current === session.user.id) {
        setAdminToken(session.access_token); setToken(session.access_token);
        return;
      }
      // Defer out of the auth callback — supabase-js warns against awaiting in it.
      setTimeout(async () => {
        const who = await verify(session.access_token, event === "SIGNED_IN");
        if (who) {
          verifiedFor.current = session.user.id;
          setAdminToken(session.access_token); setToken(session.access_token); setMe(who);
          setAuthState("authed");
        } else {
          // Signed in but not an admin
          await sb.auth.signOut().catch(() => { /* ignore */ });
          if (event === "SIGNED_IN") setDenied("Access denied — this email isn't on the ERP access list.");
        }
      }, 0);
    });
    return () => subscription.unsubscribe();
  }, [verify]);

  const handleLogout = useCallback(async () => {
    await getSupabaseBrowser().auth.signOut().catch(() => { /* ignore */ });
  }, []);

  if (authState === "checking") return <Spinner />;
  if (authState === "unauthed") return <LoginGate deniedMsg={denied} />;

  return <AdminDashboard token={token} me={me} onLogout={handleLogout} />;
}

// ─── Spinner ──────────────────────────────────────────────────────────────────

function Spinner() {
  return (
    <div className="min-h-screen bg-black flex items-center justify-center">
      <div className="w-6 h-6 rounded-full border-2 border-[#1a1a1a] border-t-[#ededed] animate-spin" />
    </div>
  );
}

// ─── LoginGate ─────────────────────────────────────────────────────────────────

function LoginGate({ deniedMsg }: { deniedMsg?: string }) {
  const [email,         setEmail]         = useState("");
  const [password,      setPassword]      = useState("");
  const [loading,       setLoading]       = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [error,         setError]         = useState(deniedMsg ?? "");
  const [showPw,        setShowPw]        = useState(false);

  useEffect(() => { if (deniedMsg) setError(deniedMsg); }, [deniedMsg]);

  const clear = () => setError("");

  // On success, onAuthStateChange in <Home> verifies admin status and swaps views.
  async function signInEmail(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim() || !password.trim()) return;
    setLoading(true); clear();
    try {
      const { error: err } = await getSupabaseBrowser().auth.signInWithPassword({ email: email.trim(), password });
      if (err) {
        const msg = err.message.toLowerCase();
        if (msg.includes("invalid login") || msg.includes("invalid credentials"))
          // Accounts migrated from Firebase keep their old password hash until
          // the first sign-in on the main app, which re-hashes it into Supabase.
          setError("Incorrect email or password. If your account was migrated from Firebase, sign in to the main app once first, or use Google.");
        else if (err.status === 429 || msg.includes("rate limit"))
          setError("Too many attempts — please wait and try again.");
        else if (msg.includes("email not confirmed"))
          setError("Confirm your email address before signing in.");
        else
          setError(err.message || "Sign-in failed. Please try again.");
        setPassword("");
      }
    } catch {
      setError("Sign-in failed. Please try again.");
      setPassword("");
    } finally { setLoading(false); }
  }

  // Full-page redirect to Google and back; the session is picked up from the URL.
  async function signInGoogle() {
    setGoogleLoading(true); clear();
    const { error: err } = await getSupabaseBrowser().auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: window.location.origin, queryParams: { prompt: "select_account" } },
    });
    if (err) { setError("Google sign-in failed. Please try again."); setGoogleLoading(false); }
  }

  const busy = loading || googleLoading;

  return (
    <div className="min-h-screen bg-black flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-[360px]">

        {/* Logo */}
        <div className="flex flex-col items-center mb-8">
          <Image src="/logo.png" alt="Preciprocal" className="w-10 h-10 object-contain mb-3" width={40} height={40} />
          <div className="text-[18px] font-bold text-[#ededed] tracking-tight">Preciprocal</div>
          <div className="text-[11px] font-medium text-[#555] uppercase tracking-[0.14em] mt-0.5">Enterprise Resource Planning</div>
        </div>

        {/* Card */}
        <div className="bg-[#0a0a0a] border border-[#1a1a1a] rounded-xl p-6">
          <div className="mb-5">
            <h1 className="text-[17px] font-bold text-[#ededed] tracking-tight">Sign in</h1>
            <p className="text-[13px] text-[#555] mt-1">Restricted to authorised admins only.</p>
          </div>

          {/* Google */}
          <button onClick={signInGoogle} disabled={busy}
            className="w-full flex items-center justify-center gap-2.5 px-4 py-2.5 rounded-lg border border-[#2a2a2a] bg-[#111] hover:bg-[#1a1a1a] text-[14px] font-semibold text-[#ededed] cursor-pointer disabled:opacity-40 transition-colors mb-4">
            {googleLoading
              ? <div className="w-4 h-4 rounded-full border-2 border-[#555] border-t-[#ededed] animate-spin" />
              : <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
                  <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                  <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                  <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/>
                  <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                </svg>
            }
            {googleLoading ? "Connecting…" : "Continue with Google"}
          </button>

          <div className="flex items-center gap-3 mb-4">
            <div className="flex-1 h-px bg-[#1a1a1a]" />
            <span className="text-[11px] text-[#333] font-semibold uppercase tracking-wider">or</span>
            <div className="flex-1 h-px bg-[#1a1a1a]" />
          </div>

          <form onSubmit={signInEmail} className="flex flex-col gap-3">
            <div>
              <label htmlFor="adm-email" className="block text-[11px] font-bold text-[#555] uppercase tracking-widest mb-1.5">Email</label>
              <input id="adm-email" type="email" value={email} autoFocus autoComplete="email"
                onChange={e => { setEmail(e.target.value); clear(); }}
                placeholder="admin@preciprocal.com"
                className="w-full bg-[#111] border border-[#2a2a2a] rounded-lg px-3.5 py-2.5 text-[14px] text-[#ededed] outline-none focus:border-[#555] transition-colors placeholder:text-[#333] font-[inherit]" />
            </div>

            <div>
              <label htmlFor="adm-pw" className="block text-[11px] font-bold text-[#555] uppercase tracking-widest mb-1.5">Password</label>
              <div className="relative">
                <input id="adm-pw" type={showPw ? "text" : "password"} value={password}
                  onChange={e => { setPassword(e.target.value); clear(); }}
                  placeholder="••••••••••••" autoComplete="current-password"
                  className="w-full bg-[#111] border border-[#2a2a2a] rounded-lg px-3.5 py-2.5 pr-10 text-[14px] text-[#ededed] outline-none focus:border-[#555] transition-colors placeholder:text-[#333] font-[inherit]" />
                <button type="button" onClick={() => setShowPw(v => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-[#555] hover:text-[#888] border-none bg-transparent cursor-pointer p-0 transition-colors">
                  {showPw
                    ? <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
                    : <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                  }
                </button>
              </div>
            </div>

            {error && (
              <div className="flex items-start gap-2 px-3 py-2.5 bg-[rgba(255,68,68,0.06)] border border-[rgba(255,68,68,0.2)] rounded-lg">
                <svg width="13" height="13" fill="none" stroke="#f44" strokeWidth="2" viewBox="0 0 24 24" className="shrink-0 mt-0.5">
                  <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
                </svg>
                <span className="text-[12px] text-[#f44] font-medium leading-relaxed">{error}</span>
              </div>
            )}

            <button type="submit" disabled={busy || !email.trim() || !password.trim()}
              className="w-full py-2.5 rounded-lg text-[14px] font-bold bg-[#ededed] text-black border-none cursor-pointer hover:bg-white disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2 transition-colors mt-1">
              {loading
                ? <><div className="w-4 h-4 rounded-full border-2 border-black/20 border-t-black animate-spin" />Signing in…</>
                : <>
                    <svg width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                      <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/>
                      <polyline points="10 17 15 12 10 7"/><line x1="15" y1="12" x2="3" y2="12"/>
                    </svg>
                    Sign in
                  </>
              }
            </button>
          </form>
        </div>

        <p className="text-center text-[11px] text-[#333] mt-5">Preciprocal ERP · Internal use only</p>
      </div>
    </div>
  );
}