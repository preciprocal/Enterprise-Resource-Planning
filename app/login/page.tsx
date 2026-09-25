"use client";

import { useState, useEffect } from "react";

export default function LoginPage() {
  const [password, setPassword] = useState("");
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState("");
  const [shake,    setShake]    = useState(false);
  const [showPw,   setShowPw]   = useState(false);

  const from = typeof window !== "undefined"
    ? (new URLSearchParams(window.location.search).get("from") ?? "/")
    : "/";

  useEffect(() => {
    document.getElementById("pw-input")?.focus();
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!password.trim()) return;
    setLoading(true);
    setError("");

    try {
      const res  = await fetch("/api/auth", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ password }),
      });
      const json = await res.json() as { success?: boolean; error?: string };

      if (res.ok && json.success) {
        window.location.href = from;
      } else {
        setError(json.error ?? "Invalid password");
        setPassword("");
        setShake(true);
        setTimeout(() => setShake(false), 600);
      }
    } catch {
      setError("Network error — please try again");
    }

    setLoading(false);
  }

  return (
    <div className="min-h-screen bg-black flex flex-col items-center justify-center p-4">
      <style>{`
        @keyframes shake {
          0%,100% { transform: translateX(0); }
          20%,60%  { transform: translateX(-6px); }
          40%,80%  { transform: translateX(6px); }
        }
        .shake { animation: shake 0.45s ease; }
      `}</style>

      <div className="w-full max-w-[360px]">

        {/* Logo */}
        <div className="flex flex-col items-center mb-8">
          <img src="/logo.png" alt="Preciprocal" className="w-10 h-10 object-contain mb-3" />
          <div className="text-[18px] font-bold text-[#ededed] tracking-tight">Preciprocal</div>
          <div className="text-[11px] font-medium text-[#555] uppercase tracking-[0.14em] mt-0.5">Enterprise Resource Planning</div>
        </div>

        {/* Card */}
        <div className={`bg-[#0a0a0a] border border-[#1a1a1a] rounded-xl p-6 ${shake ? "shake" : ""}`}>
          <div className="mb-5">
            <h1 className="text-[17px] font-bold text-[#ededed] tracking-tight">Admin access</h1>
            <p className="text-[13px] text-[#555] mt-1">Enter the admin password to continue.</p>
          </div>

          <form onSubmit={handleSubmit} className="flex flex-col gap-3">
            <div>
              <label htmlFor="pw-input" className="block text-[11px] font-bold text-[#555] uppercase tracking-widest mb-1.5">
                Password
              </label>
              <div className="relative">
                <input
                  id="pw-input"
                  type={showPw ? "text" : "password"}
                  value={password}
                  onChange={e => { setPassword(e.target.value); setError(""); }}
                  placeholder="••••••••••••"
                  autoComplete="current-password"
                  spellCheck={false}
                  className="w-full bg-[#111] border border-[#2a2a2a] rounded-lg px-3.5 py-2.5 pr-10 text-[14px] text-[#ededed] outline-none focus:border-[#555] transition-colors placeholder:text-[#333] font-[inherit]"
                />
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
              <div className="flex items-center gap-2 px-3 py-2.5 bg-[rgba(255,68,68,0.06)] border border-[rgba(255,68,68,0.2)] rounded-lg">
                <svg width="13" height="13" fill="none" stroke="#f44" strokeWidth="2" viewBox="0 0 24 24" className="shrink-0">
                  <circle cx="12" cy="12" r="10"/>
                  <line x1="12" y1="8" x2="12" y2="12"/>
                  <line x1="12" y1="16" x2="12.01" y2="16"/>
                </svg>
                <span className="text-[12px] text-[#f44] font-medium">{error}</span>
              </div>
            )}

            <button
              type="submit"
              disabled={loading || !password.trim()}
              className="w-full py-2.5 rounded-lg text-[14px] font-bold bg-[#ededed] text-black border-none cursor-pointer hover:bg-white disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2 transition-colors mt-1">
              {loading ? (
                <>
                  <div className="w-4 h-4 rounded-full border-2 border-black/20 border-t-black animate-spin" />
                  Signing in...
                </>
              ) : (
                <>
                  <svg width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                    <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/>
                    <polyline points="10 17 15 12 10 7"/>
                    <line x1="15" y1="12" x2="3" y2="12"/>
                  </svg>
                  Sign in
                </>
              )}
            </button>
          </form>
        </div>

        <p className="text-center text-[11px] text-[#333] mt-5">
          Preciprocal ERP · Internal use only
        </p>
      </div>
    </div>
  );
}
