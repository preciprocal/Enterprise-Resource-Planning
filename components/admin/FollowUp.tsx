// components/admin/FollowUp.tsx
// Emailing from the ERP, in the same branded template the product's own
// emails use. EmailComposer sends to one person or many: users picked in the
// ERP, or any typed address (a reply to someone who wrote in). FollowUpPanel
// is the per-user version, with that user's email history under it.
// Sending, opt-outs and tracking live in lib/erp-emails.ts; templates and
// rendering in lib/followup-email.ts (shared, so the preview is what's sent).
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { User, inputCls, fmtFull, Checkbox, Select } from "./admin-shared";
import { Block, Empty, human } from "./ui-kit";
import {
  FOLLOW_UP_TEMPLATES, FollowUpTemplate, Draft, SENDERS, SenderId, composeEmail, draftFromTemplate,
  unfilledPlaceholders, scheduleError, MAX_SCHEDULE_DAYS, MAX_RECIPIENTS,
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
  if (["past_due", "unpaid"].includes(status)) return { id: "payment", why: `subscription is ${human(status)?.toLowerCase()}` };
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
  return tpl ? `From the ERP · ${tpl.label}` : human(t) ?? t;
};

// ─── Composer ─────────────────────────────────────────────────────────────────

export interface Recipient { userId?: string; email: string; name?: string | null }

const EMAIL_RE = /^[^\s@<>(),;:"]+@[^\s@<>(),;:"]+\.[^\s@<>(),;:"]+$/;
const keyOf = (r: Recipient) => r.userId ?? r.email.toLowerCase();
export const recipientFromUser = (u: User): Recipient => ({ userId: u.id, email: u.email ?? "", name: u.name ?? null });

interface SendResult { email: string; name: string | null; status: "sent" | "scheduled" | "skipped" | "failed" | "draft"; reason?: string }

const RESULT_COLOR: Record<SendResult["status"], string> = { sent: "#3ecf8e", scheduled: "#f5a623", draft: "#888", skipped: "#888", failed: "#f44" };
const LABEL = "block text-[12px] font-medium text-[#888] mb-1.5";
const UNSUB_PREVIEW = "https://app.preciprocal.com/settings?section=notifications";

export function EmailComposer({
  initialRecipients, allUsers = [], token = "", suggestedTemplate, onSent, title = "New email",
}: {
  initialRecipients: Recipient[];
  /** Users to search when adding recipients. Typed addresses always work. */
  allUsers?: User[];
  token?: string;
  suggestedTemplate?: { id: string; why: string };
  onSent?: (msg: string) => void;
  title?: string;
}) {
  const [recipients, setRecipients] = useState<Recipient[]>(initialRecipients);
  const [query, setQuery] = useState("");
  const startTpl = FOLLOW_UP_TEMPLATES.find(t => t.id === suggestedTemplate?.id) ?? FOLLOW_UP_TEMPLATES[0];
  const [draft, setDraft] = useState<Draft>(() => draftFromTemplate(startTpl));
  const [mode, setMode] = useState<"now" | "schedule">("now");
  const [bounds, setBounds] = useState(scheduleBounds);
  const [when, setWhen] = useState(() => bounds.presets[1].value);
  const [preview, setPreview] = useState(false);
  const [working, setWorking] = useState(false);
  const [err, setErr] = useState("");
  const [results, setResults] = useState<SendResult[] | null>(null);

  const many = recipients.length > 1;
  // Anything to several people is optional; the server enforces it too.
  const optional = draft.optional || many;
  const tpl = FOLLOW_UP_TEMPLATES.find(t => t.id === draft.templateId) ?? FOLLOW_UP_TEMPLATES[0];
  const pristine = draftFromTemplate(tpl);
  const dirty = (["subject", "heading", "eyebrow", "body"] as const).some(k => draft[k] !== pristine[k]);
  const placeholders = unfilledPlaceholders([draft.subject, draft.heading, draft.eyebrow, draft.body, draft.cta?.label ?? "", draft.cta?.url ?? ""].join("\n"));
  const whenIso = when ? new Date(when).toISOString() : "";
  const whenErr = mode === "schedule" ? (when ? scheduleError(whenIso) : "Pick a date and time") : null;
  const ctaErr = draft.cta && (draft.cta.label.trim() || draft.cta.url.trim()) && !/^https?:\/\/\S+$/.test(draft.cta.url.trim())
    ? "The button needs a full link starting with https://" : null;
  const noAddress = recipients.filter(r => !r.email).length;
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft(d => ({ ...d, [k]: v }));

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q.length < 2) return [];
    const taken = new Set(recipients.map(keyOf));
    return allUsers.filter(u => u.email && !taken.has(u.id) &&
      ((u.name ?? "").toLowerCase().includes(q) || (u.email ?? "").toLowerCase().includes(q))).slice(0, 6);
  }, [query, allUsers, recipients]);

  function add(r: Recipient) {
    setRecipients(list => list.some(x => keyOf(x) === keyOf(r)) ? list : [...list, r]);
    setQuery(""); setResults(null);
  }
  function addTyped() {
    const parts = query.split(/[\s,;]+/).map(p => p.trim()).filter(Boolean);
    const bad = parts.filter(p => !EMAIL_RE.test(p));
    if (bad.length) return setErr(`Not a valid email address: ${bad.join(", ")}`);
    for (const e of parts) {
      const u = allUsers.find(x => x.email?.toLowerCase() === e.toLowerCase());
      add(u ? recipientFromUser(u) : { email: e });
    }
    setErr("");
  }

  function pick(t: FollowUpTemplate) {
    if (t.id === draft.templateId) return;
    if (dirty && !window.confirm("Replace your edits with this template?")) return;
    setDraft(draftFromTemplate(t)); setErr(""); setResults(null);
  }

  async function submit() {
    if (!recipients.length) return setErr("Add at least one recipient");
    if (recipients.length > MAX_RECIPIENTS) return setErr(`At most ${MAX_RECIPIENTS} recipients per send`);
    if (!draft.subject.trim() || !draft.body.trim()) return setErr("Subject and message are required");
    if (placeholders.length) return setErr(`Fill in ${placeholders.join(", ")} first`);
    if (ctaErr) return setErr(ctaErr);
    if (whenErr) return setErr(whenErr);
    if (many && !window.confirm(`${mode === "schedule" ? "Schedule" : "Send"} this to ${recipients.length} people? Each gets their own copy.`)) return;
    setWorking(true); setErr(""); setResults(null);
    try {
      const r = await post(token, "send_emails", {
        userIds: recipients.filter(x => x.userId).map(x => x.userId),
        emails: recipients.filter(x => !x.userId).map(x => x.email),
        draft: { ...draft, optional, cta: draft.cta && draft.cta.label.trim() ? draft.cta : null },
        ...(mode === "schedule" ? { scheduledAt: whenIso } : {}),
      }) as { results?: SendResult[]; draft?: boolean };
      const list = r.results ?? [];
      setResults(list);
      const ok = list.filter(x => x.status === "sent" || x.status === "scheduled" || x.status === "draft").length;
      const msg = r.draft ? "Drafts logged on the server (RESEND_API_KEY isn't set)"
        : mode === "schedule" ? `Scheduled ${ok} of ${list.length} for ${whenLabel(whenIso)}` : `Sent ${ok} of ${list.length}`;
      onSent?.(msg);
      if (ok === list.length) { setDraft(draftFromTemplate(tpl)); setMode("now"); setPreview(false); }
    } catch (e) { setErr((e as Error).message); }
    setWorking(false);
  }

  const previewHtml = useMemo(
    () => preview ? composeEmail({ ...draft, optional }, recipients[0] ?? {}, UNSUB_PREVIEW).html : "",
    [preview, draft, optional, recipients],
  );

  return (
    <Block title={title} action={<span className="text-[12px] text-[#555]">{recipients.length} recipient{recipients.length === 1 ? "" : "s"}</span>}>
      <div className="p-4 flex flex-col gap-4">
        {/* Recipients */}
        <div>
          <span className={LABEL}>To</span>
          <div className="flex flex-wrap gap-1.5 mb-2">
            {recipients.map(r => (
              <span key={keyOf(r)} title={r.email || "No email address on file"}
                className={`inline-flex items-center gap-1.5 pl-2.5 pr-1.5 h-7 rounded-md border text-[12px] ${r.email ? "border-[#2a2a2a] bg-[#111] text-[#ddd]" : "border-[rgba(255,68,68,0.3)] text-[#f44]"}`}>
                <span className="max-w-[240px] truncate">{r.name ? `${r.name} · ${r.email || "no email"}` : r.email}</span>
                {!r.userId && <span className="text-[10px] text-[#666]">not a user</span>}
                <button onClick={() => { setRecipients(l => l.filter(x => keyOf(x) !== keyOf(r))); setResults(null); }} aria-label={`Remove ${r.email}`}
                  className="w-4 h-4 flex items-center justify-center rounded text-[#666] hover:text-[#f44] bg-transparent border-none cursor-pointer p-0">×</button>
              </span>
            ))}
            {!recipients.length && <span className="text-[12px] text-[#555]">No recipients yet</span>}
          </div>
          <div className="relative">
            <input value={query} onChange={e => setQuery(e.target.value)} className={inputCls} aria-label="Add recipient"
              onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); if (matches[0]) add(recipientFromUser(matches[0])); else if (query.trim()) addTyped(); } }}
              placeholder={allUsers.length ? "Add a user by name or email, or type any address and press Enter" : "Type an email address and press Enter"} />
            {matches.length > 0 && (
              <div className="absolute z-20 left-0 right-0 mt-1 rounded-md border border-[#2a2a2a] bg-[#0a0a0a] shadow-xl overflow-hidden">
                {matches.map(u => (
                  <button key={u.id} onClick={() => add(recipientFromUser(u))}
                    className="w-full text-left px-3 py-2 text-[13px] bg-transparent border-none cursor-pointer hover:bg-[#151515] text-[#ddd]">
                    {u.name ?? "Unknown"} <span className="text-[#666]">· {u.email}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          {noAddress > 0 && <p className="text-[12px] text-[#f5a623] mt-1.5">{noAddress} recipient{noAddress === 1 ? " has" : "s have"} no email address and will be skipped.</p>}
        </div>

        {/* Templates */}
        <div>
          <div className="flex items-baseline justify-between gap-3 mb-2">
            <span className="text-[12px] font-medium text-[#888]">Template</span>
            {suggestedTemplate && <span className="text-[12px] text-[#555] truncate">Suggested: <span className="text-[#bbb]">{FOLLOW_UP_TEMPLATES.find(t => t.id === suggestedTemplate.id)?.label}</span> · {suggestedTemplate.why}</span>}
          </div>
          <div role="radiogroup" aria-label="Template" className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-5 gap-1.5">
            {FOLLOW_UP_TEMPLATES.map(t => {
              const on = t.id === draft.templateId;
              return (
                <button key={t.id} role="radio" aria-checked={on} onClick={() => pick(t)} title={t.hint}
                  className={`relative text-left px-3 py-2 rounded-lg border cursor-pointer transition-colors ${on ? "bg-[#141414] border-[#3a3a3a]" : "bg-transparent border-[#1a1a1a] hover:border-[#2a2a2a]"}`}>
                  <span className={`block text-[13px] ${on ? "text-[#ededed] font-medium" : "text-[#aaa]"}`}>{t.label}</span>
                  <span className="block text-[11px] text-[#555] truncate">{t.hint}</span>
                  {t.id === suggestedTemplate?.id && <span className="absolute top-2 right-2 w-1.5 h-1.5 rounded-full bg-[#3ecf8e]" title="Suggested for this user" />}
                </button>
              );
            })}
          </div>
        </div>

        {/* Sender and kind */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <span className={LABEL}>From</span>
            <Select value={draft.sender} onChange={e => set("sender", e.target.value as SenderId)} aria-label="From">
              {(Object.keys(SENDERS) as SenderId[]).map(k => <option key={k} value={k}>{SENDERS[k].label} ({SENDERS[k].replyTo})</option>)}
            </Select>
          </div>
          <div className={`flex items-start gap-2.5 sm:pt-6 text-[12px] leading-relaxed ${many ? "text-[#666]" : "text-[#aaa]"}`}>
            <Checkbox checked={optional} disabled={many} onChange={() => set("optional", !draft.optional)} label="Optional email" className="mt-0.5" />
            <span onClick={() => { if (!many) set("optional", !draft.optional); }} className={many ? "" : "cursor-pointer"}>
              Optional email: adds an unsubscribe link and skips anyone who opted out.{many ? " Always on when sending to several people." : " Turn off only for a reply or an account issue."}
            </span>
          </div>
        </div>

        {/* Content */}
        <div className="grid grid-cols-1 sm:grid-cols-[1fr_2fr] gap-3">
          <label className="block">
            <span className={LABEL}>Label above the heading</span>
            <input value={draft.eyebrow} onChange={e => set("eyebrow", e.target.value)} className={inputCls} maxLength={40} placeholder="From Preciprocal" />
          </label>
          <label className="block">
            <span className={LABEL}>Subject</span>
            <input value={draft.subject} onChange={e => set("subject", e.target.value)} className={inputCls} placeholder="Subject" maxLength={200} />
          </label>
        </div>
        <label className="block">
          <span className={LABEL}>Heading</span>
          <input value={draft.heading} onChange={e => set("heading", e.target.value)} className={inputCls} placeholder="Defaults to the subject" maxLength={120} />
        </label>
        <div>
          <div className="flex items-baseline justify-between gap-3 mb-1.5">
            <label htmlFor="email-message" className="text-[12px] font-medium text-[#888]">Message <span className="text-[#555] font-normal">· {"{{first_name}}"} is filled in for each person</span></label>
            <button type="button" onClick={() => setPreview(p => !p)} aria-pressed={preview}
              className="text-[12px] text-[#888] hover:text-[#ededed] bg-transparent border-none p-0 cursor-pointer">
              {preview ? "Edit message" : "Preview email"}
            </button>
          </div>
          {preview ? (
            <>
              <iframe title="Email preview" sandbox="" srcDoc={previewHtml} className="w-full h-[520px] rounded-md border border-[#2a2a2a] bg-[#05070c]" />
              <p className="text-[12px] text-[#555] mt-1.5">As {recipients[0]?.name || recipients[0]?.email || "the first recipient"} will see it, from {SENDERS[draft.sender].from}.</p>
            </>
          ) : (
            <textarea id="email-message" value={draft.body} onChange={e => set("body", e.target.value)} rows={10} spellCheck
              className={`${inputCls} resize-y leading-relaxed`} placeholder="Write your message. A blank line starts a new paragraph." />
          )}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-[1fr_2fr] gap-3">
          <label className="block">
            <span className={LABEL}>Button text (optional)</span>
            <input value={draft.cta?.label ?? ""} onChange={e => set("cta", { label: e.target.value, url: draft.cta?.url ?? "" })} className={inputCls} placeholder="e.g. Open Preciprocal" maxLength={40} />
          </label>
          <label className="block">
            <span className={LABEL}>Button link</span>
            <input value={draft.cta?.url ?? ""} onChange={e => set("cta", { label: draft.cta?.label ?? "", url: e.target.value })} className={inputCls} placeholder="https://app.preciprocal.com/..." />
          </label>
        </div>
        {(placeholders.length > 0 || ctaErr) && (
          <p className="text-[12px] text-[#f5a623] -mt-2">{placeholders.length ? `Replace ${placeholders.join(", ")} before sending. ` : ""}{ctaErr ?? ""}</p>
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
                {whenErr ?? <>Sends {whenLabel(whenIso)} (your time) · up to {MAX_SCHEDULE_DAYS} days ahead · each email can be cancelled from that user&apos;s page until then</>}
              </p>
            </div>
          )}
        </div>

        {err && <div role="alert" className="px-3 py-2 rounded-lg text-[13px] text-[#f44] bg-[rgba(255,68,68,0.06)] border border-[rgba(255,68,68,0.2)]">{err}</div>}
        {results && (
          <div role="status" className="rounded-lg border border-[#1a1a1a] divide-y divide-[#111]">
            {results.map(r => (
              <div key={r.email} className="px-3 py-2 flex items-start justify-between gap-3 text-[12px]">
                <span className="text-[#bbb] truncate">{r.name ? `${r.name} · ` : ""}{r.email}</span>
                <span className="shrink-0 text-right" style={{ color: RESULT_COLOR[r.status] }}>
                  {human(r.status)}{r.reason ? <span className="block text-[#666] max-w-[320px]">{r.reason}</span> : null}
                </span>
              </div>
            ))}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-3">
          <button onClick={submit} disabled={working || !recipients.length || placeholders.length > 0 || !!whenErr || !!ctaErr}
            className="px-4 h-9 rounded-lg text-[13px] font-semibold border-none cursor-pointer bg-[#ededed] text-black hover:bg-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
            {working ? (mode === "schedule" ? "Scheduling…" : "Sending…")
              : `${mode === "schedule" ? "Schedule" : "Send"}${many ? ` to ${recipients.length}` : ""}`}
          </button>
          <span className="text-[12px] text-[#555]">Replies go to {SENDERS[draft.sender].replyTo}</span>
        </div>
      </div>
    </Block>
  );
}

// ─── Per-user panel ───────────────────────────────────────────────────────────

export function FollowUpPanel({ user, token = "", onDone, allUsers }: { user: User; token?: string; onDone?: (msg: string) => void; allUsers?: User[] }) {
  const suggestion = useMemo(() => suggest(user), [user]);
  const emails = useUserEmails(user.id, token);
  return (
    <div className="flex flex-col gap-7 min-w-0">
      <EmailComposer key={user.id} initialRecipients={[recipientFromUser(user)]} allUsers={allUsers} token={token}
        suggestedTemplate={suggestion}
        onSent={msg => { onDone?.(msg); void emails.reload(); }} />
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
