"use client";

import { useState, useEffect } from "react";

export default function LoginPage() {
  const [password, setPassword] = useState("");
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState("");
  const [shake,    setShake]    = useState(false);

  // Read ?from= lazily — safe because this only runs on the client
  const from = typeof window !== "undefined"
    ? (new URLSearchParams(window.location.search).get("from") ?? "/")
    : "/";

  // Auto-focus on mount
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
    <div
      className="min-h-screen bg-gray-50 flex items-center justify-center p-4"
      style={{ fontFamily: "'Inter',-apple-system,sans-serif" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap');
        *, *::before, *::after { box-sizing: border-box; }
        body { margin: 0; }
        @keyframes shake {
          0%,100% { transform: translateX(0); }
          20%,60%  { transform: translateX(-6px); }
          40%,80%  { transform: translateX(6px); }
        }
        .shake { animation: shake 0.45s ease; }
      `}</style>

      <div className="w-full max-w-sm">

        {/* Logo */}
        <div className="flex flex-col items-center mb-8">
          <div
            className="w-14 h-14 rounded-2xl flex items-center justify-center mb-4 shadow-lg shadow-indigo-200"
            style={{ background: "linear-gradient(135deg,#6366F1,#8B5CF6)" }}>
            <svg width="26" height="26" fill="none" stroke="#fff" strokeWidth="2.2" viewBox="0 0 24 24">
              <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/>
            </svg>
          </div>
          <h1 className="text-[22px] font-extrabold text-gray-900 tracking-tight">Preciprocal</h1>
          <p className="text-[11px] font-semibold text-gray-400 mt-1 uppercase tracking-[0.12em]">
            Admin Dashboard
          </p>
        </div>

        {/* Card */}
        <div className={`bg-white rounded-2xl border border-gray-100 shadow-sm p-7 ${shake ? "shake" : ""}`}>
          <div className="mb-5">
            <h2 className="text-[15px] font-bold text-gray-900">Sign in to continue</h2>
            <p className="text-xs text-gray-400 mt-1">This dashboard is restricted to authorised admins only.</p>
          </div>

          <form onSubmit={handleSubmit} className="flex flex-col gap-3.5">
            <div>
              <label
                htmlFor="pw-input"
                className="block text-[10px] font-bold text-gray-500 uppercase tracking-widest mb-1.5">
                Admin Password
              </label>
              <input
                id="pw-input"
                type="password"
                value={password}
                onChange={e => { setPassword(e.target.value); setError(""); }}
                placeholder="••••••••••••"
                autoComplete="current-password"
                spellCheck={false}
                className="w-full border border-gray-200 rounded-xl px-3.5 py-2.5 text-sm text-gray-900 bg-white outline-none transition-all placeholder:text-gray-300"
                style={{ fontFamily: "inherit" }}
              />
            </div>

            {error && (
              <div className="flex items-center gap-2 px-3 py-2.5 bg-rose-50 border border-rose-200 rounded-lg">
                <svg width="13" height="13" fill="none" stroke="#F43F5E" strokeWidth="2" viewBox="0 0 24 24" className="shrink-0">
                  <circle cx="12" cy="12" r="10"/>
                  <line x1="12" y1="8" x2="12" y2="12"/>
                  <line x1="12" y1="16" x2="12.01" y2="16"/>
                </svg>
                <span className="text-xs text-rose-600 font-medium">{error}</span>
              </div>
            )}

            <button
              type="submit"
              disabled={loading || !password.trim()}
              className="w-full py-2.5 rounded-xl text-sm font-bold text-white border-none cursor-pointer flex items-center justify-center gap-2 mt-1 disabled:opacity-50 disabled:cursor-not-allowed transition-opacity"
              style={{ background: "linear-gradient(135deg,#6366F1,#8B5CF6)" }}>
              {loading ? (
                <>
                  <div className="w-4 h-4 rounded-full border-2 border-white/30 border-t-white animate-spin" />
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

        <p className="text-center text-[10px] text-gray-300 mt-5">
          Preciprocal ERP · Internal use only
        </p>
      </div>
    </div>
  );
}