// lib/erp-emails.ts — server only.
// Send, schedule, cancel and track the follow-up emails admins send from the ERP.
//
// Tracking reuses the Dashboard's pipeline rather than building a second one:
//   email_sends   one row per email, keyed by Resend's message id. The ERP
//                 writes it at send time with email_type "erp_<template>".
//   email_events  delivered / opened / clicked / bounced / complained, written
//                 by the Dashboard's Resend webhook (app/api/webhooks/resend),
//                 which records events for every email on the Resend account,
//                 so ERP sends are covered with no extra endpoint.
// When the webhook hasn't reported anything for an email (not set up yet, or
// still on its way), Resend's own last_event is used as a fallback, so an
// admin still sees Delivered / Opened, just without per-open timestamps.
//
// Scheduling is Resend's native scheduled_at (exact delivery, cancellable, up
// to 30 days out), not a cron job: Vercel Hobby crons run once a day.
import { createHmac } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AdminIdentity } from "@/lib/admin-auth";
import {
  composeEmail, scheduleError, unfilledPlaceholders, SENDERS, MAX_RECIPIENTS, MAX_BUTTONS, brokenButtons, type Draft, type SenderId,
} from "@/lib/followup-email";

const RESEND = "https://api.resend.com";
const resendKey = () => process.env.RESEND_API_KEY ?? "";
const APP = "https://app.preciprocal.com";

export class EmailError extends Error { constructor(message: string, public status = 400) { super(message); } }

// ─── Unsubscribe ──────────────────────────────────────────────────────────────
// The Dashboard's signed link (lib/email/unsubscribe.ts there), scope "all".
// Same message and key (CRON_SECRET), so the Dashboard's endpoint verifies a
// link signed here. Without CRON_SECRET the link falls back to Settings, as
// it does in the Dashboard, and no List-Unsubscribe header is sent.

function unsubscribeUrl(userId: string): { url: string; signed: boolean } {
  const key = process.env.CRON_SECRET;
  if (!key) return { url: `${APP}/settings?section=notifications`, signed: false };
  const t = createHmac("sha256", key).update(`unsubscribe:all:${userId}`).digest("hex").slice(0, 32);
  return { url: `${APP}/api/email/unsubscribe?${new URLSearchParams({ u: userId, s: "all", t })}`, signed: true };
}

// ─── Send / schedule ──────────────────────────────────────────────────────────

export interface SendArgs {
  /** Users, by id. Their address and name are read here, never taken from the browser. */
  userIds: string[];
  /** Typed addresses. Matched to a user when one has that address. */
  emails?: string[];
  draft: Draft;
  /** ISO time; omitted = send now. */
  scheduledAt?: string;
  sentBy: AdminIdentity;
}

export interface SendResult {
  email: string; userId: string | null; name: string | null;
  status: "sent" | "scheduled" | "skipped" | "failed" | "draft";
  reason?: string; resendId?: string;
}

interface Recipient { email: string; userId: string | null; name: string | null; optedOut: boolean }

const EMAIL_RE = /^[^\s@<>(),;:"]+@[^\s@<>(),;:"]+\.[^\s@<>(),;:"]+$/;

async function resolveRecipients(sb: SupabaseClient, userIds: string[], emails: string[]): Promise<{ list: Recipient[]; invalid: string[] }> {
  const cols = "user_id,name,email,activation_email_opt_out";
  const typed = [...new Set(emails.map(e => e.trim().toLowerCase()).filter(Boolean))];
  const invalid = typed.filter(e => !EMAIL_RE.test(e));
  const valid = typed.filter(e => EMAIL_RE.test(e));

  const [byId, byEmail] = await Promise.all([
    userIds.length ? sb.from("profiles").select(cols).in("user_id", userIds) : Promise.resolve({ data: [], error: null }),
    valid.length ? sb.from("profiles").select(cols).in("email", valid) : Promise.resolve({ data: [], error: null }),
  ]);
  if (byId.error) throw new Error(`profiles: ${byId.error.message}`);
  if (byEmail.error) throw new Error(`profiles: ${byEmail.error.message}`);

  const seen = new Set<string>();
  const list: Recipient[] = [];
  const add = (r: Recipient) => { const k = r.email.toLowerCase(); if (!seen.has(k)) { seen.add(k); list.push(r); } };
  type P = { user_id: string; name: string | null; email: string | null; activation_email_opt_out: boolean | null };
  for (const p of [...(byId.data ?? []), ...(byEmail.data ?? [])] as P[]) {
    if (p.email) add({ email: p.email, userId: p.user_id, name: p.name, optedOut: p.activation_email_opt_out === true });
  }
  for (const e of valid) add({ email: e, userId: null, name: null, optedOut: false });
  return { list, invalid };
}

/** Pause between single sends: Resend allows about 2 requests a second. */
const pause = () => new Promise(r => setTimeout(r, 550));

export async function sendEmails(sb: SupabaseClient, a: SendArgs): Promise<{ results: SendResult[]; draft: boolean }> {
  const d: Draft = { ...a.draft, subject: a.draft.subject.trim(), body: a.draft.body.trim() };
  if (!SENDERS[d.sender as SenderId]) throw new EmailError("Unknown sender");
  if (!d.subject || !d.body) throw new EmailError("Subject and message are required");
  d.buttons = Array.isArray(d.buttons) ? d.buttons.filter(b => b && typeof b.label === "string" && typeof b.url === "string") : [];
  const left = unfilledPlaceholders([d.subject, d.heading, d.eyebrow, d.body, ...d.buttons.flatMap(b => [b.label, b.url])].join("\n"));
  if (left.length) throw new EmailError(`Fill in ${left.join(", ")} before sending`);
  if (d.buttons.length > MAX_BUTTONS) throw new EmailError(`At most ${MAX_BUTTONS} buttons`);
  if (brokenButtons(d.buttons).length) throw new EmailError("Each button needs text and a full link starting with https://");
  if (a.scheduledAt) {
    const err = scheduleError(a.scheduledAt);
    if (err) throw new EmailError(err);
  }

  const { list, invalid } = await resolveRecipients(sb, a.userIds, a.emails ?? []);
  if (invalid.length) throw new EmailError(`Not a valid email address: ${invalid.join(", ")}`);
  if (!list.length) throw new EmailError("Add at least one recipient with an email address");
  if (list.length > MAX_RECIPIENTS) throw new EmailError(`At most ${MAX_RECIPIENTS} recipients per send`);

  // Anything to more than one person is optional by definition: it is not
  // about any one person's account.
  if (list.length > 1) d.optional = true;

  const results: SendResult[] = [];
  const toSend: { r: Recipient; payload: Record<string, unknown> }[] = [];
  for (const r of list) {
    const base = { email: r.email, userId: r.userId, name: r.name };
    if (d.optional && r.optedOut) { results.push({ ...base, status: "skipped", reason: "Opted out of optional emails" }); continue; }
    if (d.optional && !r.userId) { results.push({ ...base, status: "skipped", reason: "Not a Preciprocal user, so there is no way to unsubscribe. Send it as a reply instead." }); continue; }
    const unsub = d.optional && r.userId ? unsubscribeUrl(r.userId) : null;
    const m = composeEmail(d, r, unsub?.url);
    toSend.push({ r, payload: {
      from: m.from, reply_to: m.replyTo, to: [r.email], subject: m.subject, html: m.html, text: m.text,
      ...(unsub?.signed ? { headers: { "List-Unsubscribe": `<${unsub.url}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" } } : {}),
      tags: [{ name: "source", value: "erp" }, { name: "email_type", value: m.emailType }],
    } });
  }

  const key = resendKey();
  if (!key) {
    if (a.scheduledAt) throw new EmailError("Scheduling needs RESEND_API_KEY", 500);
    for (const { r, payload } of toSend) {
      console.log("📧 [DRAFT, no RESEND_API_KEY] To:", r.email, "Subject:", payload.subject);
      results.push({ email: r.email, userId: r.userId, name: r.name, status: "draft" });
    }
    return { results, draft: true };
  }

  const headers = { Authorization: `Bearer ${key}`, "Content-Type": "application/json" };
  const sent: { r: Recipient; id: string; subject: string }[] = [];
  if (!a.scheduledAt && toSend.length > 1) {
    // One request for everyone. The batch endpoint does not take scheduled_at.
    const res = await fetch(`${RESEND}/emails/batch`, { method: "POST", headers, body: JSON.stringify(toSend.map(x => x.payload)) });
    if (!res.ok) throw new EmailError(`Resend error: ${(await res.text()).slice(0, 300)}`, 502);
    const ids = ((await res.json()) as { data?: { id: string }[] }).data ?? [];
    toSend.forEach((x, i) => {
      const id = ids[i]?.id;
      if (id) sent.push({ r: x.r, id, subject: String(x.payload.subject) });
      else results.push({ email: x.r.email, userId: x.r.userId, name: x.r.name, status: "failed", reason: "Resend returned no id" });
    });
  } else {
    for (const [i, x] of toSend.entries()) {
      if (i) await pause();
      const res = await fetch(`${RESEND}/emails`, {
        method: "POST", headers,
        body: JSON.stringify({ ...x.payload, ...(a.scheduledAt ? { scheduled_at: new Date(a.scheduledAt).toISOString() } : {}) }),
      });
      const id = res.ok ? ((await res.json()) as { id?: string }).id : undefined;
      if (id) sent.push({ r: x.r, id, subject: String(x.payload.subject) });
      else results.push({ email: x.r.email, userId: x.r.userId, name: x.r.name, status: "failed", reason: res.ok ? "Resend returned no id" : `Resend error: ${(await res.text()).slice(0, 200)}` });
    }
  }

  // Best effort from here: the emails are already queued, so a logging
  // failure must not be reported as a failed send.
  const emailType = composeEmail(d, {}).emailType;
  const sentAt = a.scheduledAt ? new Date(a.scheduledAt).toISOString() : new Date().toISOString();
  if (sent.length) {
    const { error } = await sb.from("email_sends").insert(sent.map(s => ({
      resend_id: s.id, user_id: s.r.userId, email_type: emailType, subject: s.subject.slice(0, 200), sent_at: sentAt,
    })));
    if (error) console.error("[erp-emails] email_sends insert failed:", error.message);
  }
  for (const s of sent) results.push({ email: s.r.email, userId: s.r.userId, name: s.r.name, status: a.scheduledAt ? "scheduled" : "sent", resendId: s.id });
  await audit(sb, a.sentBy, a.scheduledAt ? "email_scheduled" : "email_sent", {
    subject: d.subject, emailType, sender: d.sender, scheduledAt: a.scheduledAt ?? null,
    recipients: results.map(r => ({ to: r.email, userId: r.userId, status: r.status, resendId: r.resendId ?? null, reason: r.reason ?? null })),
  });

  return { results, draft: false };
}

// ─── Cancel ───────────────────────────────────────────────────────────────────

export async function cancelFollowUp(sb: SupabaseClient, resendId: string, sentBy: AdminIdentity) {
  const { data: row } = await sb.from("email_sends").select("resend_id,user_id,email_type,subject,sent_at").eq("resend_id", resendId).maybeSingle();
  if (!row || !String(row.email_type).startsWith("erp_")) throw new EmailError("Only follow-ups sent from the ERP can be cancelled here", 404);
  if (Date.parse(row.sent_at) <= Date.now()) throw new EmailError("This email has already been sent");

  const res = await fetch(`${RESEND}/emails/${encodeURIComponent(resendId)}/cancel`, { method: "POST", headers: { Authorization: `Bearer ${resendKey()}` } });
  if (!res.ok) throw new EmailError(`Resend error: ${(await res.text()).slice(0, 300)}`, 502);

  // No webhook fires for a cancel, so record it ourselves.
  const { error } = await sb.from("email_events").insert({ resend_id: resendId, event: "canceled", created_at: new Date().toISOString() });
  if (error) console.error("[erp-emails] cancel event insert failed:", error.message);
  await audit(sb, sentBy, "email_canceled", { userId: row.user_id, subject: row.subject, resendId });
  return { canceled: true };
}

async function audit(sb: SupabaseClient, by: AdminIdentity, action: string, details: Record<string, unknown>) {
  const { error } = await sb.from("erp_logs").insert({ user_id: by.userId ?? "admin-secret", user_name: by.name || null, user_email: by.email || null, type: "action", action, details: { app: "erp", ...details } });
  if (error) console.error("[erp-emails] audit log failed:", error.message);
}

// ─── History with engagement ──────────────────────────────────────────────────

export type EmailStatus = "scheduled" | "sent" | "delivered" | "opened" | "clicked" | "bounced" | "complained" | "delayed" | "canceled";

export interface UserEmail {
  resendId: string; emailType: string; subject: string | null; sentAt: string; status: EmailStatus;
  fromErp: boolean;
  deliveredAt: string | null; opens: number; firstOpenedAt: string | null; lastOpenedAt: string | null;
  clicks: number; firstClickedAt: string | null; links: string[];
  /** Where the status came from: webhook events (with times), Resend's last_event, or nothing yet. */
  source: "webhook" | "resend" | "none";
}

const RANK: EmailStatus[] = ["sent", "delayed", "delivered", "opened", "clicked", "complained", "bounced"];
const fromResend = (e?: string): EmailStatus | null => {
  switch (e) {
    case "scheduled": return "scheduled";
    case "canceled": case "cancelled": return "canceled";
    case "delivered": return "delivered";
    case "opened": return "opened";
    case "clicked": return "clicked";
    case "bounced": case "hard_bounced": case "soft_bounced": return "bounced";
    case "complained": return "complained";
    case "delivery_delayed": return "delayed";
    case "sent": case "queued": return "sent";
    default: return null;
  }
};

export async function userEmails(sb: SupabaseClient, userId: string) {
  const { data: sends, error } = await sb.from("email_sends").select("resend_id,email_type,subject,sent_at").eq("user_id", userId).order("sent_at", { ascending: false }).limit(50);
  if (error) throw new Error(`email_sends: ${error.message}`);
  const ids = (sends ?? []).map(s => s.resend_id as string);

  const [ev, anyEvents] = await Promise.all([
    ids.length ? sb.from("email_events").select("resend_id,event,link,created_at").in("resend_id", ids).order("created_at") : Promise.resolve({ data: [] as Record<string, unknown>[] }),
    sb.from("email_events").select("id", { count: "exact", head: true }).neq("event", "canceled"),
  ]);
  const byId = new Map<string, { event: string; link: string | null; created_at: string }[]>();
  for (const e of (ev.data ?? []) as { resend_id: string; event: string; link: string | null; created_at: string }[]) {
    (byId.get(e.resend_id) ?? byId.set(e.resend_id, []).get(e.resend_id)!).push(e);
  }

  // Fallback for emails the webhook hasn't reported on: Resend's last_event.
  const needResend = ids.filter(id => !byId.get(id)?.length);
  const resendStatus = needResend.length && resendKey() ? await resendLastEvents(needResend) : new Map<string, string>();

  const now = Date.now();
  const emails: UserEmail[] = (sends ?? []).map(s => {
    const list = byId.get(s.resend_id) ?? [];
    const at = (t: string) => list.filter(e => e.event === t).map(e => e.created_at);
    const opened = at("opened"), clicked = at("clicked"), delivered = at("delivered");
    let status: EmailStatus;
    let source: UserEmail["source"] = list.length ? "webhook" : "none";
    if (list.some(e => e.event === "canceled")) status = "canceled";
    else if (list.length) {
      status = list.reduce<EmailStatus>((best, e) => {
        const st = fromResend(e.event === "delivery_delayed" ? "delivery_delayed" : e.event);
        return st && RANK.indexOf(st) > RANK.indexOf(best) ? st : best;
      }, "sent");
    } else {
      const r = fromResend(resendStatus.get(s.resend_id));
      if (r) source = "resend";
      status = r ?? (Date.parse(s.sent_at) > now ? "scheduled" : "sent");
    }
    if (status !== "canceled" && Date.parse(s.sent_at) > now) status = "scheduled";
    return {
      resendId: s.resend_id, emailType: s.email_type, subject: s.subject, sentAt: s.sent_at, status,
      fromErp: String(s.email_type).startsWith("erp_"),
      deliveredAt: delivered[0] ?? null,
      opens: opened.length, firstOpenedAt: opened[0] ?? null, lastOpenedAt: opened.at(-1) ?? null,
      clicks: clicked.length, firstClickedAt: clicked[0] ?? null,
      links: [...new Set(list.filter(e => e.event === "clicked" && e.link).map(e => e.link as string))],
      source,
    };
  });

  return { emails, from: process.env.ADMIN_FROM_EMAIL ?? "support@preciprocal.com", tracking: { webhook: (anyEvents.count ?? 0) > 0, resend: !!resendKey() } };
}

/** last_event per id: one list call (newest 100), then a few direct lookups. Resend allows ~2 req/s. */
async function resendLastEvents(ids: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const headers = { Authorization: `Bearer ${resendKey()}` };
  try {
    const r = await fetch(`${RESEND}/emails?limit=100`, { headers, cache: "no-store" });
    if (r.ok) for (const e of ((await r.json()) as { data?: { id: string; last_event: string }[] }).data ?? []) out.set(e.id, e.last_event);
    for (const id of ids.filter(i => !out.has(i)).slice(0, 3)) {
      const one = await fetch(`${RESEND}/emails/${encodeURIComponent(id)}`, { headers, cache: "no-store" });
      if (one.ok) out.set(id, ((await one.json()) as { last_event?: string }).last_event ?? "");
    }
  } catch (e) { console.error("[erp-emails] Resend status lookup failed:", e); }
  return out;
}
