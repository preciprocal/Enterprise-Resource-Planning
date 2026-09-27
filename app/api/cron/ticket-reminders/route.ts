// app/api/cron/ticket-reminders/route.ts
// ─────────────────────────────────────────────────────────────────────────────
// Emails everyone on the ERP access list when a support ticket has gone 24h+
// without a staff reply (see findOverdueTickets in lib/ticket-automation.ts).
// One digest email per run; each customer wait is reminded about once.
//
// Scheduled by Vercel Cron (vercel.json). Vercel sends
// `Authorization: Bearer $CRON_SECRET` when CRON_SECRET is set in the project.
// Can also be triggered manually with the x-admin-secret header, and
// ?dry=1 reports what would be sent without emailing or recording anything.
// ─────────────────────────────────────────────────────────────────────────────
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { allowedEmails } from "@/lib/admin-auth";
import { findOverdueTickets, markReminded, ticketUrl, OverdueTicket } from "@/lib/ticket-automation";

function authorised(req: NextRequest): boolean {
  const cron  = process.env.CRON_SECRET;
  const admin = process.env.ADMIN_SECRET;
  if (cron && req.headers.get("authorization") === `Bearer ${cron}`) return true;
  if (admin && req.headers.get("x-admin-secret") === admin) return true;
  return false;
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const PRIORITY_COLOR: Record<string, string> = { urgent: "#DC2626", high: "#EA580C", medium: "#2563EB", low: "#6B7280" };

function waitLabel(h: number) {
  return h >= 48 ? `${Math.floor(h / 24)} days` : `${h} hours`;
}

function digestHtml(tickets: OverdueTicket[], base: string) {
  const rows = tickets.map(t => `
    <tr>
      <td style="padding:12px 0;border-bottom:1px solid #F1F5F9">
        <a href="${esc(ticketUrl(t.id, base))}" style="font-size:14px;font-weight:600;color:#0F172A;text-decoration:none">${esc(t.subject)}</a>
        <div style="font-size:12px;color:#64748B;margin-top:2px">${esc(t.userName ?? t.userEmail ?? "Customer")}${t.userName && t.userEmail ? ` · ${esc(t.userEmail)}` : ""}</div>
      </td>
      <td style="padding:12px 0 12px 12px;border-bottom:1px solid #F1F5F9;text-align:right;white-space:nowrap;vertical-align:top">
        <div style="font-size:12px;font-weight:600;color:${PRIORITY_COLOR[t.priority] ?? "#6B7280"};text-transform:capitalize">${esc(t.priority)}</div>
        <div style="font-size:12px;color:#94A3B8;margin-top:2px">waiting ${waitLabel(t.hoursWaiting)}</div>
      </td>
    </tr>`).join("");
  return `<div style="font-family:-apple-system,BlinkMacSystemFont,'Inter',sans-serif;max-width:560px;margin:0 auto;padding:32px 24px;color:#0F172A">
    <div style="font-size:12px;font-weight:700;color:#EA580C;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:8px">Support reminder</div>
    <h2 style="margin:0 0 6px;font-size:20px">${tickets.length} ticket${tickets.length === 1 ? " has" : "s have"} waited over 24 hours</h2>
    <p style="margin:0 0 16px;font-size:14px;color:#475569;line-height:1.6">These customers haven't had a reply from support yet.</p>
    <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse">${rows}</table>
    <a href="${esc(base)}/?tab=support" style="display:inline-block;margin-top:20px;background:#0F172A;color:#fff;text-decoration:none;padding:11px 20px;border-radius:8px;font-size:14px;font-weight:600">Open support inbox</a>
    <p style="margin:20px 0 0;font-size:12px;color:#94A3B8">Sent to everyone with ERP access. You'll get one reminder per ticket each time a customer is left waiting 24 hours.</p>
  </div>`;
}

export async function GET(req: NextRequest) {
  if (!authorised(req)) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  const dry = req.nextUrl.searchParams.get("dry") === "1";

  try {
    const sb = getSupabaseAdmin();
    const overdue = await findOverdueTickets(sb);
    const recipients = [...(await allowedEmails())];
    if (!overdue.length) return NextResponse.json({ ok: true, overdue: 0, sent: false });
    if (!recipients.length) return NextResponse.json({ ok: false, overdue: overdue.length, error: "ERP access list is empty — nobody to remind" }, { status: 500 });

    const summary = overdue.map(t => ({ id: t.id, subject: t.subject, hoursWaiting: t.hoursWaiting }));
    if (dry) return NextResponse.json({ ok: true, dry: true, overdue: overdue.length, recipients: recipients.length, tickets: summary });

    const base = (process.env.ERP_PUBLIC_URL ?? req.nextUrl.origin).replace(/\/+$/, "");
    const resendKey = process.env.RESEND_API_KEY;
    const subject = overdue.length === 1
      ? `Support ticket waiting 24h+: ${overdue[0].subject}`
      : `${overdue.length} support tickets waiting 24h+`;

    if (!resendKey) {
      console.log(`📧 [DRAFT — no RESEND_API_KEY] ${subject} → ${recipients.join(", ")}`);
    } else {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from: process.env.ADMIN_FROM_EMAIL ?? "support@preciprocal.com", to: recipients, subject, html: digestHtml(overdue, base) }),
      });
      if (!res.ok) throw new Error(`Resend ${res.status}: ${await res.text().then(t => t.slice(0, 200))}`);
    }
    // Only recorded after the email went out, so a failed send is retried next run.
    await markReminded(sb, overdue);
    return NextResponse.json({ ok: true, overdue: overdue.length, recipients: recipients.length, sent: !!resendKey, tickets: summary });
  } catch (e) {
    console.error("[cron/ticket-reminders]", e);
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
