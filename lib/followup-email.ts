// lib/followup-email.ts
// Follow-up emails an admin sends to one user from the ERP (Users → Contact).
//
// Shared by the server, which sends, and the browser, which previews, so the
// preview is exactly what goes out. Nothing here touches secrets or the DB.
//
// Rendering is deliberately a personal note, not the Dashboard's branded
// shell: a one-to-one follow-up from a named person gets more replies and
// trips fewer promotion filters when it looks like a person wrote it. It still
// follows the Dashboard's load-bearing email rules (lib/email/layout.ts there):
// escape everything, pure-ASCII HTML via entities, a plain-text part, and
// utm_campaign = email_type on app links so in-app activity after a click is
// attributed to the email that caused it.

export interface FollowUpTemplate {
  id: string;
  label: string;
  /** One line shown under the label in the picker. */
  hint: string;
  subject: string;
  /** Body without greeting or signature; {{first_name}} is filled in. */
  body: string;
}

const APP = "https://app.preciprocal.com";

export const SIGNATURE = "Warm regards,\nSam Stein\nTech Support, Preciprocal\nsupport@preciprocal.com";

export const FOLLOW_UP_TEMPLATES: FollowUpTemplate[] = [
  {
    id: "check_in", label: "Check-in", hint: "Friendly touch-base with an active user",
    subject: "How's the job search going, {{first_name}}?",
    body: `I wanted to check in and see how your job search is going.\n\nIs there anything you're stuck on right now, or anything you wish Preciprocal did better? Even a one-line reply helps, and I read every one personally.`,
  },
  {
    id: "activation", label: "Get started", hint: "Signed up but hasn't used anything yet",
    subject: "Your first step on Preciprocal takes 2 minutes",
    body: `I noticed you signed up but haven't had a chance to try anything yet, so here's the quickest place to start.\n\nUpload your resume and you'll get an ATS score with specific fixes in about two minutes:\n${APP}/resume/upload\n\nFrom there you can practise a mock interview for the role you're targeting. If anything gets in the way, just reply to this email.`,
  },
  {
    id: "welcome", label: "Welcome", hint: "Personal welcome for a new signup",
    subject: "Welcome to Preciprocal, {{first_name}}",
    body: `Welcome to Preciprocal! We're really glad to have you.\n\nHere's what you can do right now:\n• Analyse your resume and get an ATS score\n• Practise mock interviews with AI feedback\n• Optimise your LinkedIn profile\n• Track every application in one place\n\nGet started here: ${APP}`,
  },
  {
    id: "upgrade", label: "Upgrade offer", hint: "Engaged free user, invite to Pro",
    subject: "An offer for you: Preciprocal Pro",
    body: `You've been getting real use out of Preciprocal, so I wanted to reach out personally with an offer on Pro.\n\nPro unlocks:\n• Unlimited cover letters\n• 30 mock interviews a month\n• The full analytics dashboard\n• Resume editor with PDF and Word export\n\nUse code [COUPON_CODE] at checkout for [X]% off your first month:\n${APP}/pricing`,
  },
  {
    id: "win_back", label: "Win-back", hint: "Cancelled or gone quiet",
    subject: "We miss you, {{first_name}}",
    body: `It's been a little while, so I wanted to reach out.\n\nHere's what's new since you were last here:\n• [New feature 1]\n• [New feature 2]\n\nIf you'd like to pick up where you left off, everything you saved is still there:\n${APP}\n\nAnd if something didn't work for you, I'd genuinely like to hear what. Just reply.`,
  },
  {
    id: "payment", label: "Payment issue", hint: "Card failed or subscription past due",
    subject: "Action needed: payment issue on your Preciprocal account",
    body: `We couldn't process the latest payment for your Preciprocal subscription. To keep your access uninterrupted, please update your billing details:\n${APP}/settings?section=billing\n\nIf you think this is a mistake, reply to this email and I'll sort it out.`,
  },
  {
    id: "feedback", label: "Feedback", hint: "Ask what's working and what isn't",
    subject: "Quick question about Preciprocal",
    body: `I'm reaching out personally to ask: how has Preciprocal been working for you?\n\nWhat's one thing that's been useful, and one thing that's been frustrating? Your answer goes straight to the people building it.`,
  },
  {
    id: "custom", label: "Custom", hint: "Start from a blank message",
    subject: "", body: "",
  },
];

export const templateById = (id: string) => FOLLOW_UP_TEMPLATES.find(t => t.id === id);
/** email_sends.email_type for ERP follow-ups; also the utm_campaign on links. */
export const emailTypeFor = (templateId: string) => `erp_${templateById(templateId) ? templateId : "custom"}`;

/** "Bruce Wayne" -> "Bruce". Falls back to something that still reads. */
export function firstName(name?: string | null): string {
  const f = (name ?? "").trim().split(/\s+/)[0];
  return f && f.length <= 40 ? f : "there";
}

export const fillVars = (text: string, name?: string | null) => text.replace(/\{\{\s*first_name\s*\}\}/g, firstName(name));

/** Full plain-text message: greeting, body, signature. */
export function composeText(body: string, name?: string | null): string {
  return `Hi ${firstName(name)},\n\n${fillVars(body, name).trim()}\n\n${SIGNATURE}`;
}

/** Unfilled placeholders like [COUPON_CODE] that must not reach a user. */
export function unfilledPlaceholders(text: string): string[] {
  return [...new Set(text.match(/\[[A-Z0-9_ ]{1,40}\]|\[New feature \d\]|\[X\]/g) ?? [])];
}

// ─── Rendering ────────────────────────────────────────────────────────────────

const escapeHtml = (v: string) => v
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
/** Pure-ASCII output: every non-ASCII char becomes a numeric entity. */
const asciiEntities = (v: string) => v.replace(/[^\x00-\x7f]/gu, c => `&#${c.codePointAt(0)};`);

const isAppUrl = (url: string) => /^https:\/\/(app\.)?preciprocal\.com(\/|$|\?)/.test(url);

function tagUrl(url: string, campaign: string): string {
  if (!isAppUrl(url) || url.includes("/api/") || url.includes("utm_source=")) return url;
  const [base, hash] = url.split("#");
  const tagged = `${base}${base.includes("?") ? "&" : "?"}utm_source=email&utm_medium=email&utm_campaign=${encodeURIComponent(campaign)}`;
  return hash !== undefined ? `${tagged}#${hash}` : tagged;
}

const URL_RE = /https?:\/\/[^\s<>"')]+[^\s<>"').,;:!?]/g;

/** Plain-text part, with app links tagged. */
export function renderText(text: string, campaign: string): string {
  return text.replace(URL_RE, u => tagUrl(u, campaign));
}

/** HTML part: a simple personal-note layout that reads well in every client. */
export function renderHtml(text: string, campaign: string): string {
  const paragraphs = text.split(/\n{2,}/).map(p => {
    const lines = p.split("\n").map(line => {
      let out = "", last = 0;
      for (const m of line.matchAll(URL_RE)) {
        out += escapeHtml(line.slice(last, m.index));
        const href = tagUrl(m[0], campaign);
        out += `<a href="${escapeHtml(href)}" style="color:#4f46e5;text-decoration:underline;">${escapeHtml(m[0])}</a>`;
        last = (m.index ?? 0) + m[0].length;
      }
      return out + escapeHtml(line.slice(last));
    });
    return `<p style="margin:0 0 16px 0;">${lines.join("<br>")}</p>`;
  }).join("");
  return asciiEntities(
    `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>` +
    `<body style="margin:0;padding:0;background:#ffffff;">` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td style="padding:24px 16px;">` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;"><tr>` +
    `<td style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#1f2937;">` +
    paragraphs +
    `</td></tr></table></td></tr></table></body></html>`,
  );
}

// ─── Scheduling ───────────────────────────────────────────────────────────────

/** Resend accepts scheduled_at up to 30 days ahead. */
export const MAX_SCHEDULE_DAYS = 30;
/** Earliest schedule, so a "scheduled" email can't be one that is effectively immediate. */
export const MIN_SCHEDULE_MS = 2 * 60_000;

export function scheduleError(iso: string, now = Date.now()): string | null {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "Pick a valid date and time";
  if (t < now + MIN_SCHEDULE_MS) return "Pick a time at least 2 minutes from now";
  if (t > now + MAX_SCHEDULE_DAYS * 86_400_000) return `Resend can schedule at most ${MAX_SCHEDULE_DAYS} days ahead`;
  return null;
}
