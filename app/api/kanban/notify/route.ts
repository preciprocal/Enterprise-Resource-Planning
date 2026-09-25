// app/api/kanban/notify/route.ts
// ─────────────────────────────────────────────────────────────────────────────
// Sends email notifications for Kanban events via Resend.
//
// POST body shapes:
//
//  @mention in comment:
//  { type: "mention", from: "Yash D.", cardTitle: "Fix bug", comment: "Hey @Maya...", emails: ["maya@..."] }
//
//  Due date reminder (24h before):
//  { type: "due_reminder", emails: ["yash@..."], cards: ["Fix bug", "CSV export"] }
//
//  Blocked card escalation (optional, called manually or via cron):
//  { type: "blocked", cardTitle: "Cloudflare stream", blockedBy: "Waiting for plan", emails: ["yash@..."] }
//
// Requires an admin x-admin-token header (same as all other admin routes).
// Falls back to console.log if RESEND_API_KEY is not set (dev mode).
// ─────────────────────────────────────────────────────────────────────────────
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { getAdmin } from "@/lib/admin-auth";

// ─── Resend sender ────────────────────────────────────────────────────────────
const FROM = process.env.ADMIN_FROM_EMAIL ?? "noreply@preciprocal.com";
const RESEND_KEY = process.env.RESEND_API_KEY;

async function sendEmail(to: string[], subject: string, html: string): Promise<boolean> {
  if (!RESEND_KEY) {
    console.log("📧 [DRAFT — no RESEND_API_KEY]");
    console.log("To:", to.join(", "));
    console.log("Subject:", subject);
    return true; // pretend sent in dev
  }

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${RESEND_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from: FROM, to, subject, html }),
  });

  if (!res.ok) {
    const err = await res.text();
    console.error("Resend error:", err);
    return false;
  }
  return true;
}

// ─── Email templates ──────────────────────────────────────────────────────────
function baseTemplate(content: string): string {
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#F8FAFC;font-family:-apple-system,BlinkMacSystemFont,'Inter',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#F8FAFC;padding:40px 0">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08)">
        <!-- Header -->
        <tr><td style="background:linear-gradient(135deg,#4F6FF0,#7C4FE0);padding:24px 32px">
          <table width="100%" cellpadding="0" cellspacing="0"><tr>
            <td><span style="font-size:20px;font-weight:800;color:#fff;letter-spacing:-0.5px">Preciprocal</span><span style="font-size:11px;color:rgba(255,255,255,0.65);margin-left:8px;font-weight:600;text-transform:uppercase;letter-spacing:0.05em">ERP</span></td>
            <td align="right"><span style="font-size:11px;color:rgba(255,255,255,0.7);font-weight:500">Tasks &amp; Board</span></td>
          </tr></table>
        </td></tr>
        <!-- Body -->
        <tr><td style="padding:32px">${content}</td></tr>
        <!-- Footer -->
        <tr><td style="padding:20px 32px;border-top:1px solid #F1F5F9;background:#F8FAFC">
          <p style="margin:0;font-size:11px;color:#94A3B8;text-align:center">
            You received this because you were mentioned or have a task due.<br>
            <a href="https://erp.preciprocal.com" style="color:#4F6FF0;text-decoration:none">Open Preciprocal ERP</a>
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

function mentionTemplate(from: string, cardTitle: string, comment: string): string {
  // Highlight @mentions in the comment
  const highlighted = comment.replace(
    /@(\w+)/g,
    '<strong style="color:#4F6FF0">@$1</strong>'
  );
  return baseTemplate(`
    <div style="margin-bottom:24px">
      <div style="display:inline-block;background:#EEF2FF;border-radius:8px;padding:4px 10px;font-size:11px;font-weight:700;color:#4F6FF0;margin-bottom:16px">💬 New Mention</div>
      <h2 style="margin:0 0 4px;font-size:20px;font-weight:700;color:#0F172A;letter-spacing:-0.3px">${escHtml(from)} mentioned you</h2>
      <p style="margin:0;font-size:13px;color:#64748B">in a comment on <strong style="color:#0F172A">${escHtml(cardTitle)}</strong></p>
    </div>
    <div style="background:#F8FAFC;border:1px solid #E2E8F0;border-left:4px solid #4F6FF0;border-radius:0 10px 10px 0;padding:16px 20px;margin-bottom:24px">
      <p style="margin:0;font-size:14px;color:#374151;line-height:1.7">${highlighted}</p>
    </div>
    <a href="https://erp.preciprocal.com" style="display:inline-block;background:linear-gradient(135deg,#4F6FF0,#7C4FE0);color:#fff;text-decoration:none;padding:12px 24px;border-radius:9px;font-size:13px;font-weight:700">View Card →</a>
  `);
}

function dueReminderTemplate(cards: string[]): string {
  const cardList = cards.map(c =>
    `<li style="padding:8px 0;border-bottom:1px solid #F1F5F9;font-size:13px;color:#374151;font-weight:500">📌 ${escHtml(c)}</li>`
  ).join("");
  return baseTemplate(`
    <div style="margin-bottom:24px">
      <div style="display:inline-block;background:#FFF7ED;border-radius:8px;padding:4px 10px;font-size:11px;font-weight:700;color:#EA580C;margin-bottom:16px">⏰ Due Tomorrow</div>
      <h2 style="margin:0 0 4px;font-size:20px;font-weight:700;color:#0F172A;letter-spacing:-0.3px">You have ${cards.length} task${cards.length > 1 ? "s" : ""} due tomorrow</h2>
      <p style="margin:0;font-size:13px;color:#64748B">Make sure these are on track before end of day.</p>
    </div>
    <ul style="margin:0 0 24px;padding:0;list-style:none;background:#F8FAFC;border:1px solid #E2E8F0;border-radius:10px;padding:4px 16px">${cardList}</ul>
    <a href="https://erp.preciprocal.com" style="display:inline-block;background:linear-gradient(135deg,#4F6FF0,#7C4FE0);color:#fff;text-decoration:none;padding:12px 24px;border-radius:9px;font-size:13px;font-weight:700">Open Board →</a>
  `);
}

function blockedTemplate(cardTitle: string, blockedBy: string): string {
  return baseTemplate(`
    <div style="margin-bottom:24px">
      <div style="display:inline-block;background:#FEF2F2;border-radius:8px;padding:4px 10px;font-size:11px;font-weight:700;color:#DC2626;margin-bottom:16px">🚫 Card Blocked</div>
      <h2 style="margin:0 0 4px;font-size:20px;font-weight:700;color:#0F172A;letter-spacing:-0.3px">${escHtml(cardTitle)}</h2>
      <p style="margin:0;font-size:13px;color:#64748B">This card has been blocked for over 48 hours.</p>
    </div>
    <div style="background:#FEF2F2;border:1px solid #FCA5A5;border-left:4px solid #DC2626;border-radius:0 10px 10px 0;padding:16px 20px;margin-bottom:24px">
      <p style="margin:0 0 4px;font-size:11px;font-weight:700;color:#DC2626;text-transform:uppercase;letter-spacing:0.05em">Blocked by</p>
      <p style="margin:0;font-size:14px;color:#374151;font-weight:500">${escHtml(blockedBy)}</p>
    </div>
    <a href="https://erp.preciprocal.com" style="display:inline-block;background:linear-gradient(135deg,#4F6FF0,#7C4FE0);color:#fff;text-decoration:none;padding:12px 24px;border-radius:9px;font-size:13px;font-weight:700">Resolve on Board →</a>
  `);
}

// Basic HTML escaping to prevent injection in email templates
function escHtml(str: string): string {
  return str.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}

// ─── POST ─────────────────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  if (!(await getAdmin(req))) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });

  let body: Record<string, unknown>;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const type    = body.type as string;
  const emails  = body.emails as string[];

  if (!type || !emails?.length) {
    return NextResponse.json({ error: "Missing type or emails" }, { status: 400 });
  }

  // Dedupe and sanitise emails
  const to = [...new Set(emails)].filter(e => e && e.includes("@"));
  if (!to.length) return NextResponse.json({ error: "No valid emails" }, { status: 400 });

  let subject = "";
  let html    = "";

  if (type === "mention") {
    const from      = body.from as string ?? "A teammate";
    const cardTitle = body.cardTitle as string ?? "a card";
    const comment   = body.comment as string ?? "";
    subject = `${from} mentioned you in "${cardTitle}"`;
    html    = mentionTemplate(from, cardTitle, comment);
  }

  else if (type === "due_reminder") {
    const cards = body.cards as string[] ?? [];
    subject = `⏰ ${cards.length} task${cards.length > 1 ? "s" : ""} due tomorrow`;
    html    = dueReminderTemplate(cards);
  }

  else if (type === "blocked") {
    const cardTitle = body.cardTitle as string ?? "A card";
    const blockedBy = body.blockedBy as string ?? "Unknown reason";
    subject = `🚫 Card blocked: "${cardTitle}"`;
    html    = blockedTemplate(cardTitle, blockedBy);
  }

  else {
    return NextResponse.json({ error: `Unknown type: ${type}` }, { status: 400 });
  }

  const sent = await sendEmail(to, subject, html);

  return NextResponse.json({
    ok: true,
    sent,
    draft: !RESEND_KEY,
    to,
    type,
  });
}