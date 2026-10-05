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
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AdminIdentity } from "@/lib/admin-auth";
import { emailTypeFor, renderHtml, renderText, scheduleError, unfilledPlaceholders } from "@/lib/followup-email";

const RESEND = "https://api.resend.com";
const resendKey = () => process.env.RESEND_API_KEY ?? "";

export class EmailError extends Error { constructor(message: string, public status = 400) { super(message); } }

// ─── Send / schedule ──────────────────────────────────────────────────────────

export interface SendArgs {
  userId: string; toEmail: string; subject: string;
  /** Full plain-text message as the admin wrote it (greeting and signature included). */
  text: string;
  templateId?: string;
  /** ISO time; omitted = send now. */
  scheduledAt?: string;
  sentBy: AdminIdentity;
}

export async function sendFollowUp(sb: SupabaseClient, a: SendArgs) {
  const subject = a.subject.trim(), text = a.text.trim();
  if (!a.toEmail || !subject || !text) throw new EmailError("Missing subject, body, or toEmail");
  const left = unfilledPlaceholders(`${subject}\n${text}`);
  if (left.length) throw new EmailError(`Fill in ${left.join(", ")} before sending`);
  if (a.scheduledAt) {
    const err = scheduleError(a.scheduledAt);
    if (err) throw new EmailError(err);
  }

  const emailType = emailTypeFor(a.templateId ?? "custom");
  const key = resendKey();
  if (!key) {
    if (a.scheduledAt) throw new EmailError("Scheduling needs RESEND_API_KEY", 500);
    console.log("📧 [DRAFT — no RESEND_API_KEY]\nTo:", a.toEmail, "\nSubject:", subject, "\n", text);
    return { draft: true as const, resendId: null, scheduledAt: null, emailType };
  }

  const res = await fetch(`${RESEND}/emails`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: process.env.ADMIN_FROM_EMAIL ?? "support@preciprocal.com",
      to: [a.toEmail], subject,
      html: renderHtml(text, emailType),
      text: renderText(text, emailType),
      ...(a.scheduledAt ? { scheduled_at: new Date(a.scheduledAt).toISOString() } : {}),
      tags: [{ name: "source", value: "erp" }, { name: "email_type", value: emailType }],
    }),
  });
  if (!res.ok) throw new EmailError(`Resend error: ${(await res.text()).slice(0, 300)}`, 502);
  const { id } = await res.json() as { id?: string };
  if (!id) throw new EmailError("Resend accepted the email but returned no id", 502);

  // Best effort from here: the email is already queued, so a logging failure
  // must not be reported as a failed send.
  const sentAt = a.scheduledAt ? new Date(a.scheduledAt).toISOString() : new Date().toISOString();
  const { error } = await sb.from("email_sends").insert({ resend_id: id, user_id: a.userId, email_type: emailType, subject: subject.slice(0, 200), sent_at: sentAt });
  if (error) console.error("[erp-emails] email_sends insert failed:", error.message);
  await audit(sb, a.sentBy, a.scheduledAt ? "email_scheduled" : "email_sent", { userId: a.userId, to: a.toEmail, subject, resendId: id, emailType, scheduledAt: a.scheduledAt ?? null });

  return { draft: false as const, resendId: id, scheduledAt: a.scheduledAt ?? null, emailType };
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
