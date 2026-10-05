// components/admin/FollowUp.tsx
// Users → Contact: pick a follow-up template, edit it, send now or schedule it,
// and see whether each email to this user was delivered, opened and clicked.
// Sending, scheduling and tracking live in lib/erp-emails.ts; templates and
// rendering in lib/followup-email.ts (shared, so the preview is what's sent).
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { User, inputCls, fmtFull } from "./admin-shared";
import { Block, Empty, human } from "./ui-kit";
import {
  FOLLOW_UP_TEMPLATES, FollowUpTemplate, composeText, emailTypeFor, fillVars, renderHtml,
  unfilledPlaceholders, scheduleError, MAX_SCHEDULE_DAYS,
} from "@/lib/followup-email";

// ─── Data ─────────────────────────────────────────────────────────────────────

type Status = "scheduled" | "sent" | "delivered" | "opened" | "clicked" | "bounced" | "complained" | "delayed" | "canceled";
interface UserEmail {
  resendId: string; emailType: string; subject: string | null; sentAt: string; status: Status; fromErp: boolean;
  deliveredAt: string | null; opens: number; firstOpenedAt: string | null; lastOpenedAt: string | null;
  clicks: number; firstClickedAt: string | null; links: string[]; source: "webhook" | "resend" | "none";
}
interface EmailsResponse { emails: UserEmail[]; from: string; tracking: { webhook: boolean; resend: boolean } }

const post = (token: string, action: string, payload: Record<string, unknown>) => fetch("/api/admin", {
  method: "POST",
  headers: { "Content-Type": "application/json", ...(token ? { "x-admin-token": token } : {}) },
  body: JSON.stringify({ action, ...payload }),
}).then(async r => { const j = await r.json().catch(() => ({})) as Record<string, unknown>; if (!r.ok || j.error) throw new Error(String(j.error ?? `HTTP ${r.status}`)); return j; });

function useUserEmails(userId: string, token: string) {
  const [data, setData] = useState<EmailsResponse | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const r = await fetch(`/api/admin?action=user_emails&id=${encodeURIComponent(userId)}`, { headers: token ? { "x-admin-token": token } : {} });
      const j = await r.json() as EmailsResponse & { error?: string };
      if (!r.ok || j.error) throw new Error(j.error ?? `HTTP ${r.status}`);
      setData(j);
    } catch (e) { setError((e as Error).message); }
    setLoading(false);
  }, [userId, token]);
  useEffect(() => { void Promise.resolve().then(load); }, [load]);
  return { data, error, loading, reload: load };
}

// ─── Template suggestion ──────────────────────────────────────────────────────

const DAY = 86_400_000;
const totalUsage = (u: User) => Object.entries(u.usage ?? {}).reduce((s, [k, v]) => s + (k.endsWith("Used") && typeof v === "number" ? v : 0), 0);

/** The template that fits this user's situation best, and why. */
function suggest(u: User): { id: string; why: string } {
  const sub = u.subscription ?? {}, status = String(sub.status ?? "");
  const age = u.createdAt ? Date.now() - Date.parse(u.createdAt) : Infinity;
  const idle = u.lastLogin ? Date.now() - Date.parse(u.lastLogin) : Infinity;
  const used = totalUsage(u);
  if (["past_due", "unpaid", "incomplete"].includes(status)) return { id: "payment", why: `subscription is ${human(status)?.toLowerCase()}` };
  if (status === "canceled" || sub.canceledAt) return { id: "win_back", why: "cancelled their subscription" };
  if (used === 0 && age < 14 * DAY) return { id: "activation", why: "signed up but hasn't used anything yet" };
  if (idle > 21 * DAY && Number.isFinite(idle)) return { id: "win_back", why: `inactive for ${Math.floor(idle / DAY)} days` };
  if ((sub.plan ?? "free") === "free" && used >= 3) return { id: "upgrade", why: `free plan with ${used} uses this period` };
  if (age < 3 * DAY) return { id: "welcome", why: "joined in the last 3 days" };
  return { id: "check_in", why: "active user" };
}

// ─── Scheduling helpers (admin's local time) ──────────────────────────────────

const pad = (n: number) => String(n).padStart(2, "0");
const toLocalInput = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
const at9 = (d: Date) => { d.setHours(9, 0, 0, 0); return d; };
function presets(): { label: string; value: string }[] {
  const now = new Date();
  const inHour = new Date(now.getTime() + 3_600_000); inHour.setSeconds(0, 0);
  const tomorrow = at9(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1));
  const monday = at9(new Date(now.getFullYear(), now.getMonth(), now.getDate() + (((8 - now.getDay()) % 7) || 7)));
  return [
    { label: "In 1 hour", value: toLocalInput(inHour) },
    { label: "Tomorrow, 9 AM", value: toLocalInput(tomorrow) },
    { label: "Monday, 9 AM", value: toLocalInput(monday) },
  ];
}
/** Presets and the input's min/max, computed on demand rather than during render. */
function scheduleBounds() {
  const now = Date.now();
  return { presets: presets(), min: toLocalInput(new Date(now + 5 * 60_000)), max: toLocalInput(new Date(now + MAX_SCHEDULE_DAYS * DAY)) };
}
const whenLabel = (iso: string) => new Date(iso).toLocaleString(undefined, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

// ─── Status display ───────────────────────────────────────────────────────────

const STATUS: Record<Status, { label: string; color: string; hint: string }> = {
  scheduled:  { label: "Scheduled",  color: "#f5a623", hint: "Queued in Resend; sends at the scheduled time" },
  sent:       { label: "Sent",       color: "#888",    hint: "Handed to Resend; no delivery report yet" },
  delayed:    { label: "Delayed",    color: "#f5a623", hint: "The recipient's server is deferring it; Resend keeps retrying" },
  delivered:  { label: "Delivered",  color: "#bbb",    hint: "Accepted by the recipient's mail server, not yet opened" },
  opened:     { label: "Opened",     color: "#0070f3", hint: "The email was opened (tracking pixel loaded)" },
  clicked:    { label: "Clicked",    color: "#3ecf8e", hint: "A link in the email was clicked" },
  bounced:    { label: "Bounced",    color: "#f44",    hint: "Rejected by the recipient's server; the address may be invalid" },
  complained: { label: "Spam report", color: "#f44",   hint: "The recipient marked this email as spam" },
  canceled:   { label: "Cancelled",  color: "#555",    hint: "Cancelled before it was sent" },
};

function StatusPill({ s }: { s: Status }) {
  const m = STATUS[s];
  return (
    <span title={m.hint} className="inline-flex items-center gap-1.5 text-[12px] font-medium whitespace-nowrap" style={{ color: m.color }}>
      <span className="w-1.5 h-1.5 rounded-full" style={{ background: m.color }} />{m.label}
    </span>
  );
}

const typeLabel = (t: string) => {
  const tpl = FOLLOW_UP_TEMPLATES.find(x => `erp_${x.id}` === t);
  return tpl ? `Follow-up · ${tpl.label}` : human(t) ?? t;
};

// ─── Panel ────────────────────────────────────────────────────────────────────

export function FollowUpPanel({ user, token = "", onDone }: { user: User; token?: string; onDone?: (msg: string) => void }) {
  const email = user.email ?? "";
  const suggestion = useMemo(() => suggest(user), [user]);
  const emails = useUserEmails(user.id, token);

  const draftFor = useCallback((t: FollowUpTemplate) => ({ subject: fillVars(t.subject, user.name), text: composeText(t.body, user.name) }), [user.name]);
  const [tplId, setTplId] = useState(suggestion.id);
  const [subject, setSubject] = useState(() => draftFor(FOLLOW_UP_TEMPLATES.find(t => t.id === suggestion.id)!).subject);
  const [text, setText] = useState(() => draftFor(FOLLOW_UP_TEMPLATES.find(t => t.id === suggestion.id)!).text);
  const [mode, setMode] = useState<"now" | "schedule">("now");
  const [bounds, setBounds] = useState(scheduleBounds);
  const [when, setWhen] = useState(() => bounds.presets[1].value);
  const [preview, setPreview] = useState(false);
  const [working, setWorking] = useState(false);
  const [err, setErr] = useState("");
  const [done, setDone] = useState("");

  const tpl = FOLLOW_UP_TEMPLATES.find(t => t.id === tplId)!;
  const pristine = draftFor(tpl);
  const dirty = subject !== pristine.subject || text !== pristine.text;
  const placeholders = unfilledPlaceholders(`${subject}\n${text}`);
  const whenIso = when ? new Date(when).toISOString() : "";
  const whenErr = mode === "schedule" ? (when ? scheduleError(whenIso) : "Pick a date and time") : null;

  function pick(t: FollowUpTemplate) {
    if (t.id === tplId) return;
    if (dirty && !window.confirm("Replace your edits with this template?")) return;
    const d = draftFor(t);
    setTplId(t.id); setSubject(d.subject); setText(d.text); setErr(""); setDone("");
  }

  async function submit() {
    if (!email) return setErr("This user has no email address");
    if (!subject.trim() || !text.trim()) return setErr("Subject and message are required");
    if (placeholders.length) return setErr(`Fill in ${placeholders.join(", ")} first`);
    if (whenErr) return setErr(whenErr);
    setWorking(true); setErr(""); setDone("");
    try {
      const r = await post(token, "contact_email", {
        id: user.id, toEmail: email, toName: user.name, subject, body: text, template: tplId,
        ...(mode === "schedule" ? { scheduledAt: whenIso } : {}),
      });
      const msg = r.draft ? "Draft logged on the server (RESEND_API_KEY isn't set)"
        : mode === "schedule" ? `Scheduled for ${whenLabel(whenIso)}` : `Sent to ${email}`;
      setDone(msg); onDone?.(msg);
      const d = draftFor(tpl); setSubject(d.subject); setText(d.text); setMode("now"); setPreview(false);
      void emails.reload();
    } catch (e) { setErr((e as Error).message); }
    setWorking(false);
  }

  return (
    <div className="flex flex-col gap-7 min-w-0">
      {/* ── Compose ── */}
      <Block title="New follow-up" action={<span className="text-[12px] text-[#555] truncate">to {email || "no email on file"}</span>}>
        <div className="p-4 flex flex-col gap-4">
          {/* Templates */}
          <div>
            <div className="flex items-baseline justify-between gap-3 mb-2">
              <span className="text-[12px] font-medium text-[#888]">Template</span>
              <span className="text-[12px] text-[#555] truncate">Suggested: <span className="text-[#bbb]">{FOLLOW_UP_TEMPLATES.find(t => t.id === suggestion.id)?.label}</span> · {suggestion.why}</span>
            </div>
            <div role="radiogroup" aria-label="Template" className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
              {FOLLOW_UP_TEMPLATES.map(t => {
                const on = t.id === tplId;
                return (
                  <button key={t.id} role="radio" aria-checked={on} onClick={() => pick(t)} title={t.hint}
                    className={`relative text-left px-3 py-2 rounded-lg border cursor-pointer transition-colors ${on ? "bg-[#141414] border-[#3a3a3a]" : "bg-transparent border-[#1a1a1a] hover:border-[#2a2a2a]"}`}>
                    <span className={`block text-[13px] ${on ? "text-[#ededed] font-medium" : "text-[#aaa]"}`}>{t.label}</span>
                    <span className="block text-[11px] text-[#555] truncate">{t.hint}</span>
                    {t.id === suggestion.id && <span className="absolute top-2 right-2 w-1.5 h-1.5 rounded-full bg-[#3ecf8e]" title="Suggested for this user" />}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Subject + message */}
          <label className="block">
            <span className="block text-[12px] font-medium text-[#888] mb-1.5">Subject</span>
            <input value={subject} onChange={e => setSubject(e.target.value)} className={inputCls} placeholder="Subject" maxLength={200} />
          </label>
          <div>
            <div className="flex items-baseline justify-between gap-3 mb-1.5">
              <label htmlFor="followup-message" className="text-[12px] font-medium text-[#888]">Message</label>
              <button type="button" onClick={() => setPreview(p => !p)} aria-pressed={preview}
                className="text-[12px] text-[#888] hover:text-[#ededed] bg-transparent border-none p-0 cursor-pointer">
                {preview ? "Edit message" : "Preview email"}
              </button>
            </div>
            {preview ? (
              <iframe title="Email preview" sandbox="" srcDoc={renderHtml(text, emailTypeFor(tplId))}
                className="w-full h-80 rounded-md border border-[#2a2a2a] bg-white" />
            ) : (
              <textarea id="followup-message" value={text} onChange={e => setText(e.target.value)} rows={12} spellCheck
                className={`${inputCls} resize-y leading-relaxed`} />
            )}
          </div>
          {placeholders.length > 0 && (
            <p className="text-[12px] text-[#f5a623] -mt-2">Replace {placeholders.join(", ")} before sending.</p>
          )}

          {/* Delivery */}
          <div className="flex flex-col gap-2.5">
            <div role="radiogroup" aria-label="Delivery" className="inline-flex self-start gap-0.5 bg-[#0a0a0a] border border-[#1a1a1a] rounded-lg p-0.5">
              {(["now", "schedule"] as const).map(m => (
                <button key={m} role="radio" aria-checked={mode === m} onClick={() => { setMode(m); if (m === "schedule") setBounds(scheduleBounds()); }}
                  className={`px-3 h-7 rounded text-[13px] font-medium border-none cursor-pointer transition-colors ${mode === m ? "bg-[#1a1a1a] text-[#ededed]" : "bg-transparent text-[#666] hover:text-[#aaa]"}`}>
                  {m === "now" ? "Send now" : "Schedule"}
                </button>
              ))}
            </div>
            {mode === "schedule" && (
              <div className="flex flex-col gap-2">
                <div className="flex flex-wrap items-center gap-1.5">
                  {bounds.presets.map(p => (
                    <button key={p.label} onClick={() => setWhen(p.value)}
                      className={`px-2.5 h-7 rounded-md border text-[12px] cursor-pointer transition-colors ${when === p.value ? "border-[#3a3a3a] bg-[#141414] text-[#ededed]" : "border-[#1a1a1a] bg-transparent text-[#888] hover:text-[#ededed]"}`}>
                      {p.label}
                    </button>
                  ))}
                  <input type="datetime-local" value={when} onChange={e => setWhen(e.target.value)} aria-label="Send at"
                    min={bounds.min} max={bounds.max}
                    className={`${inputCls} w-auto h-7 py-0 text-[12px]`} />
                </div>
                <p className={`text-[12px] ${whenErr ? "text-[#f5a623]" : "text-[#666]"}`}>
                  {whenErr ?? <>Sends {whenLabel(whenIso)} (your time) · up to {MAX_SCHEDULE_DAYS} days ahead · you can cancel it below until then</>}
                </p>
              </div>
            )}
          </div>

          {err && <div role="alert" className="px-3 py-2 rounded-lg text-[13px] text-[#f44] bg-[rgba(255,68,68,0.06)] border border-[rgba(255,68,68,0.2)]">{err}</div>}
          {done && <div role="status" className="px-3 py-2 rounded-lg text-[13px] text-[#3ecf8e] bg-[rgba(62,207,142,0.06)] border border-[rgba(62,207,142,0.2)]">{done}</div>}

          <div className="flex flex-wrap items-center gap-3">
            <button onClick={submit} disabled={working || !email || placeholders.length > 0 || !!whenErr}
              className="px-4 h-9 rounded-lg text-[13px] font-semibold border-none cursor-pointer bg-[#ededed] text-black hover:bg-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
              {working ? (mode === "schedule" ? "Scheduling…" : "Sending…") : mode === "schedule" ? "Schedule email" : "Send email"}
            </button>
            <span className="text-[12px] text-[#555]">From {emails.data?.from ?? "support@preciprocal.com"} via Resend · replies go to that inbox</span>
          </div>
        </div>
      </Block>

      {/* ── History ── */}
      <EmailHistory q={emails} token={token} />
    </div>
  );
}

// ─── History ──────────────────────────────────────────────────────────────────

function EmailHistory({ q, token }: { q: ReturnType<typeof useUserEmails>; token: string }) {
  const [canceling, setCanceling] = useState("");
  const [err, setErr] = useState("");
  const list = q.data?.emails ?? [];
  const tracking = q.data?.tracking;
  const opened = list.filter(e => e.status === "opened" || e.status === "clicked").length;
  const delivered = list.filter(e => !["scheduled", "canceled", "sent", "bounced"].includes(e.status)).length;

  async function cancel(e: UserEmail) {
    if (!window.confirm(`Cancel "${e.subject ?? "this email"}"? It can't be rescheduled afterwards.`)) return;
    setCanceling(e.resendId); setErr("");
    try { await post(token, "cancel_email", { resendId: e.resendId }); await q.reload(); }
    catch (x) { setErr((x as Error).message); }
    setCanceling("");
  }

  return (
    <Block title="Emails to this user" count={list.length || undefined}
      action={<button onClick={() => void q.reload()} className="text-[12px] text-[#888] hover:text-[#ededed] bg-transparent border-none cursor-pointer">Refresh</button>}>
      {q.error ? <Empty>Couldn&apos;t load emails: {q.error}</Empty>
        : q.loading && !q.data ? <div className="p-4"><div className="skeleton h-24 rounded-lg" /></div>
        : list.length === 0 ? <Empty>No emails sent to this user yet</Empty>
        : (<>
          {delivered > 0 && (
            <div className="px-4 py-2.5 border-b border-[#141414] text-[12px] text-[#888]">
              Opened <span className="text-[#ededed] tabular-nums">{opened}</span> of <span className="text-[#ededed] tabular-nums">{delivered}</span> delivered
            </div>
          )}
          <ul className="divide-y divide-[#111]">
            {list.map(e => (
              <li key={e.resendId} className="px-4 py-3 flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="text-[13px] text-[#ddd] truncate">{e.subject ?? "(no subject)"}</div>
                  <div className="text-[12px] text-[#555] mt-0.5">
                    {typeLabel(e.emailType)} · {e.status === "scheduled" ? `sends ${whenLabel(e.sentAt)}` : fmtFull(e.sentAt)}
                  </div>
                  <Engagement e={e} />
                </div>
                <div className="shrink-0 flex flex-col items-end gap-1.5">
                  <StatusPill s={e.status} />
                  {e.status === "scheduled" && e.fromErp && (
                    <button onClick={() => void cancel(e)} disabled={canceling === e.resendId}
                      className="text-[12px] text-[#888] hover:text-[#f44] bg-transparent border-none p-0 cursor-pointer disabled:opacity-50">
                      {canceling === e.resendId ? "Cancelling…" : "Cancel"}
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
          {err && <div role="alert" className="px-4 py-2 text-[12px] text-[#f44] border-t border-[#141414]">{err}</div>}
        </>)}
      {tracking && <TrackingNote webhook={tracking.webhook} />}
    </Block>
  );
}

function Engagement({ e }: { e: UserEmail }) {
  const bits: string[] = [];
  if (e.opens) bits.push(`Opened ${e.opens > 1 ? `${e.opens}× · first ` : ""}${fmtFull(e.firstOpenedAt ?? undefined)}`);
  if (e.clicks) bits.push(`${e.clicks} click${e.clicks === 1 ? "" : "s"}${e.links.length ? ` · ${e.links.map(l => l.replace(/^https?:\/\//, "").split("?")[0]).join(", ")}` : ""}`);
  if (!bits.length && e.deliveredAt && e.status === "delivered") bits.push(`Delivered ${fmtFull(e.deliveredAt)}`);
  if (!bits.length && e.source === "resend" && (e.status === "opened" || e.status === "clicked")) bits.push("Open time not available (from Resend's latest status)");
  return bits.length ? <div className="text-[12px] text-[#777] mt-1 wrap-break-word">{bits.join(" · ")}</div> : null;
}

function TrackingNote({ webhook }: { webhook: boolean }) {
  return (
    <details className="border-t border-[#141414] px-4 py-2.5 text-[12px] text-[#666] group">
      <summary className="cursor-pointer select-none list-none flex items-center gap-1.5 hover:text-[#aaa]">
        <span className="inline-block transition-transform group-open:rotate-90">›</span>
        {webhook ? "How open tracking works" : "Open times need the Resend webhook. Showing Resend's latest status for now"}
      </summary>
      <div className="mt-2 flex flex-col gap-1.5 leading-relaxed">
        {!webhook && (
          <ol className="list-decimal pl-5 flex flex-col gap-1">
            <li>Resend → <b className="text-[#aaa] font-medium">Domains → preciprocal.com</b>: turn on <b className="text-[#aaa] font-medium">Open tracking</b> and <b className="text-[#aaa] font-medium">Click tracking</b>.</li>
            <li>Resend → <b className="text-[#aaa] font-medium">Webhooks → Add endpoint</b>: <code className="font-mono text-[#aaa]">https://app.preciprocal.com/api/webhooks/resend</code>, with events delivered, opened, clicked, bounced, complained, delivery_delayed.</li>
            <li>Copy its signing secret into <code className="font-mono text-[#aaa]">RESEND_WEBHOOK_SECRET</code> on the Dashboard&apos;s Vercel project and redeploy.</li>
          </ol>
        )}
        <p>An open is recorded when the email&apos;s tracking image loads. Apple Mail preloads images, which can show an open the person never made, and clients that block images hide real opens. Treat opens as a signal and clicks as the reliable one.</p>
      </div>
    </details>
  );
}
