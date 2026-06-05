"use client";

import { useState, useEffect, useCallback } from "react";
import { getApps, initializeApp } from "firebase/app";
import {
  getAuth,
  onIdTokenChanged,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  GoogleAuthProvider,
  setPersistence,
  browserLocalPersistence,
} from "firebase/auth";
import AdminDashboard from "@/components/AdminDashboard";
import Image from "next/image";

// ─── Firebase Auth — reuse the adm-dashboard app already created in admin.ts,
//     or create it here if this module loads first.
//     Auth is pure HTTPS — it opens zero Firestore/WebChannel connections.  ───

const FB_CFG = {
  apiKey:            process.env.NEXT_PUBLIC_FIREBASE_API_KEY             ?? "",
  authDomain:        process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN         ?? "",
  projectId:         process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID          ?? "",
  storageBucket:     process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET      ?? "",
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID ?? "",
  appId:             process.env.NEXT_PUBLIC_FIREBASE_APP_ID              ?? "",
};

function getAdmApp() {
  return getApps().find(a => a.name === "adm-dashboard") ?? initializeApp(FB_CFG, "adm-dashboard");
}

function getAdmAuth() {
  return getAuth(getAdmApp());
}

// ─── Types ────────────────────────────────────────────────────────────────────

type AuthState = "checking" | "authed" | "unauthed";

// ─── Root ─────────────────────────────────────────────────────────────────────

export default function Home() {
  const [authState, setAuthState] = useState<AuthState>("checking");
  const [token,     setToken]     = useState("");

  // Verify an ID token server-side — checks Firebase validity + isAdmin flag
  const verify = useCallback(async (idToken: string): Promise<boolean> => {
    try {
      const res  = await fetch("/api/admin?action=verify", {
        headers: { "x-firebase-token": idToken },
      });
      const json = await res.json() as { ok?: boolean };
      return res.ok && json.ok === true;
    } catch {
      return false;
    }
  }, []);

  // On mount: check if Firebase still has a signed-in user (persisted via browserLocalPersistence)
  useEffect(() => {
    const auth = getAdmAuth();
    const unsub = onIdTokenChanged(auth, async fbUser => {
      if (!fbUser) {
        setToken("");
        setAuthState("unauthed");
        return;
      }
      try {
        const idToken = await fbUser.getIdToken();
        const ok      = await verify(idToken);
        if (ok) {
          setToken(idToken);
          setAuthState("authed");
        } else {
          // Signed in to Firebase but not an admin
          await signOut(auth).catch(() => { /* ignore */ });
          setToken("");
          setAuthState("unauthed");
        }
      } catch {
        setToken("");
        setAuthState("unauthed");
      }
    });
    return unsub;
  }, [verify]);

  const handleLogout = useCallback(async () => {
    await signOut(getAdmAuth()).catch(() => { /* ignore */ });
    setToken("");
    setAuthState("unauthed");
  }, []);

  if (authState === "checking") return <Spinner />;
  if (authState === "unauthed") return (
    <LoginGate verify={verify} onSuccess={tok => { setToken(tok); setAuthState("authed"); }} />
  );

  return <AdminDashboard token={token} onLogout={handleLogout} />;
}

// ─── Spinner ──────────────────────────────────────────────────────────────────

function Spinner() {
  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <div className="w-7 h-7 rounded-full border-[2.5px] border-gray-200 border-t-indigo-500 animate-spin" />
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  );
}

// ─── LoginGate ─────────────────────────────────────────────────────────────────

interface LoginGateProps {
  verify:    (idToken: string) => Promise<boolean>;
  onSuccess: (idToken: string) => void;
}

function LoginGate({ verify, onSuccess }: LoginGateProps) {
  const [email,         setEmail]         = useState("");
  const [password,      setPassword]      = useState("");
  const [loading,       setLoading]       = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [error,         setError]         = useState("");
  const [showPw,        setShowPw]        = useState(false);

  const clear = () => setError("");

  async function finishAuth(fbUser: import("firebase/auth").User) {
    const idToken = await fbUser.getIdToken(true);
    const ok      = await verify(idToken);
    if (!ok) {
      await signOut(getAdmAuth()).catch(() => { /* ignore */ });
      setError("Access denied — your account does not have admin privileges.");
      return;
    }
    onSuccess(idToken);
  }

  async function signInEmail(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim() || !password.trim()) return;
    setLoading(true); clear();
    try {
      const auth = getAdmAuth();
      await setPersistence(auth, browserLocalPersistence);
      const cred = await signInWithEmailAndPassword(auth, email.trim(), password);
      await finishAuth(cred.user);
    } catch (err) {
      const code = (err as { code?: string }).code ?? "";
      if (code === "auth/invalid-credential" || code === "auth/wrong-password" || code === "auth/user-not-found")
        setError("Incorrect email or password.");
      else if (code === "auth/too-many-requests")
        setError("Too many attempts — please wait and try again.");
      else if (code === "auth/user-disabled")
        setError("This account has been disabled.");
      else if (!error)
        setError("Sign-in failed. Please try again.");
      setPassword("");
    } finally { setLoading(false); }
  }

  async function signInGoogle() {
    setGoogleLoading(true); clear();
    try {
      const auth     = getAdmAuth();
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({ prompt: "select_account" });
      await setPersistence(auth, browserLocalPersistence);
      const cred = await signInWithPopup(auth, provider);
      await finishAuth(cred.user);
    } catch (err) {
      const code = (err as { code?: string }).code ?? "";
      if (code !== "auth/popup-closed-by-user" && code !== "auth/cancelled-popup-request" && !error)
        setError("Google sign-in failed. Please try again.");
    } finally { setGoogleLoading(false); }
  }

  const busy = loading || googleLoading;

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4"
      style={{ fontFamily: "'Inter',-apple-system,sans-serif" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap');
        *,*::before,*::after{box-sizing:border-box} body{margin:0}
        @keyframes spin{to{transform:rotate(360deg)}}
      `}</style>

      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="flex flex-col items-center mb-8">
          <Image src="/logo.png" alt="Preciprocal" className="w-16 h-16 mb-3 rounded-2xl shadow-lg" />
          <p className="text-[11px] font-semibold text-gray-400 mt-1 uppercase tracking-widest">
            Admin Dashboard
          </p>
        </div>

        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-7">
          <h2 className="text-[15px] font-bold text-gray-900 mb-0.5">Sign in to continue</h2>
          <p className="text-[11px] text-gray-400 mb-5">Restricted to authorised admins only.</p>

          {/* Google */}
          <button onClick={signInGoogle} disabled={busy}
            className="w-full flex items-center justify-center gap-2.5 py-2.5 rounded-xl border border-gray-200 bg-white hover:bg-gray-50 text-[13px] font-semibold text-gray-700 cursor-pointer disabled:opacity-50 transition-colors mb-4">
            {googleLoading
              ? <div className="w-4 h-4 rounded-full border-2 border-gray-300 border-t-indigo-500 animate-spin" />
              : <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                  <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                  <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                  <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/>
                  <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                </svg>
            }
            {googleLoading ? "Connecting…" : "Continue with Google"}
          </button>

          <div className="flex items-center gap-3 mb-4">
            <div className="flex-1 h-px bg-gray-100" />
            <span className="text-[10px] text-gray-300 font-semibold uppercase tracking-wider">or</span>
            <div className="flex-1 h-px bg-gray-100" />
          </div>

          <form onSubmit={signInEmail} className="flex flex-col gap-3">
            <div>
              <label htmlFor="adm-email" className="block text-[10px] font-bold text-gray-500 uppercase tracking-widest mb-1.5">
                Email
              </label>
              <input id="adm-email" type="email" value={email} autoFocus autoComplete="email"
                onChange={e => { setEmail(e.target.value); clear(); }}
                placeholder="admin@preciprocal.com"
                className="w-full border border-gray-200 rounded-xl px-3.5 py-2.5 text-sm text-gray-900 bg-white outline-none focus:ring-2 focus:ring-indigo-400 transition-all placeholder:text-gray-300"
                style={{ fontFamily: "inherit" }} />
            </div>

            <div>
              <label htmlFor="adm-pw" className="block text-[10px] font-bold text-gray-500 uppercase tracking-widest mb-1.5">
                Password
              </label>
              <div className="relative">
                <input id="adm-pw" type={showPw ? "text" : "password"} value={password}
                  onChange={e => { setPassword(e.target.value); clear(); }}
                  placeholder="••••••••••••" autoComplete="current-password"
                  className="w-full border border-gray-200 rounded-xl px-3.5 py-2.5 pr-10 text-sm text-gray-900 bg-white outline-none focus:ring-2 focus:ring-indigo-400 transition-all placeholder:text-gray-300"
                  style={{ fontFamily: "inherit" }} />
                <button type="button" onClick={() => setShowPw(v => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 border-none bg-transparent cursor-pointer p-0">
                  {showPw
                    ? <svg width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
                    : <svg width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                  }
                </button>
              </div>
            </div>

            {error && (
              <div className="flex items-start gap-2 px-3 py-2.5 bg-rose-50 border border-rose-200 rounded-lg">
                <svg width="13" height="13" fill="none" stroke="#F43F5E" strokeWidth="2" viewBox="0 0 24 24" className="shrink-0 mt-0.5">
                  <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
                </svg>
                <span className="text-[11px] text-rose-600 font-medium leading-relaxed">{error}</span>
              </div>
            )}

            <button type="submit" disabled={busy || !email.trim() || !password.trim()}
              className="w-full py-2.5 rounded-xl text-sm font-bold text-white border-none cursor-pointer flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed mt-1"
              style={{ background: "linear-gradient(135deg,#6366F1,#8B5CF6)" }}>
              {loading
                ? <><div className="w-4 h-4 rounded-full border-2 border-white/30 border-t-white animate-spin" />Signing in…</>
                : <>
                    <svg width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                      <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/>
                      <polyline points="10 17 15 12 10 7"/><line x1="15" y1="12" x2="3" y2="12"/>
                    </svg>
                    Sign in with Email
                  </>
              }
            </button>
          </form>
        </div>

        <p className="text-center text-[10px] text-gray-300 mt-5">Preciprocal ERP · Internal use only</p>
      </div>
    </div>
  );
}