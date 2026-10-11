// components/admin/EmailTab.tsx
// Outlook inbox for the signed-in admin.
//
// Styled with the ERP's dark palette (#0a0a0a, #ededed, ...), which globals.css
// remaps when the ERP is switched to light mode, so the tab follows the theme
// instead of always rendering light.
//
// Sign-in: when MS_MAIL_CLIENT_SECRET is set, the connection is kept on the
// server for each admin (lib/outlook.ts) and lasts until it is disconnected or
// goes unused for 90 days. Without it the tab falls back to the older
// browser-only sign-in, which Microsoft limits to about a day at a time.
"use client";
import { useState, useEffect, useCallback, useContext, useRef } from "react";
import { Spinner, useIsMobile, AdminTokenContext } from "./admin-shared";

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
const VERIFIER_KEY = "ms_pkce_verifier";

const FOLDERS = [
  { id: "inbox",        label: "Inbox",  icon: "M20 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 4-8 5-8-5V6l8 5 8-5v2z" },
  { id: "sentitems",    label: "Sent",   icon: "M2.01 21 23 12 2.01 3 2 10l15 2-15 2z" },
  { id: "drafts",       label: "Drafts", icon: "M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z" },
  { id: "junkemail",    label: "Junk",   icon: "M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z" },
  { id: "deleteditems", label: "Trash",  icon: "M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z" },
] as const;

const CALLBACK_ERRORS: Record<string, string> = {
  outlook_denied: "Microsoft sign-in was cancelled.",
  outlook_state: "That sign-in link expired. Try connecting again.",
  outlook_token_failed: "Microsoft did not accept the sign-in. Check the app's client secret and redirect URI.",
};

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
  return ((p[0]?.[0] ?? "?") + (p[1]?.[0] ?? "")).toUpperCase();
}

function avatarColor(name: string) {
  const cols = ["#6366F1","#8B5CF6","#EC4899","#F59E0B","#10B981","#3B82F6","#EF4444","#14B8A6"];
  let h = 0;
  for (let i = 0; i < name.length; i++) h = name.charCodeAt(i) + ((h << 5) - h);
  return cols[Math.abs(h) % cols.length];
}

const isLightTheme = () => typeof document !== "undefined" && document.documentElement.dataset.theme === "light";

/** HTML emails are written for white pages; restyle them to match the theme. */
function emailDoc(html: string) {
  const light = isLightTheme();
  const bg = light ? "#ffffff" : "#0a0a0a", fg = light ? "#1f2937" : "#d4d4d4", link = light ? "#4F6FF0" : "#8b9cf7";
  return `<base target="_blank"><style>html,body{background:${bg}!important;font-family:system-ui,sans-serif;font-size:14px;line-height:1.6;margin:0;padding:4px 2px}*{color:${fg}!important;max-width:100%;box-sizing:border-box;border-color:${light ? "#e5e7eb" : "#262626"}!important}a,a *{color:${link}!important}td,th,div,p,span,h1,h2,h3,h4,h5,h6,li,table,center,section,article,header,footer{background-color:${bg}!important;background-image:none!important}img{height:auto}</style>${html}`;
}

// ── Browser-only sign-in (fallback when the server connection isn't set up) ──

async function generatePKCE(): Promise<{ verifier: string; challenge: string }> {
  const array    = crypto.getRandomValues(new Uint8Array(32));
  const verifier = btoa(String.fromCharCode(...Array.from(array)))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
  const digest   = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  const challenge = btoa(String.fromCharCode(...Array.from(new Uint8Array(digest))))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
  return { verifier, challenge };
}

async function startBrowserOAuth(): Promise<void> {
  const { verifier, challenge } = await generatePKCE();
  localStorage.setItem(VERIFIER_KEY, verifier);
  const clientId    = process.env.NEXT_PUBLIC_MS_CLIENT_ID ?? "";
  const tenantId    = process.env.NEXT_PUBLIC_MS_TENANT_ID ?? "common";
  const redirectUri = encodeURIComponent(window.location.href.split("?")[0].split("#")[0]);
  // The account picker only on the first sign-in on this browser.
  const firstTime   = !localStorage.getItem(REFRESH_KEY) && !localStorage.getItem("ms_email_connected_once");
  window.location.href =
    "https://login.microsoftonline.com/" + tenantId + "/oauth2/v2.0/authorize" +
    "?client_id=" + clientId +
    "&response_type=code" +
    "&redirect_uri=" + redirectUri +
    "&scope=" + encodeURIComponent(SCOPES) +
    "&response_mode=query" +
    "&code_challenge=" + challenge +
    "&code_challenge_method=S256" +
    (firstTime ? "&prompt=select_account" : "");
}

interface TokenResponse { access_token: string; refresh_token?: string; expires_in?: number }

function persistTokens(data: TokenResponse) {
  localStorage.setItem(TOKEN_KEY, data.access_token);
  if (data.refresh_token) localStorage.setItem(REFRESH_KEY, data.refresh_token);
  localStorage.setItem(EXPIRY_KEY, String(Date.now() + ((data.expires_in ?? 3600) - 60) * 1000));
  localStorage.setItem("ms_email_connected_once", "1");
}
function clearBrowserTokens() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(REFRESH_KEY);
  localStorage.removeItem(EXPIRY_KEY);
}

async function fetchToken(body: URLSearchParams): Promise<TokenResponse> {
  const tenantId = process.env.NEXT_PUBLIC_MS_TENANT_ID ?? "common";
  const res = await fetch("https://login.microsoftonline.com/" + tenantId + "/oauth2/v2.0/token",
    { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body });
  if (!res.ok) {
    const e = await res.json().catch(() => ({})) as { error_description?: string };
    throw new Error(e.error_description ?? "Token request failed");
  }
  return res.json() as Promise<TokenResponse>;
}

async function exchangeCode(code: string): Promise<string> {
  const data = await fetchToken(new URLSearchParams({
    grant_type:    "authorization_code",
    code,
    client_id:     process.env.NEXT_PUBLIC_MS_CLIENT_ID ?? "",
    redirect_uri:  window.location.href.split("?")[0].split("#")[0],
    code_verifier: localStorage.getItem(VERIFIER_KEY) ?? "",
    scope:         SCOPES,
  }));
  localStorage.removeItem(VERIFIER_KEY);
  persistTokens(data);
  return data.access_token;
}

async function browserToken(force = false): Promise<string | null> {
  const tok    = localStorage.getItem(TOKEN_KEY);
  const expiry = parseInt(localStorage.getItem(EXPIRY_KEY) ?? "0", 10);
  if (!force && tok && Date.now() < expiry) return tok;
  const refreshToken = localStorage.getItem(REFRESH_KEY);
  if (!refreshToken) return null;
  try {
    const data = await fetchToken(new URLSearchParams({
      grant_type: "refresh_token", refresh_token: refreshToken,
      client_id: process.env.NEXT_PUBLIC_MS_CLIENT_ID ?? "", scope: SCOPES,
    }));
    persistTokens(data);
    return data.access_token;
  } catch {
    clearBrowserTokens();
    return null;
  }
}

class AuthError extends Error {}

async function graphFetch<T>(path: string, token: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(GRAPH + path, {
    ...opts,
    headers: { Authorization: "Bearer " + token, "Content-Type": "application/json", ...(opts?.headers ?? {}) },
  });
  if (res.status === 401) throw new AuthError("Signed out of Microsoft");
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: { message: res.statusText } })) as { error?: { message?: string } };
    throw new Error(err?.error?.message ?? res.statusText);
  }
  if (res.status === 204) return {} as T;
  return res.json() as Promise<T>;
}

// ─── Small UI pieces ──────────────────────────────────────────────────────────

const MsLogo = ({ size = 18 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <rect x="2" y="2" width="9" height="9" fill="#F25022"/>
    <rect x="13" y="2" width="9" height="9" fill="#7FBA00"/>
    <rect x="2" y="13" width="9" height="9" fill="#00A4EF"/>
    <rect x="13" y="13" width="9" height="9" fill="#FFB900"/>
  </svg>
);

const btnGhost = "flex items-center gap-1.5 px-3 h-8 rounded-lg border border-[#2a2a2a] bg-transparent text-[12px] font-medium text-[#aaa] cursor-pointer hover:text-[#ededed] hover:border-[#444] transition-colors";
const btnPrimary = "flex items-center justify-center gap-1.5 px-4 h-9 rounded-lg bg-[#ededed] text-black text-[13px] font-semibold border-none cursor-pointer hover:bg-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors";

// ─── Not-configured screen ────────────────────────────────────────────────────

function NotConfigured() {
  const steps = [
    { title: "Create an App Registration", body: "In portal.azure.com open App registrations, choose New registration, allow accounts in any directory and personal Microsoft accounts, then Register." },
    { title: "Copy the IDs", body: "From the Overview page copy the Application (client) ID and Directory (tenant) ID." },
    { title: "Add Mail permissions", body: "API permissions, Add a permission, Microsoft Graph, Delegated: Mail.Read, Mail.Send, Mail.ReadWrite. Then grant admin consent." },
    { title: "Add a client secret and redirect URI", body: "Certificates & secrets, New client secret. Authentication, Add a platform, Web, and enter <ERP URL>/api/auth/callback/outlook." },
    { title: "Set the env vars", body: "NEXT_PUBLIC_MS_CLIENT_ID, NEXT_PUBLIC_MS_TENANT_ID and MS_MAIL_CLIENT_SECRET, then redeploy." },
  ];
  return (
    <div className="flex-1 flex items-center justify-center bg-[#000] p-6 overflow-y-auto">
      <div className="max-w-lg w-full">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-11 h-11 rounded-xl bg-[#111] border border-[#1a1a1a] flex items-center justify-center shrink-0"><MsLogo size={24} /></div>
          <div>
            <h2 className="text-[16px] font-semibold text-[#ededed]">Outlook is not set up</h2>
            <p className="text-[13px] text-[#888]">Connect a Microsoft app to read and send email here.</p>
          </div>
        </div>
        <ol className="bg-[#0a0a0a] border border-[#1a1a1a] rounded-xl list-none m-0 p-0">
          {steps.map((s, i) => (
            <li key={s.title} className="flex items-start gap-3 px-4 py-3 border-0 border-b border-solid border-[#141414] last:border-b-0">
              <span className="w-5 h-5 rounded-full bg-[#1a1a1a] text-[#ccc] text-[11px] font-semibold flex items-center justify-center shrink-0 mt-0.5">{i + 1}</span>
              <div>
                <p className="text-[13px] font-semibold text-[#ddd] mb-0.5">{s.title}</p>
                <p className="text-[12px] text-[#888] leading-relaxed">{s.body}</p>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}

// ─── Compose Modal ────────────────────────────────────────────────────────────

function ComposeModal({
  getToken, onClose, prefill,
}: {
  getToken: () => Promise<string | null>;
  onClose: () => void;
  prefill?: { to?: string; subject?: string; body?: string };
}) {
  const [to,      setTo]      = useState(prefill?.to ?? "");
  const [subject, setSubject] = useState(prefill?.subject ?? "");
  const [body,    setBody]    = useState(prefill?.body ?? "");
  const [sending, setSending] = useState(false);
  const [err,     setErr]     = useState("");
  const [sent,    setSent]    = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const send = async () => {
    if (!to.trim() || !subject.trim()) return;
    setSending(true); setErr("");
    try {
      const token = await getToken();
      if (!token) throw new Error("Reconnect Outlook to send.");
      await graphFetch("/me/sendMail", token, {
        method: "POST",
        body: JSON.stringify({
          message: {
            subject,
            body: { contentType: "Text", content: body },
            toRecipients: to.split(",").map(a => ({ emailAddress: { address: a.trim() } })).filter(r => r.emailAddress.address),
          },
          saveToSentItems: true,
        }),
      });
      setSent(true);
      setTimeout(onClose, 1000);
    } catch (e) { setErr((e as Error).message); }
    finally { setSending(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/70 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="bg-[#0a0a0a] border border-[#2a2a2a] rounded-2xl shadow-2xl w-full max-w-2xl flex flex-col" style={{ maxHeight: "90vh" }} onClick={e => e.stopPropagation()}
        role="dialog" aria-modal="true" aria-label="New message">
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-[#1a1a1a]">
          <span className="text-[14px] font-semibold text-[#ededed]">{prefill?.subject?.startsWith("Re:") ? "Reply" : prefill?.subject?.startsWith("Fwd:") ? "Forward" : "New message"}</span>
          <button onClick={onClose} aria-label="Close" className="w-7 h-7 rounded-md hover:bg-[#1a1a1a] flex items-center justify-center cursor-pointer border-none bg-transparent text-[#888] hover:text-[#ededed]">
            <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
        <div className="flex-1 overflow-y-auto">
          {[
            { label: "To",      value: to,      onChange: setTo,      placeholder: "recipient@example.com, ..." },
            { label: "Subject", value: subject, onChange: setSubject, placeholder: "Subject" },
          ].map(f => (
            <div key={f.label} className="flex items-center gap-3 px-5 py-2.5 border-b border-[#141414]">
              <span className="text-[12px] font-medium text-[#666] w-14 shrink-0">{f.label}</span>
              <input value={f.value} onChange={e => f.onChange(e.target.value)} placeholder={f.placeholder}
                className="flex-1 text-[14px] border-none outline-none bg-transparent text-[#ededed] placeholder:text-[#444] font-[inherit]" />
            </div>
          ))}
          <textarea value={body} onChange={e => setBody(e.target.value)} placeholder="Write your message..."
            className="w-full resize-none text-[14px] text-[#ddd] px-5 py-4 border-none outline-none bg-transparent placeholder:text-[#444] font-[inherit] leading-relaxed"
            rows={12} />
        </div>
        <div className="flex items-center justify-between px-5 py-3 border-t border-[#1a1a1a] gap-3">
          {err  && <span className="text-[13px] text-[#f44] flex-1 truncate">{err}</span>}
          {sent && <span className="text-[13px] text-[#3ecf8e] font-semibold flex-1">Sent</span>}
          {!err && !sent && <span className="flex-1" />}
          <button onClick={onClose} className="px-3 h-9 text-[13px] font-medium text-[#888] hover:text-[#ededed] border-none bg-transparent cursor-pointer">Cancel</button>
          <button onClick={send} disabled={sending || !to.trim() || !subject.trim() || sent} className={btnPrimary}>
            {sending ? <Spinner size={12} /> : <svg width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>}
            {sending ? "Sending..." : "Send"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Sign-in screen ───────────────────────────────────────────────────────────

function SignInScreen({ error, onConnect, busy, server }: { error?: string; onConnect: () => void; busy: boolean; server: boolean }) {
  return (
    <div className="flex-1 flex items-center justify-center bg-[#000] p-8">
      <div className="text-center max-w-sm w-full">
        <div className="w-14 h-14 rounded-2xl bg-[#111] border border-[#1a1a1a] flex items-center justify-center mx-auto mb-5"><MsLogo size={28} /></div>
        <h2 className="text-[17px] font-semibold text-[#ededed] mb-1.5">Connect Outlook</h2>
        <p className="text-[14px] text-[#888] mb-6 leading-relaxed">
          {server
            ? "Sign in with Microsoft once. The ERP keeps you connected on every device you use it on."
            : "Sign in with Microsoft to read and send email."}
        </p>
        <button onClick={onConnect} disabled={busy} className={btnPrimary + " w-full h-10"}>
          {busy ? <Spinner size={13} /> : <MsLogo size={15} />}
          Continue with Microsoft
        </button>
        {!server && (
          <p className="text-[12px] text-[#555] mt-4 leading-relaxed">
            Microsoft ends this kind of sign-in after about a day. Add MS_MAIL_CLIENT_SECRET to the ERP to stay signed in.
          </p>
        )}
        {error && <div className="mt-4 p-3 rounded-lg text-[13px] text-[#f44] bg-[rgba(255,68,68,0.06)] border border-[rgba(255,68,68,0.2)]">{error}</div>}
      </div>
    </div>
  );
}

// ─── Main EmailTab ─────────────────────────────────────────────────────────────

export default function EmailTab({ onUnreadChange }: { onUnreadChange?: (count: number) => void } = {}) {
  const isMobile     = useIsMobile();
  const adminToken   = useContext(AdminTokenContext);
  const isConfigured = !!(process.env.NEXT_PUBLIC_MS_CLIENT_ID);

  // null while checking; true = connection held by the ERP server
  const [server,     setServer]     = useState<boolean | null>(null);
  const [checking,   setChecking]   = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [token,      setToken]      = useState<string | null>(null);
  const expiresAt = useRef(0);
  const [folder,     setFolder]     = useState("inbox");
  const [emails,     setEmails]     = useState<MSEmail[]>([]);
  const [loading,    setLoading]    = useState(false);
  const [error,      setError]      = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [compose,    setCompose]    = useState(false);
  const [replyTo,    setReplyTo]    = useState<MSEmail | null>(null);
  const [forwardOf,  setForwardOf]  = useState<MSEmail | null>(null);
  const [search,     setSearch]     = useState("");
  const [otherFolderUnread, setOtherFolderUnread] = useState<Record<string, number>>({});
  const [me,         setMe]         = useState<{ displayName: string; mail: string; userPrincipalName?: string } | null>(null);
  const [mobileView, setMobileView] = useState<"list" | "detail">("list");

  const selected = emails.find(e => e.id === selectedId) ?? null;

  const unread: Record<string, number> = {
    ...otherFolderUnread,
    [folder]: emails.filter(e => !e.isRead).length,
  };
  const inboxUnread = folder === "inbox" ? emails.filter(e => !e.isRead).length : (otherFolderUnread["inbox"] ?? 0);
  useEffect(() => { onUnreadChange?.(inboxUnread); }, [inboxUnread, onUnreadChange]);

  // ── Tokens ────────────────────────────────────────────────────────────
  /** Ask the ERP server for this admin's access token. */
  const serverToken = useCallback(async (): Promise<{ server: boolean; token: string | null; error?: string }> => {
    const r = await fetch("/api/email/token", { headers: adminToken ? { "x-admin-token": adminToken } : {}, cache: "no-store" });
    const j = await r.json().catch(() => ({})) as { server?: boolean; connected?: boolean; token?: string; expiresAt?: number; error?: string };
    if (j.token) expiresAt.current = j.expiresAt ?? Date.now() + 50 * 60_000;
    return { server: !!j.server, token: j.token ?? null, error: j.error };
  }, [adminToken]);

  /** A token that is good for at least another minute, renewing it if needed. */
  const getToken = useCallback(async (force = false): Promise<string | null> => {
    if (!force && token && expiresAt.current > Date.now() + 60_000) return token;
    const t = server ? (await serverToken()).token : await browserToken(force);
    if (!server && t) expiresAt.current = parseInt(localStorage.getItem(EXPIRY_KEY) ?? "0", 10);
    setToken(t);
    return t;
  }, [token, server, serverToken]);

  // ── Restore the connection / handle the browser OAuth callback ─────────
  useEffect(() => {
    if (!isConfigured || !adminToken) return;
    void Promise.resolve().then(async () => {
      const params = new URLSearchParams(window.location.search);
      const cbError = params.get("error");
      if (cbError && CALLBACK_ERRORS[cbError]) {
        // Microsoft's own reason, when it gave one (an AADSTS code and message).
        const msDesc = params.get("ms_desc");
        setError(msDesc ? `Microsoft said: ${msDesc}` : CALLBACK_ERRORS[cbError]);
      }
      if (params.get("connected") === "outlook" || cbError?.startsWith("outlook_")) {
        params.delete("connected"); params.delete("error"); params.delete("ms_error"); params.delete("ms_desc");
        window.history.replaceState(null, "", window.location.pathname + (params.toString() ? `?${params}` : ""));
      }
      try {
        const s = await serverToken();
        setServer(s.server);
        if (s.server) {
          if (s.token) setToken(s.token);
          else if (s.error) setError(s.error);
          return;
        }
      } catch { setServer(false); }
      // Browser-only fallback.
      const code = params.get("code");
      if (code) {
        try {
          setToken(await exchangeCode(code));
          expiresAt.current = parseInt(localStorage.getItem(EXPIRY_KEY) ?? "0", 10);
        } catch (e) { setError((e as Error).message); }
        window.history.replaceState(null, "", window.location.pathname);
        return;
      }
      const tok = await browserToken();
      if (tok) { expiresAt.current = parseInt(localStorage.getItem(EXPIRY_KEY) ?? "0", 10); setToken(tok); }
    }).finally(() => setChecking(false));
  }, [isConfigured, adminToken, serverToken]);

  // Renew quietly a little before the access token expires.
  useEffect(() => {
    if (!token) return;
    const ms = Math.max(30_000, expiresAt.current - Date.now() - 2 * 60_000);
    const t = setTimeout(() => { void getToken(true); }, ms);
    return () => clearTimeout(t);
  }, [token, getToken]);

  const connect = async () => {
    setError("");
    if (!server) { void startBrowserOAuth(); return; }
    setConnecting(true);
    try {
      const r = await fetch("/api/auth/outlook", { headers: adminToken ? { "x-admin-token": adminToken } : {} });
      const j = await r.json() as { url?: string; error?: string };
      if (!j.url) throw new Error(j.error ?? "Could not start the Microsoft sign-in");
      window.location.href = j.url;
    } catch (e) { setError((e as Error).message); setConnecting(false); }
  };

  const disconnect = async () => {
    if (server) {
      await fetch("/api/email/token", { method: "DELETE", headers: adminToken ? { "x-admin-token": adminToken } : {} }).catch(() => {});
    } else {
      clearBrowserTokens();
    }
    setToken(null); setEmails([]); setMe(null);
  };

  /** Graph call that renews the token once on a 401 before giving up. */
  const graph = useCallback(async <T,>(path: string, opts?: RequestInit): Promise<T> => {
    const t = await getToken();
    if (!t) throw new AuthError("Signed out of Microsoft");
    try { return await graphFetch<T>(path, t, opts); }
    catch (e) {
      if (!(e instanceof AuthError)) throw e;
      const t2 = await getToken(true);
      if (!t2) { setToken(null); throw e; }
      return graphFetch<T>(path, t2, opts);
    }
  }, [getToken]);
  // Keep a stable handle for effects so a renewed token doesn't refetch the list.
  const graphRef = useRef(graph);
  useEffect(() => { graphRef.current = graph; }, [graph]);
  const connected = !!token;

  // ── User profile ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!connected) return;
    graphRef.current<{ displayName: string; mail: string; userPrincipalName?: string }>("/me?$select=displayName,mail,userPrincipalName")
      .then(setMe).catch(() => {});
  }, [connected]);

  // ── Load emails ───────────────────────────────────────────────────────
  const loadEmails = useCallback((folderId: string) => {
    void Promise.resolve()
      .then(() => {
        setLoading(true); setError(""); setSelectedId(null);
        return graphRef.current<{ value: MSEmail[] }>(
          "/me/mailFolders/" + folderId + "/messages?$top=40&$select=id,subject,bodyPreview,from,toRecipients,receivedDateTime,isRead,hasAttachments,importance,webLink&$orderby=receivedDateTime desc",
        );
      })
      .then(data => { setEmails(data.value ?? []); setLoading(false); })
      .catch(e => {
        if (!(e instanceof AuthError)) setError((e as Error).message);
        setLoading(false);
      });
  }, []);

  useEffect(() => { if (connected) loadEmails(folder); }, [folder, connected, loadEmails]);

  // ── Unread counts for the other folders ───────────────────────────────
  useEffect(() => {
    if (!connected) return;
    Promise.all(
      FOLDERS.filter(f => f.id !== folder).map(f =>
        graphRef.current<{ unreadItemCount: number }>("/me/mailFolders/" + f.id + "?$select=unreadItemCount")
          .then(r => [f.id, r.unreadItemCount] as const)
          .catch(() => [f.id, 0] as const)
      )
    ).then(results => setOtherFolderUnread(Object.fromEntries(results)));
  }, [connected, folder]);

  // ── Open email ────────────────────────────────────────────────────────
  const openEmail = useCallback(async (email: MSEmail) => {
    setSelectedId(email.id);
    if (isMobile) setMobileView("detail");
    if (!email.isRead) {
      setEmails(prev => prev.map(e => e.id === email.id ? { ...e, isRead: true } : e));
      graph("/me/messages/" + email.id, { method: "PATCH", body: JSON.stringify({ isRead: true }) }).catch(() => {});
    }
    if (!email.body) {
      try {
        const full = await graph<MSEmail>("/me/messages/" + email.id + "?$select=id,subject,body,from,toRecipients,receivedDateTime,isRead,hasAttachments,webLink");
        setEmails(prev => prev.map(e => e.id === full.id ? { ...e, body: full.body, webLink: full.webLink, isRead: true } : e));
      } catch {}
    }
  }, [graph, isMobile]);

  const deleteEmail = useCallback(async (id: string) => {
    setEmails(prev => prev.filter(e => e.id !== id));
    setSelectedId(null);
    if (isMobile) setMobileView("list");
    graph("/me/messages/" + id, { method: "DELETE" }).catch(() => {});
  }, [graph, isMobile]);

  const toggleRead = useCallback(async (email: MSEmail) => {
    const newVal = !email.isRead;
    setEmails(prev => prev.map(e => e.id === email.id ? { ...e, isRead: newVal } : e));
    graph("/me/messages/" + email.id, { method: "PATCH", body: JSON.stringify({ isRead: newVal }) })
      .catch(() => setEmails(prev => prev.map(e => e.id === email.id ? { ...e, isRead: email.isRead } : e)));
  }, [graph]);

  const q = search.trim().toLowerCase();
  const filtered = q
    ? emails.filter(e =>
        e.subject?.toLowerCase().includes(q) ||
        e.from?.emailAddress?.name?.toLowerCase().includes(q) ||
        e.from?.emailAddress?.address?.toLowerCase().includes(q) ||
        e.bodyPreview?.toLowerCase().includes(q))
    : emails;

  if (!isConfigured) return <NotConfigured />;
  if (checking) return <div className="flex-1 flex items-center justify-center bg-[#000]"><Spinner size={20} /></div>;
  if (!token) return <SignInScreen error={error || undefined} onConnect={() => void connect()} busy={connecting} server={!!server} />;

  // ── List panel ────────────────────────────────────────────────────────
  const ListPanel = (
    <div className={"flex flex-col border-r border-[#1a1a1a] bg-[#050505] min-h-0 " + (isMobile ? "flex-1" : "w-80 shrink-0") + " " + (isMobile && mobileView === "detail" ? "hidden" : "flex")}>
      <div className="px-3 pt-3 pb-2 border-b border-[#1a1a1a] space-y-2">
        <div className="flex items-center gap-2">
          <div className="flex-1 flex items-center gap-2 bg-[#0a0a0a] border border-[#2a2a2a] rounded-lg px-3 h-8 focus-within:border-[#555] transition-colors">
            <svg width="12" height="12" fill="none" stroke="#555" strokeWidth="2" viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search mail"
              className="flex-1 min-w-0 text-[13px] bg-transparent border-none outline-none text-[#ededed] placeholder:text-[#444] font-[inherit]" />
          </div>
          <button onClick={() => loadEmails(folder)} title="Refresh" aria-label="Refresh"
            className="w-8 h-8 rounded-lg border border-[#2a2a2a] bg-transparent flex items-center justify-center cursor-pointer text-[#888] hover:text-[#ededed] hover:border-[#444] shrink-0">
            {loading ? <Spinner size={11} /> : (
              <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path d="M23 4v6h-6M1 20v-6h6M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
              </svg>
            )}
          </button>
        </div>
        {isMobile && (
          <div className="flex gap-1 overflow-x-auto pb-0.5 scrollbar-hide">
            {FOLDERS.map(f => (
              <button key={f.id} onClick={() => { setFolder(f.id); setSelectedId(null); }}
                className={"flex items-center gap-1.5 px-2.5 h-7 rounded-full text-[12px] font-medium whitespace-nowrap border cursor-pointer transition-colors shrink-0 " + (folder === f.id ? "bg-[#ededed] border-[#ededed] text-black" : "bg-transparent border-[#2a2a2a] text-[#888] hover:text-[#ededed]")}>
                {f.label}
                {(unread[f.id] ?? 0) > 0 && <span className="text-[11px] rounded-full px-1.5 bg-[#6366F1] text-white font-semibold">{unread[f.id]}</span>}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto">
        {error && !loading && <div className="m-3 p-3 rounded-lg text-[13px] text-[#f44] bg-[rgba(255,68,68,0.06)] border border-[rgba(255,68,68,0.2)]">{error}</div>}
        {loading && <div className="flex items-center justify-center py-12"><Spinner size={20} /></div>}
        {!loading && filtered.length === 0 && !error && (
          <div className="flex flex-col items-center justify-center py-14 text-[#555]">
            <svg width="28" height="28" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24" className="mb-2 opacity-50">
              <path d="M20 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 4-8 5-8-5V6l8 5 8-5v2z"/>
            </svg>
            <p className="text-[13px]">{search ? "No results" : "Nothing here"}</p>
          </div>
        )}
        {!loading && filtered.map(email => {
          const name  = email.from?.emailAddress?.name || email.from?.emailAddress?.address || "?";
          const isAct = selectedId === email.id;
          return (
            <button key={email.id} onClick={() => openEmail(email)}
              className={"w-full text-left px-3 py-3 border-0 border-b border-solid border-[#111] cursor-pointer transition-colors " + (isAct ? "bg-[#141414]" : "bg-transparent hover:bg-[#0d0d0d]")}
              style={{ boxShadow: isAct ? "inset 2px 0 0 #6366F1" : undefined }}>
              <div className="flex items-center gap-2.5 mb-1">
                <div className="w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-bold text-white shrink-0" style={{ background: avatarColor(name) }}>
                  {initials(name)}
                </div>
                <span className={"flex-1 min-w-0 text-[13px] truncate " + (!email.isRead ? "font-semibold text-[#ededed]" : "font-medium text-[#aaa]")}>{name}</span>
                <div className="flex items-center gap-1.5 shrink-0">
                  {email.hasAttachments && (
                    <svg width="10" height="10" fill="none" stroke="#666" strokeWidth="2" viewBox="0 0 24 24">
                      <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/>
                    </svg>
                  )}
                  <span className="text-[11px] text-[#555] tabular-nums">{fmtDate(email.receivedDateTime)}</span>
                  {!email.isRead && <span className="w-1.5 h-1.5 rounded-full bg-[#6366F1] shrink-0" />}
                </div>
              </div>
              <p className={"text-[12px] truncate pl-9 m-0 " + (!email.isRead ? "text-[#ddd] font-medium" : "text-[#888]")}>{email.subject || "(no subject)"}</p>
              <p className="text-[12px] text-[#555] truncate pl-9 mt-0.5 mb-0">{email.bodyPreview}</p>
            </button>
          );
        })}
      </div>
    </div>
  );

  // ── Detail panel ──────────────────────────────────────────────────────
  const DetailPanel = (
    <div className={"flex-1 flex flex-col bg-[#0a0a0a] min-w-0 min-h-0 " + (isMobile && mobileView === "list" ? "hidden" : "flex")}>
      {!selected ? (
        <div className="flex-1 flex flex-col items-center justify-center text-[#555] gap-3">
          <svg width="40" height="40" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24" className="opacity-40">
            <path d="M20 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 4-8 5-8-5V6l8 5 8-5v2z"/>
          </svg>
          <p className="text-[14px]">Select an email to read</p>
        </div>
      ) : (
        <div className="flex flex-col h-full min-h-0">
          <div className="px-5 py-4 border-b border-[#1a1a1a] shrink-0">
            {isMobile && (
              <button onClick={() => setMobileView("list")} className="flex items-center gap-1 text-[#aaa] hover:text-[#ededed] text-[13px] font-medium mb-3 border-none bg-transparent cursor-pointer p-0">
                <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><polyline points="15 18 9 12 15 6"/></svg>
                Back
              </button>
            )}
            <h2 className="text-[16px] font-semibold text-[#ededed] mb-3 leading-snug">{selected.subject || "(no subject)"}</h2>

            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="w-8 h-8 rounded-full flex items-center justify-center text-[12px] font-bold text-white shrink-0"
                  style={{ background: avatarColor(selected.from?.emailAddress?.name || "?") }}>
                  {initials(selected.from?.emailAddress?.name || "?")}
                </div>
                <div className="min-w-0">
                  <div className="text-[13px] font-semibold text-[#ddd] truncate">{selected.from?.emailAddress?.name}</div>
                  <div className="text-[12px] text-[#666] truncate">{selected.from?.emailAddress?.address}</div>
                </div>
              </div>
              <span className="text-[12px] text-[#666] tabular-nums">{new Date(selected.receivedDateTime).toLocaleString()}</span>
            </div>

            <div className="flex flex-wrap gap-2 mt-3.5">
              <button onClick={() => { setReplyTo(selected); setForwardOf(null); }} className={btnGhost}>
                <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><polyline points="9 17 4 12 9 7"/><path d="M20 18v-2a4 4 0 0 0-4-4H4"/></svg>
                Reply
              </button>
              <button onClick={() => { setForwardOf(selected); setReplyTo(null); setCompose(true); }} className={btnGhost}>
                <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><polyline points="15 10 20 15 15 20"/><path d="M4 4h7a4 4 0 0 1 4 4v7"/></svg>
                Forward
              </button>
              <button onClick={() => toggleRead(selected)} className={btnGhost}>
                {selected.isRead
                  ? <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"/></svg>
                  : <svg width="12" height="12" viewBox="0 0 10 10" fill="#6366F1"><circle cx="5" cy="5" r="4"/></svg>}
                {selected.isRead ? "Mark unread" : "Mark read"}
              </button>
              <button onClick={() => deleteEmail(selected.id)} className={btnGhost + " hover:!text-[#f44] hover:!border-[rgba(255,68,68,0.4)]"}>
                <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/></svg>
                Delete
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto px-5 py-4 min-h-0">
            {selected.body ? (
              selected.body.contentType === "html" ? (
                <iframe
                  srcDoc={emailDoc(selected.body.content)}
                  className="w-full border-0 bg-[#0a0a0a]"
                  style={{ minHeight: 400, height: "100%" }}
                  sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
                  title="Email body"
                />
              ) : (
                <pre className="text-[14px] text-[#ccc] whitespace-pre-wrap font-sans leading-relaxed m-0">{selected.body.content}</pre>
              )
            ) : (
              <div className="flex items-center gap-2 text-[13px] text-[#666]"><Spinner size={12} /> Loading message</div>
            )}
          </div>

          <div className="shrink-0 px-5 py-3 border-t border-[#1a1a1a] bg-[#050505] flex items-center justify-between gap-3">
            <span className="text-[12px] text-[#666] flex items-center gap-1.5">
              {selected.hasAttachments && (
                <>
                  <svg width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                    <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/>
                  </svg>
                  Has attachments, open in Outlook to view them
                </>
              )}
            </span>
            <a href={selected.webLink ?? "https://outlook.live.com/mail/0/inbox"} target="_blank" rel="noopener noreferrer"
              className="flex items-center gap-1.5 text-[12px] font-semibold text-[#aaa] hover:text-[#ededed] no-underline transition-colors">
              <MsLogo size={14} />
              Open in Outlook ↗
            </a>
          </div>
        </div>
      )}
    </div>
  );

  return (
    <div className="flex-1 flex overflow-hidden bg-[#000] min-h-0">
      {/* Sidebar */}
      <aside className={"flex flex-col shrink-0 border-r border-[#1a1a1a] bg-[#000] " + (isMobile ? "hidden" : "w-48")}>
        <div className="px-3 py-4">
          <button onClick={() => { setCompose(true); setForwardOf(null); setReplyTo(null); }} className={btnPrimary + " w-full"}>
            <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            Compose
          </button>
        </div>
        <nav className="flex-1 px-2">
          {FOLDERS.map(f => (
            <button key={f.id} onClick={() => { setFolder(f.id); setSelectedId(null); setMobileView("list"); }}
              className={"w-full flex items-center gap-2.5 px-2.5 h-8 rounded-md text-[13px] font-medium mb-0.5 cursor-pointer border-none transition-colors text-left " + (folder === f.id ? "bg-[#141414] text-[#ededed]" : "bg-transparent text-[#888] hover:bg-[#0d0d0d] hover:text-[#ededed]")}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" className={folder === f.id ? "text-[#ededed]" : "text-[#555]"}><path d={f.icon}/></svg>
              <span className="flex-1 truncate">{f.label}</span>
              {(unread[f.id] ?? 0) > 0 && <span className="text-[11px] bg-[#6366F1] text-white rounded-full px-1.5 font-semibold shrink-0 tabular-nums">{unread[f.id]}</span>}
            </button>
          ))}
        </nav>
        {me && (
          <div className="px-3 py-3 border-t border-[#1a1a1a] mt-auto">
            <div className="flex items-center gap-2 min-w-0">
              <div className="w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-bold text-white shrink-0" style={{ background: avatarColor(me.displayName || "?") }}>
                {initials(me.displayName || "?")}
              </div>
              <div className="min-w-0">
                <div className="text-[12px] font-medium text-[#ddd] truncate">{me.displayName}</div>
                <div className="text-[11px] text-[#666] truncate">{me.mail || me.userPrincipalName}</div>
              </div>
            </div>
            <button onClick={() => void disconnect()}
              className="mt-2 w-full text-[11px] text-[#555] hover:text-[#f44] cursor-pointer border-none bg-transparent text-left p-0 transition-colors">
              Disconnect Outlook
            </button>
          </div>
        )}
      </aside>

      {isMobile && (
        <div className="fixed bottom-16 right-4 z-40">
          <button onClick={() => { setCompose(true); setForwardOf(null); setReplyTo(null); }} aria-label="Compose"
            className="w-12 h-12 rounded-full bg-[#ededed] text-black shadow-lg flex items-center justify-center cursor-pointer border-none hover:bg-white">
            <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          </button>
        </div>
      )}

      {ListPanel}
      {DetailPanel}

      {compose && !replyTo && (
        <ComposeModal
          getToken={getToken}
          onClose={() => { setCompose(false); setForwardOf(null); }}
          prefill={forwardOf ? {
            subject: "Fwd: " + forwardOf.subject,
            body: "\n\n---------- Forwarded message ----------\nFrom: " + forwardOf.from?.emailAddress?.name + " <" + forwardOf.from?.emailAddress?.address + ">\nDate: " + new Date(forwardOf.receivedDateTime).toLocaleString() + "\nSubject: " + forwardOf.subject + "\n\n" + forwardOf.bodyPreview,
          } : undefined}
        />
      )}

      {replyTo && (
        <ComposeModal
          getToken={getToken}
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
