// components/admin/EmailTab.tsx
"use client";
import { useState, useEffect, useCallback } from "react";
import { Spinner, useIsMobile } from "./admin-shared";

// ─── Types ────────────────────────────────────────────────────────────────────

interface MSEmail {
  id: string;
  subject: string;
  bodyPreview: string;
  body?: { content: string; contentType: string };
  from: { emailAddress: { name: string; address: string } };
  toRecipients: { emailAddress: { name: string; address: string } }[];
  receivedDateTime: string;
  isRead: boolean;
  hasAttachments: boolean;
  importance: "low" | "normal" | "high";
  webLink?: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const GRAPH       = "https://graph.microsoft.com/v1.0";
const SCOPES      = "Mail.Read Mail.Send Mail.ReadWrite offline_access User.Read";
const TOKEN_KEY   = "ms_email_token";
const REFRESH_KEY = "ms_email_refresh";
const EXPIRY_KEY  = "ms_email_expiry";

const FOLDERS = [
  { id: "inbox",        label: "Inbox",  icon: "M20 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 4-8 5-8-5V6l8 5 8-5v2z" },
  { id: "sentitems",    label: "Sent",   icon: "M2.01 21 23 12 2.01 3 2 10l15 2-15 2z" },
  { id: "drafts",       label: "Drafts", icon: "M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z" },
  { id: "junkemail",    label: "Junk",   icon: "M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z" },
  { id: "deleteditems", label: "Trash",  icon: "M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z" },
] as const;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtDate(iso: string) {
  const d = new Date(iso), now = new Date(), diff = now.getTime() - d.getTime();
  if (diff < 86_400_000 && d.getDate() === now.getDate())
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  if (diff < 7 * 86_400_000) return d.toLocaleDateString([], { weekday: "short" });
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}

function initials(name: string) {
  const p = name.trim().split(" ");
  return (p[0][0] + (p[1]?.[0] ?? "")).toUpperCase();
}

function avatarColor(name: string) {
  const cols = ["#6366F1","#8B5CF6","#EC4899","#F59E0B","#10B981","#3B82F6","#EF4444","#14B8A6"];
  let h = 0;
  for (let i = 0; i < name.length; i++) h = name.charCodeAt(i) + ((h << 5) - h);
  return cols[Math.abs(h) % cols.length];
}

const VERIFIER_KEY = "ms_pkce_verifier";

async function generatePKCE(): Promise<{ verifier: string; challenge: string }> {
  const array    = crypto.getRandomValues(new Uint8Array(32));
  const verifier = btoa(String.fromCharCode(...Array.from(array)))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
  const digest   = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  const challenge = btoa(String.fromCharCode(...Array.from(new Uint8Array(digest))))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
  return { verifier, challenge };
}

async function startOAuth(): Promise<void> {
  const { verifier, challenge } = await generatePKCE();
  localStorage.setItem(VERIFIER_KEY, verifier);
  const clientId    = process.env.NEXT_PUBLIC_MS_CLIENT_ID ?? "";
  const tenantId    = process.env.NEXT_PUBLIC_MS_TENANT_ID ?? "common";
  const redirectUri = encodeURIComponent(window.location.href.split("?")[0].split("#")[0]);
  const scope       = encodeURIComponent(SCOPES);
  window.location.href =
    "https://login.microsoftonline.com/" + tenantId + "/oauth2/v2.0/authorize" +
    "?client_id=" + clientId +
    "&response_type=code" +
    "&redirect_uri=" + redirectUri +
    "&scope=" + scope +
    "&response_mode=query" +
    "&code_challenge=" + challenge +
    "&code_challenge_method=S256" +
    "&prompt=select_account";
}

interface TokenResponse {
  access_token:  string;
  refresh_token?: string;
  expires_in?:   number;
}

function persistTokens(data: TokenResponse) {
  localStorage.setItem(TOKEN_KEY, data.access_token);
  if (data.refresh_token) localStorage.setItem(REFRESH_KEY, data.refresh_token);
  const expiresAt = Date.now() + ((data.expires_in ?? 3600) - 60) * 1000;
  localStorage.setItem(EXPIRY_KEY, String(expiresAt));
}

async function fetchToken(body: URLSearchParams): Promise<TokenResponse> {
  const tenantId = process.env.NEXT_PUBLIC_MS_TENANT_ID ?? "common";
  const res = await fetch(
    "https://login.microsoftonline.com/" + tenantId + "/oauth2/v2.0/token",
    { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body }
  );
  if (!res.ok) {
    const e = await res.json().catch(() => ({})) as { error_description?: string };
    throw new Error(e.error_description ?? "Token request failed");
  }
  return res.json() as Promise<TokenResponse>;
}

async function exchangeCode(code: string): Promise<string> {
  const clientId    = process.env.NEXT_PUBLIC_MS_CLIENT_ID ?? "";
  const redirectUri = window.location.href.split("?")[0].split("#")[0];
  const verifier    = localStorage.getItem(VERIFIER_KEY) ?? "";
  const data = await fetchToken(new URLSearchParams({
    grant_type:    "authorization_code",
    code,
    client_id:     clientId,
    redirect_uri:  redirectUri,
    code_verifier: verifier,
    scope:         SCOPES,
  }));
  localStorage.removeItem(VERIFIER_KEY);
  persistTokens(data);
  return data.access_token;
}

async function refreshAccessToken(): Promise<string | null> {
  const refreshToken = localStorage.getItem(REFRESH_KEY);
  if (!refreshToken) return null;
  try {
    const clientId = process.env.NEXT_PUBLIC_MS_CLIENT_ID ?? "";
    const data = await fetchToken(new URLSearchParams({
      grant_type:    "refresh_token",
      refresh_token: refreshToken,
      client_id:     clientId,
      scope:         SCOPES,
    }));
    persistTokens(data);
    return data.access_token;
  } catch {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(REFRESH_KEY);
    localStorage.removeItem(EXPIRY_KEY);
    return null;
  }
}

async function getValidToken(): Promise<string | null> {
  const tok    = localStorage.getItem(TOKEN_KEY);
  const expiry = parseInt(localStorage.getItem(EXPIRY_KEY) ?? "0", 10);
  if (tok && Date.now() < expiry) return tok;
  return refreshAccessToken();
}

async function graphFetch<T>(path: string, token: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(GRAPH + path, {
    ...opts,
    headers: { Authorization: "Bearer " + token, "Content-Type": "application/json", ...(opts?.headers ?? {}) },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: { message: res.statusText } })) as { error?: { message?: string } };
    throw new Error(err?.error?.message ?? res.statusText);
  }
  if (res.status === 204) return {} as T;
  return res.json() as Promise<T>;
}

// ─── Not-configured screen ────────────────────────────────────────────────────

function NotConfigured() {
  return (
    <div className="flex-1 flex items-center justify-center bg-gray-50 p-6">
      <div className="max-w-lg w-full">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-12 h-12 rounded-2xl bg-blue-50 flex items-center justify-center shrink-0 shadow-sm">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
              <rect x="2" y="2" width="9" height="9" fill="#F25022"/>
              <rect x="13" y="2" width="9" height="9" fill="#7FBA00"/>
              <rect x="2" y="13" width="9" height="9" fill="#00A4EF"/>
              <rect x="13" y="13" width="9" height="9" fill="#FFB900"/>
            </svg>
          </div>
          <div>
            <h2 className="text-[16px] font-bold text-gray-900">Outlook not connected</h2>
            <p className="text-[12px] text-gray-500">Add 2 env vars to enable this tab</p>
          </div>
        </div>
        <div className="bg-slate-900 rounded-xl p-4 mb-5">
          <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-3">Add to your .env.local</div>
          {[
            { key: "NEXT_PUBLIC_MS_CLIENT_ID", desc: "Application (client) ID from your Azure App Registration" },
            { key: "NEXT_PUBLIC_MS_TENANT_ID", desc: "Tenant ID - use common for personal accounts, or your tenant GUID" },
          ].map(v => (
            <div key={v.key} className="mb-3 last:mb-0">
              <div className="font-mono text-[12px] text-indigo-300 mb-0.5">{v.key}=<span className="text-slate-400">your_value_here</span></div>
              <div className="text-[10px] text-slate-500">{v.desc}</div>
            </div>
          ))}
        </div>
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <div className="px-4 py-3 bg-gray-50 border-b border-gray-200">
            <span className="text-[12px] font-bold text-gray-700">How to set up Azure (5 min)</span>
          </div>
          {[
            { n: 1, color: "indigo", title: "Create App Registration", body: 'Go to portal.azure.com, search "App registrations", click "New registration", set Supported account types to "Accounts in any org directory and personal Microsoft accounts", then Register.' },
            { n: 2, color: "indigo", title: "Copy your IDs", body: "On the app Overview page copy Application (client) ID and Directory (tenant) ID." },
            { n: 4, color: "indigo", title: "Set redirect URI", body: 'Left sidebar > "Authentication" > "+ Add a platform" > "Single-page application" > paste your admin dashboard URL > Save.' },
            { n: 5, color: "green",  title: "Add env vars & restart", body: "Add both env vars to .env.local and restart the dev server." },
          ].map((s, i) => (
            <div key={s.n} className={"px-4 py-3 border-b border-gray-100" + (i === 3 ? " last:border-0" : "")}>
              <div className="flex items-start gap-3">
                <div className={"w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0 mt-0.5 bg-" + s.color + "-100 text-" + s.color + "-700"}>{s.n}</div>
                <div>
                  <p className="text-[12px] font-semibold text-gray-800 mb-1">{s.title}</p>
                  <p className="text-[11px] text-gray-500 leading-relaxed">{s.body}</p>
                </div>
              </div>
            </div>
          ))}
          <div className="px-4 py-3 bg-amber-50/40 border-t border-gray-100">
            <div className="flex items-start gap-3">
              <div className="w-5 h-5 rounded-full bg-amber-100 text-amber-700 flex items-center justify-center text-[10px] font-bold shrink-0 mt-0.5">3</div>
              <div>
                <p className="text-[12px] font-semibold text-gray-800 mb-1">Add Mail permissions <span className="text-amber-600 font-normal">(where people get stuck)</span></p>
                <p className="text-[11px] text-gray-600 leading-relaxed">Left sidebar &gt; &quot;API permissions&quot; &gt; &quot;+ Add a permission&quot; &gt; &quot;Microsoft Graph&quot; &gt; &quot;Delegated permissions&quot; &gt; search Mail and tick:</p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {["Mail.Read","Mail.Send","Mail.ReadWrite"].map(p => (
                    <code key={p} className="bg-indigo-50 text-indigo-700 border border-indigo-200 rounded px-1.5 py-0.5 text-[11px] font-mono font-semibold">{p}</code>
                  ))}
                </div>
                <p className="text-[11px] text-gray-500 mt-2">Then click &quot;Add permissions&quot; and &quot;Grant admin consent&quot;.</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Compose Modal ────────────────────────────────────────────────────────────

function ComposeModal({
  token, onClose, prefill,
}: {
  token: string;
  onClose: () => void;
  prefill?: { to?: string; subject?: string; body?: string };
}) {
  const [to,      setTo]      = useState(prefill?.to ?? "");
  const [subject, setSubject] = useState(prefill?.subject ?? "");
  const [body,    setBody]    = useState(prefill?.body ?? "");
  const [sending, setSending] = useState(false);
  const [err,     setErr]     = useState("");
  const [sent,    setSent]    = useState(false);

  const send = async () => {
    if (!to.trim() || !subject.trim()) return;
    setSending(true); setErr("");
    try {
      await graphFetch("/me/sendMail", token, {
        method: "POST",
        body: JSON.stringify({
          message: {
            subject,
            body: { contentType: "Text", content: body },
            toRecipients: to.split(",").map(a => ({ emailAddress: { address: a.trim() } })),
          },
          saveToSentItems: true,
        }),
      });
      setSent(true);
      setTimeout(onClose, 1200);
    } catch (e) { setErr((e as Error).message); }
    finally { setSending(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl flex flex-col" style={{ maxHeight: "90vh" }}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <span className="text-[14px] font-bold text-gray-900">New Message</span>
          <button onClick={onClose} className="w-7 h-7 rounded-full hover:bg-gray-100 flex items-center justify-center cursor-pointer border-none bg-transparent text-gray-400">
            <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
        <div className="flex-1 overflow-y-auto">
          {[
            { label: "To",      value: to,      onChange: setTo,      placeholder: "recipient@example.com, ..." },
            { label: "Subject", value: subject, onChange: setSubject, placeholder: "Subject" },
          ].map(f => (
            <div key={f.label} className="flex items-center gap-3 px-5 py-2.5 border-b border-gray-100">
              <span className="text-[11px] font-semibold text-gray-400 w-12 shrink-0">{f.label}</span>
              <input value={f.value} onChange={e => f.onChange(e.target.value)} placeholder={f.placeholder}
                className="flex-1 text-[13px] border-none outline-none bg-transparent text-gray-900" />
            </div>
          ))}
          <textarea value={body} onChange={e => setBody(e.target.value)} placeholder="Write your message..."
            className="w-full resize-none text-[13px] text-gray-800 px-5 py-4 border-none outline-none bg-transparent"
            rows={10} />
        </div>
        <div className="flex items-center justify-between px-5 py-3 border-t border-gray-100 gap-3">
          {err  && <span className="text-[12px] text-red-500 flex-1 truncate">{err}</span>}
          {sent && <span className="text-[12px] text-green-600 font-semibold flex-1">Sent!</span>}
          {!err && !sent && <span className="flex-1" />}
          <button onClick={onClose} className="px-4 py-2 text-[12px] font-medium text-gray-500 hover:text-gray-700 border-none bg-transparent cursor-pointer">Cancel</button>
          <button onClick={send} disabled={sending || !to.trim() || !subject.trim() || sent}
            className="px-5 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white text-[12px] font-semibold rounded-xl transition-colors cursor-pointer border-none flex items-center gap-2">
            {sending ? <Spinner size={12} /> : <svg width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>}
            {sending ? "Sending..." : "Send"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Sign-in screen ───────────────────────────────────────────────────────────

function SignInScreen({ error }: { error?: string }) {
  return (
    <div className="flex-1 flex items-center justify-center bg-gray-50 p-8">
      <div className="text-center max-w-xs">
        <div className="w-14 h-14 rounded-2xl bg-blue-50 flex items-center justify-center mx-auto mb-5 shadow-sm">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none">
            <rect x="2" y="2" width="9" height="9" fill="#F25022"/>
            <rect x="13" y="2" width="9" height="9" fill="#7FBA00"/>
            <rect x="2" y="13" width="9" height="9" fill="#00A4EF"/>
            <rect x="13" y="13" width="9" height="9" fill="#FFB900"/>
          </svg>
        </div>
        <h2 className="text-[17px] font-bold text-gray-900 mb-1.5">Outlook Inbox</h2>
        <p className="text-[13px] text-gray-400 mb-6">Sign in with Microsoft to read and send emails.</p>
        <button
          onClick={() => { void startOAuth(); }}
          className="w-full py-3 bg-indigo-600 hover:bg-indigo-700 text-white text-[14px] font-semibold rounded-xl transition-colors cursor-pointer border-none flex items-center justify-center gap-2 shadow-sm">
          <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><polyline points="10 17 15 12 10 7"/><line x1="15" y1="12" x2="3" y2="12"/>
          </svg>
          Sign in with Microsoft
        </button>
        {error && <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-lg text-[12px] text-red-600">{error}</div>}
      </div>
    </div>
  );
}

// ─── Main EmailTab ─────────────────────────────────────────────────────────────

export default function EmailTab() {
  const isMobile     = useIsMobile();
  const isConfigured = !!(process.env.NEXT_PUBLIC_MS_CLIENT_ID);

  const [token,      setToken]      = useState<string | null>(null);
  const [folder,     setFolder]     = useState("inbox");
  const [emails,     setEmails]     = useState<MSEmail[]>([]);
  const [loading,    setLoading]    = useState(false);
  const [error,      setError]      = useState("");
  // KEY FIX: store only selectedId; derive selected from emails[] as single source of truth.
  // This means any emails[] update (read/unread, body fetch) is immediately reflected in detail panel.
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [compose,    setCompose]    = useState(false);
  const [replyTo,    setReplyTo]    = useState<MSEmail | null>(null);
  const [forwardOf,  setForwardOf]  = useState<MSEmail | null>(null);
  const [search,     setSearch]     = useState("");
  const [unread,     setUnread]     = useState<Record<string, number>>({});
  const [me,         setMe]         = useState<{ displayName: string; mail: string } | null>(null);
  const [mobileView, setMobileView] = useState<"list" | "detail">("list");

  const selected = emails.find(e => e.id === selectedId) ?? null;

  // ── Restore token / handle OAuth callback ──────────────────────────────
  useEffect(() => {
    if (!isConfigured) return;
    void Promise.resolve().then(async () => {
      const params = new URLSearchParams(window.location.search);
      const code   = params.get("code");
      if (code) {
        try {
          const tok = await exchangeCode(code);
          setToken(tok);
          window.history.replaceState(null, "", window.location.pathname);
        } catch (e) {
          setError((e as Error).message);
        }
        return;
      }
      const tok = await getValidToken();
      if (tok) setToken(tok);
    });
  }, [isConfigured]);

  // ── User profile ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!token) return;
    graphFetch<{ displayName: string; mail: string }>("/me?$select=displayName,mail", token)
      .then(setMe)
      .catch(() => {});
  }, [token]);

  // ── Load emails ───────────────────────────────────────────────────────
  const loadEmails = useCallback((folderId: string, tok: string) => {
    void Promise.resolve()
      .then(() => {
        setLoading(true);
        setError("");
        setSelectedId(null);
        return graphFetch<{ value: MSEmail[] }>(
          "/me/mailFolders/" + folderId + "/messages?$top=40&$select=id,subject,bodyPreview,from,toRecipients,receivedDateTime,isRead,hasAttachments,importance,webLink&$orderby=receivedDateTime desc",
          tok
        );
      })
      .then(data => {
        setEmails(data.value ?? []);
        setLoading(false);
      })
      .catch(e => {
        const msg = (e as Error).message;
        if (msg.includes("401") || msg.includes("InvalidAuthentication") || msg.includes("token")) {
          localStorage.removeItem(TOKEN_KEY);
          localStorage.removeItem(REFRESH_KEY);
          localStorage.removeItem(EXPIRY_KEY);
          setToken(null);
        } else {
          setError(msg);
        }
        setLoading(false);
      });
  }, []);

  useEffect(() => { if (token) loadEmails(folder, token); }, [folder, token, loadEmails]);

  // ── Unread counts ─────────────────────────────────────────────────────
  useEffect(() => {
    if (!token) return;
    Promise.all(
      FOLDERS.map(f =>
        graphFetch<{ unreadItemCount: number }>("/me/mailFolders/" + f.id + "?$select=unreadItemCount", token)
          .then(r => [f.id, r.unreadItemCount] as const)
          .catch(() => [f.id, 0] as const)
      )
    ).then(results => {
      const map: Record<string, number> = {};
      results.forEach(([id, count]) => { map[id] = count; });
      setUnread(map);
    });
  }, [token, emails]);

  // ── Open email ────────────────────────────────────────────────────────
  // FIX 1: Always mark read on open — update emails[] immediately (not inside the
  // "!email.body" branch). Previously cached emails skipped the mark-read entirely.
  const openEmail = useCallback(async (email: MSEmail) => {
    setSelectedId(email.id);
    if (isMobile) setMobileView("detail");

    // Optimistically mark as read in emails[] right away
    if (!email.isRead) {
      setEmails(prev => prev.map(e => e.id === email.id ? { ...e, isRead: true } : e));
      if (token) {
        graphFetch("/me/messages/" + email.id, token, {
          method: "PATCH", body: JSON.stringify({ isRead: true }),
        }).catch(() => {});
      }
    }

    // Fetch full body + webLink if not already loaded
    if (!email.body && token) {
      try {
        const full = await graphFetch<MSEmail>(
          "/me/messages/" + email.id + "?$select=id,subject,body,from,toRecipients,receivedDateTime,isRead,hasAttachments,webLink",
          token
        );
        setEmails(prev => prev.map(e =>
          e.id === full.id ? { ...e, body: full.body, webLink: full.webLink, isRead: true } : e
        ));
      } catch {}
    }
  }, [token, isMobile]);

  // ── Delete ────────────────────────────────────────────────────────────
  const deleteEmail = useCallback(async (id: string) => {
    if (!token) return;
    setEmails(prev => prev.filter(e => e.id !== id));
    setSelectedId(null);
    if (isMobile) setMobileView("list");
    graphFetch("/me/messages/" + id, token, { method: "DELETE" }).catch(() => {});
  }, [token, isMobile]);

  // ── Toggle read/unread ────────────────────────────────────────────────
  // FIX 2: Only update emails[] — selected is derived from it automatically.
  // Previously there was a separate setSelected() that could get out of sync.
  const toggleRead = useCallback(async (email: MSEmail) => {
    if (!token) return;
    const newVal = !email.isRead;
    setEmails(prev => prev.map(e => e.id === email.id ? { ...e, isRead: newVal } : e));
    graphFetch("/me/messages/" + email.id, token, {
      method: "PATCH", body: JSON.stringify({ isRead: newVal }),
    }).catch(() => {
      // Revert on failure
      setEmails(prev => prev.map(e => e.id === email.id ? { ...e, isRead: email.isRead } : e));
    });
  }, [token]);

  // ── Search filter ─────────────────────────────────────────────────────
  const filtered = search.trim()
    ? emails.filter(e =>
        e.subject?.toLowerCase().includes(search.toLowerCase()) ||
        e.from?.emailAddress?.name?.toLowerCase().includes(search.toLowerCase()) ||
        e.bodyPreview?.toLowerCase().includes(search.toLowerCase())
      )
    : emails;

  if (!isConfigured) return <NotConfigured />;
  if (!token) return <SignInScreen error={error || undefined} />;

  // ── List panel ────────────────────────────────────────────────────────
  const ListPanel = (
    <div className={"flex flex-col border-r border-gray-100 bg-white " + (isMobile ? "flex-1" : "w-80 shrink-0") + " " + (isMobile && mobileView === "detail" ? "hidden" : "flex")}>
      <div className="px-3 pt-3 pb-2 border-b border-gray-100 space-y-2">
        <div className="flex items-center gap-2">
          <div className="flex-1 flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-lg px-3 py-1.5">
            <svg width="12" height="12" fill="none" stroke="#9CA3AF" strokeWidth="2" viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search..."
              className="flex-1 text-[12px] bg-transparent border-none outline-none text-gray-700 placeholder-gray-400" />
          </div>
          <button onClick={() => { if (token) loadEmails(folder, token); }}
            className="w-7 h-7 rounded-lg border border-gray-200 bg-white flex items-center justify-center cursor-pointer hover:bg-gray-50 shrink-0">
            {loading ? <Spinner size={11} /> : (
              <svg width="11" height="11" fill="none" stroke="#6B7280" strokeWidth="2" viewBox="0 0 24 24">
                <path d="M23 4v6h-6M1 20v-6h6M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
              </svg>
            )}
          </button>
        </div>
        <div className="flex gap-1 overflow-x-auto pb-0.5 scrollbar-hide">
          {FOLDERS.map(f => (
            <button key={f.id} onClick={() => { setFolder(f.id); setSelectedId(null); }}
              className={"flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold whitespace-nowrap border-none cursor-pointer transition-colors shrink-0 " + (folder === f.id ? "bg-indigo-600 text-white" : "bg-gray-100 text-gray-500 hover:bg-gray-200")}>
              {f.label}
              {(unread[f.id] ?? 0) > 0 && (
                <span className={"text-[9px] rounded-full px-1 py-0.5 font-bold " + (folder === f.id ? "bg-white text-indigo-600" : "bg-indigo-500 text-white")}>
                  {unread[f.id]}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {error && !loading && <div className="p-4 text-[12px] text-red-500 text-center">{error}</div>}
        {loading && <div className="flex items-center justify-center py-12"><Spinner size={20} /></div>}
        {!loading && filtered.length === 0 && !error && (
          <div className="flex flex-col items-center justify-center py-12 text-gray-400">
            <svg width="28" height="28" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24" className="mb-2 opacity-40">
              <path d="M20 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 4-8 5-8-5V6l8 5 8-5v2z"/>
            </svg>
            <p className="text-[12px]">{search ? "No results" : "No emails"}</p>
          </div>
        )}
        {!loading && filtered.map(email => {
          const name  = email.from?.emailAddress?.name || email.from?.emailAddress?.address || "?";
          const isAct = selectedId === email.id;
          return (
            <button key={email.id} onClick={() => openEmail(email)}
              className={"w-full text-left px-3 py-3 border-b border-gray-50 hover:bg-gray-50 transition-colors cursor-pointer border-none" + (!email.isRead ? " bg-blue-50/30" : "")}
              style={{ borderLeft: isAct ? "2px solid #6366F1" : "2px solid transparent", background: isAct ? "#EEF2FF" : undefined }}>
              <div className="flex items-center gap-2.5 mb-1">
                <div className="w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold text-white shrink-0" style={{ background: avatarColor(name) }}>
                  {initials(name)}
                </div>
                <div className="flex-1 min-w-0">
                  <span className={"text-[12px] truncate block " + (!email.isRead ? "font-bold text-gray-900" : "font-medium text-gray-700")}>{name}</span>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  {email.hasAttachments && (
                    <svg width="10" height="10" fill="none" stroke="#9CA3AF" strokeWidth="2" viewBox="0 0 24 24">
                      <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/>
                    </svg>
                  )}
                  <span className="text-[10px] text-gray-400">{fmtDate(email.receivedDateTime)}</span>
                  {!email.isRead && <div className="w-1.5 h-1.5 rounded-full bg-indigo-500 shrink-0" />}
                </div>
              </div>
              <p className={"text-[11px] truncate pl-9 " + (!email.isRead ? "text-gray-700 font-semibold" : "text-gray-500")}>{email.subject || "(no subject)"}</p>
              <p className="text-[11px] text-gray-400 truncate pl-9 mt-0.5">{email.bodyPreview}</p>
            </button>
          );
        })}
      </div>
    </div>
  );

  // ── Detail panel ──────────────────────────────────────────────────────
  const DetailPanel = (
    <div className={"flex-1 flex flex-col bg-white min-w-0 " + (isMobile && mobileView === "list" ? "hidden" : "flex")}>
      {!selected ? (
        <div className="flex-1 flex flex-col items-center justify-center text-gray-400 gap-3">
          <svg width="40" height="40" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24" className="opacity-30">
            <path d="M20 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 4-8 5-8-5V6l8 5 8-5v2z"/>
          </svg>
          <p className="text-[13px]">Select an email to read</p>
        </div>
      ) : (
        <div className="flex flex-col h-full">

          {/* Header */}
          <div className="px-5 py-4 border-b border-gray-100 bg-white shrink-0">
            {isMobile && (
              <button onClick={() => setMobileView("list")} className="flex items-center gap-1 text-indigo-600 text-[12px] font-medium mb-3 border-none bg-transparent cursor-pointer">
                <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><polyline points="15 18 9 12 15 6"/></svg>
                Back
              </button>
            )}
            <h2 className="text-[15px] font-bold text-gray-900 mb-3 leading-snug">{selected.subject || "(no subject)"}</h2>

            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="w-8 h-8 rounded-full flex items-center justify-center text-[11px] font-bold text-white shrink-0"
                  style={{ background: avatarColor(selected.from?.emailAddress?.name || "?") }}>
                  {initials(selected.from?.emailAddress?.name || "?")}
                </div>
                <div className="min-w-0">
                  <div className="text-[12px] font-semibold text-gray-800 truncate">{selected.from?.emailAddress?.name}</div>
                  <div className="text-[11px] text-gray-400 truncate">{selected.from?.emailAddress?.address}</div>
                </div>
              </div>

              <div className="flex items-center gap-1.5 shrink-0">
                <span className="text-[11px] text-gray-400">{new Date(selected.receivedDateTime).toLocaleString()}</span>

                {/* Mark read/unread — label and icon always reflect live state from emails[] */}
                <button
                  onClick={() => toggleRead(selected)}
                  title={selected.isRead ? "Mark as unread" : "Mark as read"}
                  className="flex items-center gap-1 px-2 h-7 rounded-lg border bg-white text-[10px] font-medium cursor-pointer hover:bg-gray-50 transition-colors"
                  style={{
                    color: selected.isRead ? "#6B7280" : "#6366F1",
                    borderColor: selected.isRead ? "#E5E7EB" : "#A5B4FC",
                  }}>
                  {selected.isRead ? (
                    <svg width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                      <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
                      <polyline points="9 22 9 12 15 12 15 22"/>
                    </svg>
                  ) : (
                    <svg width="9" height="9" fill="#6366F1" viewBox="0 0 10 10">
                      <circle cx="5" cy="5" r="5"/>
                    </svg>
                  )}
                  {selected.isRead ? "Mark unread" : "Mark read"}
                </button>

                <button onClick={() => deleteEmail(selected.id)} title="Delete"
                  className="w-7 h-7 rounded-lg border border-gray-200 bg-white flex items-center justify-center cursor-pointer hover:bg-red-50 hover:border-red-200 transition-colors">
                  <svg width="11" height="11" fill="none" stroke="#EF4444" strokeWidth="2" viewBox="0 0 24 24">
                    <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/>
                  </svg>
                </button>
              </div>
            </div>

            {/* Action buttons */}
            <div className="flex gap-2 mt-3">
              <button
                onClick={() => { setReplyTo(selected); setForwardOf(null); }}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-200 bg-white text-[11px] font-medium text-gray-600 cursor-pointer hover:bg-indigo-50 hover:text-indigo-600 hover:border-indigo-200 transition-colors">
                <svg width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><polyline points="9 17 4 12 9 7"/><path d="M20 18v-2a4 4 0 0 0-4-4H4"/></svg>
                Reply
              </button>
              <button
                onClick={() => { setForwardOf(selected); setReplyTo(null); setCompose(true); }}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-200 bg-white text-[11px] font-medium text-gray-600 cursor-pointer hover:bg-indigo-50 hover:text-indigo-600 hover:border-indigo-200 transition-colors">
                <svg width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><polyline points="15 10 20 15 15 20"/><path d="M4 4h7a4 4 0 0 1 4 4v7"/></svg>
                Forward
              </button>
              <button
                onClick={() => deleteEmail(selected.id)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-200 bg-white text-[11px] font-medium text-red-400 cursor-pointer hover:bg-red-50 hover:border-red-200 transition-colors">
                <svg width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/></svg>
                Delete
              </button>
            </div>
          </div>

          {/* Body */}
          <div className="flex-1 overflow-y-auto px-5 py-4">
            {selected.body ? (
              selected.body.contentType === "html" ? (
                <iframe
                  srcDoc={"<style>html,body{background:#fff!important;color:#1f2937!important;font-family:system-ui,sans-serif;font-size:14px;line-height:1.6;margin:0;padding:12px}a{color:#4F6FF0}*{max-width:100%;box-sizing:border-box}</style>" + selected.body.content}
                  className="w-full border-0"
                  style={{ minHeight: 400, height: "100%" }}
                  sandbox="allow-same-origin"
                  title="email-body"
                />
              ) : (
                <pre className="text-[13px] text-gray-700 whitespace-pre-wrap font-sans leading-relaxed">{selected.body.content}</pre>
              )
            ) : (
              <p className="text-[13px] text-gray-500 italic">{selected.bodyPreview}</p>
            )}
          </div>

          {/* Footer: Open in Outlook */}
          <div className="shrink-0 px-5 py-3 border-t border-gray-100 bg-gray-50/80 flex items-center justify-between">
            <span className="text-[11px] text-gray-400 flex items-center gap-1.5">
              {selected.hasAttachments && (
                <>
                  <svg width="10" height="10" fill="none" stroke="#9CA3AF" strokeWidth="2" viewBox="0 0 24 24">
                    <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/>
                  </svg>
                  Has attachments
                </>
              )}
            </span>
            <a
              href={selected.webLink ?? "https://outlook.live.com/mail/0/inbox"}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 text-[11px] font-semibold text-indigo-600 hover:text-indigo-800 transition-colors"
              style={{ textDecoration: "none" }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                <rect x="2" y="2" width="9" height="9" fill="#F25022"/>
                <rect x="13" y="2" width="9" height="9" fill="#7FBA00"/>
                <rect x="2" y="13" width="9" height="9" fill="#00A4EF"/>
                <rect x="13" y="13" width="9" height="9" fill="#FFB900"/>
              </svg>
              Open in Outlook
              <svg width="10" height="10" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
                <polyline points="15 3 21 3 21 9"/>
                <line x1="10" y1="14" x2="21" y2="3"/>
              </svg>
            </a>
          </div>

        </div>
      )}
    </div>
  );

  return (
    <div className="flex-1 flex overflow-hidden">
      {/* Sidebar */}
      <aside className={"flex flex-col shrink-0 border-r border-gray-100 bg-gray-50 " + (isMobile ? "hidden" : "w-44")}>
        <div className="px-3 py-4">
          <button onClick={() => { setCompose(true); setForwardOf(null); setReplyTo(null); }}
            className="w-full py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-[12px] font-semibold rounded-xl cursor-pointer border-none flex items-center justify-center gap-1.5 transition-colors shadow-sm">
            <svg width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            Compose
          </button>
        </div>
        <nav className="flex-1 px-2">
          {FOLDERS.map(f => (
            <button key={f.id} onClick={() => { setFolder(f.id); setSelectedId(null); setMobileView("list"); }}
              className={"w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-[12px] font-medium mb-0.5 cursor-pointer border-none transition-colors text-left " + (folder === f.id ? "bg-indigo-50 text-indigo-700" : "bg-transparent text-gray-500 hover:bg-gray-100 hover:text-gray-800")}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill={folder === f.id ? "#6366F1" : "#9CA3AF"}>
                <path d={f.icon}/>
              </svg>
              <span className="flex-1 truncate">{f.label}</span>
              {(unread[f.id] ?? 0) > 0 && (
                <span className="text-[9px] bg-indigo-500 text-white rounded-full px-1.5 py-0.5 font-bold shrink-0">{unread[f.id]}</span>
              )}
            </button>
          ))}
        </nav>
        {me && (
          <div className="px-3 py-3 border-t border-gray-200 mt-auto">
            <div className="flex items-center gap-2 min-w-0">
              <div className="w-6 h-6 rounded-full flex items-center justify-center text-[9px] font-bold text-white shrink-0"
                style={{ background: avatarColor(me.displayName) }}>
                {initials(me.displayName)}
              </div>
              <div className="min-w-0">
                <div className="text-[10px] font-semibold text-gray-700 truncate">{me.displayName}</div>
                <div className="text-[9px] text-gray-400 truncate">{me.mail}</div>
              </div>
            </div>
            <button onClick={() => {
              localStorage.removeItem(TOKEN_KEY);
              localStorage.removeItem(REFRESH_KEY);
              localStorage.removeItem(EXPIRY_KEY);
              setToken(null); setEmails([]); setMe(null);
            }} className="mt-2 w-full text-[10px] text-gray-400 hover:text-red-500 cursor-pointer border-none bg-transparent text-left transition-colors">
              Sign out
            </button>
          </div>
        )}
      </aside>

      {/* Mobile compose FAB */}
      {isMobile && (
        <div className="fixed bottom-16 right-4 z-40">
          <button onClick={() => { setCompose(true); setForwardOf(null); setReplyTo(null); }}
            className="w-12 h-12 rounded-full bg-indigo-600 text-white shadow-lg flex items-center justify-center cursor-pointer border-none hover:bg-indigo-700">
            <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          </button>
        </div>
      )}

      {ListPanel}
      {DetailPanel}

      {/* Compose (new or forward) */}
      {compose && !replyTo && (
        <ComposeModal
          token={token}
          onClose={() => { setCompose(false); setForwardOf(null); }}
          prefill={forwardOf ? {
            subject: "Fwd: " + forwardOf.subject,
            body: "\n\n---------- Forwarded message ----------\nFrom: " + forwardOf.from?.emailAddress?.name + " <" + forwardOf.from?.emailAddress?.address + ">\nDate: " + new Date(forwardOf.receivedDateTime).toLocaleString() + "\nSubject: " + forwardOf.subject + "\n\n" + forwardOf.bodyPreview,
          } : undefined}
        />
      )}

      {/* Reply */}
      {replyTo && (
        <ComposeModal
          token={token}
          onClose={() => setReplyTo(null)}
          prefill={{
            to:      replyTo.from?.emailAddress?.address,
            subject: "Re: " + replyTo.subject,
            body:    "\n\n---\nOn " + new Date(replyTo.receivedDateTime).toLocaleString() + ", " + replyTo.from?.emailAddress?.name + " wrote:\n" + replyTo.bodyPreview,
          }}
        />
      )}
    </div>
  );
}