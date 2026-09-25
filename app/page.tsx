"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { getSupabaseBrowser, setAdminToken } from "@/lib/supabase/client";
import AdminDashboard from "@/components/AdminDashboard";
import Image from "next/image";

// ─── Types ────────────────────────────────────────────────────────────────────

// "recovery": arrived from a password-reset email; must set a new password first
type AuthState = "checking" | "authed" | "unauthed" | "recovery";
interface AdminMe { uid: string; name: string; email: string }

// ─── Root ─────────────────────────────────────────────────────────────────────

export default function Home() {
  const [authState, setAuthState] = useState<AuthState>("checking");
  const [token,     setToken]     = useState("");
  const [me,        setMe]        = useState<AdminMe | null>(null);
  const [denied,    setDenied]    = useState("");
  const verifiedFor = useRef<string | null>(null);   // user id already verified this session
  const recovering  = useRef(false);                  // reset link in progress — don't open the app yet

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
  // on sign-in, and on every token refresh.
  useEffect(() => {
    // Password-reset link from /api/auth/reset: /?reset_token=<hashed token>
    const params     = new URLSearchParams(window.location.search);
    const resetToken = params.get("reset_token");
    if (resetToken) {
      recovering.current = true;
      params.delete("reset_token");   // one-time token — keep it out of history/bookmarks
      const rest = params.toString();
      window.history.replaceState({}, "", window.location.pathname + (rest ? `?${rest}` : ""));
    }

    const sb = getSupabaseBrowser();
    const { data: { subscription } } = sb.auth.onAuthStateChange((event, session) => {
      if (recovering.current) {
        // Hold on the spinner until the reset token is exchanged, then ask for a new password.
        if (session && event !== "INITIAL_SESSION") setAuthState("recovery");
        return;
      }
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

    if (resetToken) {
      // Signs the user in with a recovery session (fires SIGNED_IN above → "recovery").
      void sb.auth.verifyOtp({ type: "recovery", token_hash: resetToken }).then(async ({ error }) => {
        if (!error) return;
        recovering.current = false;
        await sb.auth.signOut().catch(() => { /* ignore */ });
        setDenied("This reset link is invalid or has expired. Use “Forgot password?” to get a new one.");
        setAuthState("unauthed");
      });
    }
    return () => subscription.unsubscribe();
  }, [verify]);

  const handleLogout = useCallback(async () => {
    await getSupabaseBrowser().auth.signOut().catch(() => { /* ignore */ });
  }, []);

  // New password saved: continue exactly like a normal sign-in (access list check).
  const finishRecovery = useCallback(async () => {
    const sb = getSupabaseBrowser();
    recovering.current = false;
    const { data: { session } } = await sb.auth.getSession();
    const who = session ? await verify(session.access_token, true) : null;
    if (session && who) {
      verifiedFor.current = session.user.id;
      setAdminToken(session.access_token); setToken(session.access_token); setMe(who);
      setAuthState("authed");
    } else {
      await sb.auth.signOut().catch(() => { /* ignore */ });
      setDenied("Password updated, but this email isn't on the ERP access list.");
      setAuthState("unauthed");
    }
  }, [verify]);

  if (authState === "checking") return <Spinner />;
  if (authState === "recovery") return (
    <SetPasswordGate onDone={finishRecovery} onCancel={() => { recovering.current = false; void handleLogout(); }} />
  );
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

// Shared by the sign-in, forgot-password and set-new-password screens.
const inputCls = "w-full bg-[#111] border border-[#2a2a2a] rounded-lg px-3.5 py-2.5 text-[14px] text-[#ededed] outline-none focus:border-[#555] transition-colors placeholder:text-[#333] font-[inherit]";
const labelCls = "block text-[11px] font-bold text-[#555] uppercase tracking-widest mb-1.5";
const primaryBtnCls = "w-full py-2.5 rounded-lg text-[14px] font-bold bg-[#ededed] text-black border-none cursor-pointer hover:bg-white disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2 transition-colors mt-1";

function AuthShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-black flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-[360px]">
        <div className="flex flex-col items-center mb-8">
          <Image src="/logo.png" alt="Preciprocal" className="w-10 h-10 object-contain mb-3" width={40} height={40} />
          <div className="text-[18px] font-bold text-[#ededed] tracking-tight">Preciprocal</div>
          <div className="text-[11px] font-medium text-[#555] uppercase tracking-[0.14em] mt-0.5">Enterprise Resource Planning</div>
        </div>
        <div className="bg-[#0a0a0a] border border-[#1a1a1a] rounded-xl p-6">{children}</div>
        <p className="text-center text-[11px] text-[#333] mt-5">Preciprocal ERP · Internal use only</p>
      </div>
    </div>
  );
}

function Notice({ tone, children }: { tone: "error" | "ok"; children: React.ReactNode }) {
  const err = tone === "error";
  return (
    <div className={`flex items-start gap-2 px-3 py-2.5 rounded-lg border ${err
      ? "bg-[rgba(255,68,68,0.06)] border-[rgba(255,68,68,0.2)]"
      : "bg-[rgba(62,207,142,0.06)] border-[rgba(62,207,142,0.2)]"}`}>
      <svg width="13" height="13" fill="none" stroke={err ? "#f44" : "#3ecf8e"} strokeWidth="2" viewBox="0 0 24 24" className="shrink-0 mt-0.5">
        {err
          ? <><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></>
          : <><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></>}
      </svg>
      <span className={`text-[12px] font-medium leading-relaxed ${err ? "text-[#f44]" : "text-[#3ecf8e]"}`}>{children}</span>
    </div>
  );
}

function EyeToggle({ shown, onToggle }: { shown: boolean; onToggle: () => void }) {
  return (
    <button type="button" onClick={onToggle} aria-label={shown ? "Hide password" : "Show password"}
      className="absolute right-3 top-1/2 -translate-y-1/2 text-[#555] hover:text-[#888] border-none bg-transparent cursor-pointer p-0 transition-colors">
      {shown
        ? <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
        : <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>}
    </button>
  );
}

function LoginGate({ deniedMsg }: { deniedMsg?: string }) {
  const [mode,          setMode]          = useState<"signin" | "forgot">("signin");
  const [email,         setEmail]         = useState("");
  const [password,      setPassword]      = useState("");
  const [loading,       setLoading]       = useState(false);
  const [error,         setError]         = useState(deniedMsg ?? "");
  const [sentMsg,       setSentMsg]       = useState("");
  const [showPw,        setShowPw]        = useState(false);

  useEffect(() => { if (deniedMsg) setError(deniedMsg); }, [deniedMsg]);

  const clear = () => setError("");

  async function sendReset(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;
    setLoading(true); clear(); setSentMsg("");
    try {
      const res  = await fetch("/api/auth/reset", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim() }),
      });
      const json = await res.json() as { message?: string; error?: string };
      if (!res.ok) setError(json.error ?? "Couldn't send the reset email. Please try again.");
      else setSentMsg(`${json.message ?? "If this email has ERP access, a reset link is on its way."} Check your inbox (and spam).`);
    } catch {
      setError("Couldn't send the reset email. Please try again.");
    } finally { setLoading(false); }
  }

  if (mode === "forgot") return (
    <AuthShell>
      <div className="mb-5">
        <h1 className="text-[17px] font-bold text-[#ededed] tracking-tight">Reset password</h1>
        <p className="text-[13px] text-[#555] mt-1 leading-relaxed">We&apos;ll email you a link to set a new password. It&apos;s the same password as your Preciprocal app account.</p>
      </div>
      <form onSubmit={sendReset} className="flex flex-col gap-3">
        <div>
          <label htmlFor="adm-reset-email" className={labelCls}>Email</label>
          <input id="adm-reset-email" type="email" value={email} autoFocus autoComplete="email"
            onChange={e => { setEmail(e.target.value); clear(); setSentMsg(""); }}
            placeholder="admin@preciprocal.com" className={inputCls} />
        </div>
        {error && <Notice tone="error">{error}</Notice>}
        {sentMsg && <Notice tone="ok">{sentMsg}</Notice>}
        <button type="submit" disabled={loading || !email.trim()} className={primaryBtnCls}>
          {loading
            ? <><div className="w-4 h-4 rounded-full border-2 border-black/20 border-t-black animate-spin" />Sending…</>
            : sentMsg ? "Send again" : "Send reset link"}
        </button>
      </form>
      <button type="button" onClick={() => { setMode("signin"); clear(); setSentMsg(""); }}
        className="mt-4 w-full text-center text-[12px] text-[#666] hover:text-[#ededed] bg-transparent border-none cursor-pointer transition-colors">
        ← Back to sign in
      </button>
    </AuthShell>
  );

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
          setError("Incorrect email or password. Use “Forgot password?” to set a new one.");
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

  const busy = loading;

  return (
    <AuthShell>
          <div className="mb-5">
            <h1 className="text-[17px] font-bold text-[#ededed] tracking-tight">Sign in</h1>
            <p className="text-[13px] text-[#555] mt-1">Restricted to authorised admins only.</p>
          </div>

          <form onSubmit={signInEmail} className="flex flex-col gap-3">
            <div>
              <label htmlFor="adm-email" className={labelCls}>Email</label>
              <input id="adm-email" type="email" value={email} autoFocus autoComplete="email"
                onChange={e => { setEmail(e.target.value); clear(); }}
                placeholder="admin@preciprocal.com" className={inputCls} />
            </div>

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label htmlFor="adm-pw" className={labelCls.replace(" mb-1.5", "")}>Password</label>
                <button type="button" onClick={() => { setMode("forgot"); clear(); }}
                  className="text-[12px] text-[#666] hover:text-[#ededed] bg-transparent border-none p-0 cursor-pointer transition-colors">
                  Forgot password?
                </button>
              </div>
              <div className="relative">
                <input id="adm-pw" type={showPw ? "text" : "password"} value={password}
                  onChange={e => { setPassword(e.target.value); clear(); }}
                  placeholder="••••••••••••" autoComplete="current-password"
                  className={`${inputCls} pr-10`} />
                <EyeToggle shown={showPw} onToggle={() => setShowPw(v => !v)} />
              </div>
            </div>

            {error && <Notice tone="error">{error}</Notice>}

            <button type="submit" disabled={busy || !email.trim() || !password.trim()} className={primaryBtnCls}>
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
    </AuthShell>
  );
}

// ─── SetPasswordGate ───────────────────────────────────────────────────────────
// Shown after opening a password-reset link (user holds a recovery session).

function SetPasswordGate({ onDone, onCancel }: { onDone: () => void | Promise<void>; onCancel: () => void }) {
  const [pw,      setPw]      = useState("");
  const [pw2,     setPw2]     = useState("");
  const [showPw,  setShowPw]  = useState(false);
  const [saving,  setSaving]  = useState(false);
  const [error,   setError]   = useState("");

  const tooShort = pw.length > 0 && pw.length < 8;
  const mismatch = pw2.length > 0 && pw !== pw2;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (pw.length < 8) { setError("Use at least 8 characters."); return; }
    if (pw !== pw2)   { setError("Passwords don't match."); return; }
    setSaving(true); setError("");
    const { error: err } = await getSupabaseBrowser().auth.updateUser({ password: pw });
    if (err) {
      const msg = err.message.toLowerCase();
      setError(msg.includes("different from the old")
        ? "Choose a password different from your current one."
        : msg.includes("weak") || msg.includes("pwned")
          ? "That password is too weak or has appeared in a data breach — pick another."
          : err.message || "Couldn't update your password. Please try again.");
      setSaving(false);
      return;
    }
    await onDone();
  }

  return (
    <AuthShell>
      <div className="mb-5">
        <h1 className="text-[17px] font-bold text-[#ededed] tracking-tight">Set a new password</h1>
        <p className="text-[13px] text-[#555] mt-1 leading-relaxed">This also changes the password for your Preciprocal app account.</p>
      </div>
      <form onSubmit={save} className="flex flex-col gap-3">
        <div>
          <label htmlFor="adm-new-pw" className={labelCls}>New password</label>
          <div className="relative">
            <input id="adm-new-pw" type={showPw ? "text" : "password"} value={pw} autoFocus autoComplete="new-password"
              onChange={e => { setPw(e.target.value); setError(""); }}
              placeholder="At least 8 characters" className={`${inputCls} pr-10`} />
            <EyeToggle shown={showPw} onToggle={() => setShowPw(v => !v)} />
          </div>
          {tooShort && <p className="text-[11px] text-[#f5a623] mt-1">At least 8 characters</p>}
        </div>
        <div>
          <label htmlFor="adm-new-pw2" className={labelCls}>Confirm password</label>
          <input id="adm-new-pw2" type={showPw ? "text" : "password"} value={pw2} autoComplete="new-password"
            onChange={e => { setPw2(e.target.value); setError(""); }}
            placeholder="Type it again" className={inputCls} />
          {mismatch && <p className="text-[11px] text-[#f5a623] mt-1">Passwords don&apos;t match</p>}
        </div>
        {error && <Notice tone="error">{error}</Notice>}
        <button type="submit" disabled={saving || pw.length < 8 || pw !== pw2} className={primaryBtnCls}>
          {saving
            ? <><div className="w-4 h-4 rounded-full border-2 border-black/20 border-t-black animate-spin" />Saving…</>
            : "Save password and sign in"}
        </button>
      </form>
      <button type="button" onClick={onCancel}
        className="mt-4 w-full text-center text-[12px] text-[#666] hover:text-[#ededed] bg-transparent border-none cursor-pointer transition-colors">
        ← Back to sign in
      </button>
    </AuthShell>
  );
}