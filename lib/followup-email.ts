// lib/followup-email.ts
// Emails an admin sends from the ERP, to one user or to many.
//
// Shared by the server, which sends, and the browser, which previews, so the
// preview is exactly what goes out. Nothing here touches secrets or the DB.
//
// Every email goes out in the Dashboard's branded shell (lib/email-shell.ts),
// signed by the same people the product's own emails are signed by:
//   Francesca, Customer Success     check-ins, onboarding, offers, feedback
//   Preciprocal Support             replies to a problem, payment issues
// She has one role in every email (the Dashboard's lib/email/sender.ts);
// keep it that way here.
//
// ─── Optional vs service emails ─────────────────────────────────────────────
// An optional email (a check-in, an offer, anything sent to several people at
// once) carries an unsubscribe link and is not sent to anyone who has opted
// out. A service email (a reply to one person, a payment problem) does not:
// it is about their account. lib/erp-emails.ts enforces this.

import { escapeHtml, renderShell, renderShellText, textToParagraphs } from "@/lib/email-shell";

const APP = "https://app.preciprocal.com";

// ─── Senders ──────────────────────────────────────────────────────────────────

export type SenderId = "francesca" | "support";

export const SENDERS: Record<SenderId, {
  label: string; from: string; replyTo: string;
  signature: { name: string; title?: string; email: string };
}> = {
  francesca: {
    label: "Francesca, Customer Success",
    from: "Francesca from Preciprocal <francesca@preciprocal.com>",
    replyTo: "francesca@preciprocal.com",
    signature: { name: "Francesca", title: "Customer Success, Preciprocal", email: "francesca@preciprocal.com" },
  },
  support: {
    label: "Preciprocal Support",
    from: "Preciprocal Support <support@preciprocal.com>",
    replyTo: "support@preciprocal.com",
    signature: { name: "Preciprocal Support", email: "support@preciprocal.com" },
  },
};

// ─── Templates ────────────────────────────────────────────────────────────────

export interface FollowUpTemplate {
  id: string;
  label: string;
  /** One line shown under the label in the picker. */
  hint: string;
  sender: SenderId;
  /** Optional emails carry an unsubscribe link and skip people who opted out. */
  optional: boolean;
  eyebrow: string;
  subject: string;
  heading: string;
  /** Message body. {{first_name}} is filled in per recipient. */
  body: string;
  cta?: { label: string; url: string };
}

export const FOLLOW_UP_TEMPLATES: FollowUpTemplate[] = [
  {
    id: "check_in", label: "Check-in", hint: "Friendly touch-base with an active user",
    sender: "francesca", optional: true, eyebrow: "Checking in",
    subject: "How's the job search going, {{first_name}}?",
    heading: "How's the search going, {{first_name}}?",
    body: `I wanted to check in and see how your job search is going.\n\nIs there anything you're stuck on right now, or anything you wish Preciprocal did better? Even a one-line reply helps, and I read every one.`,
  },
  {
    id: "activation", label: "Get started", hint: "Signed up but hasn't used anything yet",
    sender: "francesca", optional: true, eyebrow: "Your first step",
    subject: "Your first step on Preciprocal takes 2 minutes",
    heading: "Start with your resume, {{first_name}}",
    body: `I noticed you signed up but haven't had a chance to try anything yet, so here's the quickest place to start.\n\nUpload your resume and you'll get an ATS score with specific fixes in about two minutes. From there you can practise a mock interview for the role you're targeting.\n\nIf anything gets in the way, just reply to this email.`,
    cta: { label: "Score my resume", url: `${APP}/resume/upload` },
  },
  {
    id: "welcome", label: "Welcome", hint: "Personal welcome for a new signup",
    sender: "francesca", optional: true, eyebrow: "Welcome",
    subject: "Welcome to Preciprocal, {{first_name}}",
    heading: "Welcome to Preciprocal, {{first_name}}",
    body: `We're really glad to have you.\n\nHere's what you can do right now:\n- Analyse your resume and get an ATS score\n- Practise mock interviews with AI feedback\n- Optimise your LinkedIn profile\n- Track every application in one place\n\nIf you have a question at any point, reply to this email and it comes straight to me.`,
    cta: { label: "Open Preciprocal", url: APP },
  },
  {
    // Limits are the Dashboard's lib/config/usage-limits.ts. Keep them true.
    id: "upgrade", label: "Upgrade offer", hint: "Engaged free user, invite to Pro",
    sender: "francesca", optional: true, eyebrow: "An offer for you",
    subject: "An offer for you: Preciprocal Pro",
    heading: "More room for your job search",
    body: `You've been getting real use out of Preciprocal, so I wanted to reach out personally about Pro.\n\nEach month, Pro gives you:\n- 20 resume analyses (Free: 3)\n- 30 cover letters (Free: 5)\n- 3 mock interviews (Free: 1)\n- 10 study plans (Free: 2)\n- An unlimited job tracker (Free: 10 jobs)\n\nUse code [COUPON_CODE] at checkout for [X]% off your first month.`,
    cta: { label: "See Pro", url: `${APP}/pricing` },
  },
  {
    id: "win_back", label: "Win-back", hint: "Cancelled or gone quiet",
    sender: "francesca", optional: true, eyebrow: "It's been a while",
    subject: "We miss you, {{first_name}}",
    heading: "Everything you saved is still here",
    body: `It's been a little while, so I wanted to reach out.\n\nHere's what's new since you were last here:\n- [New feature 1]\n- [New feature 2]\n\nAnd if something didn't work for you, I'd genuinely like to hear what. Just reply.`,
    cta: { label: "Pick up where you left off", url: APP },
  },
  {
    id: "payment", label: "Payment issue", hint: "Card failed or subscription past due",
    sender: "support", optional: false, eyebrow: "Action needed",
    subject: "Action needed: payment issue on your Preciprocal account",
    heading: "We couldn't take your latest payment",
    body: `We couldn't process the latest payment for your Preciprocal subscription. To keep your plan, please update your card or pay the open invoice in Settings.\n\nIf you think this is a mistake, reply to this email and we'll sort it out.`,
    cta: { label: "Update billing", url: `${APP}/settings?section=billing` },
  },
  {
    id: "feedback", label: "Feedback", hint: "Ask what's working and what isn't",
    sender: "francesca", optional: true, eyebrow: "Quick question",
    subject: "Quick question about Preciprocal",
    heading: "How has Preciprocal been for you?",
    body: `I'm reaching out personally to ask how Preciprocal has been working for you.\n\nWhat's one thing that's been useful, and one thing that's been frustrating? Your answer goes straight to the people building it.`,
  },
  {
    id: "reply", label: "Reply", hint: "Answer someone's question or problem",
    sender: "support", optional: false, eyebrow: "Re: your message",
    subject: "Re: your message to Preciprocal",
    heading: "Thanks for getting in touch",
    body: `Hi {{first_name}},\n\n`,
  },
  {
    id: "custom", label: "Custom", hint: "Start from a blank message",
    sender: "francesca", optional: true, eyebrow: "From Preciprocal",
    subject: "", heading: "", body: "",
  },
];

export const templateById = (id: string) => FOLLOW_UP_TEMPLATES.find(t => t.id === id);
/** email_sends.email_type for ERP emails; also the utm_campaign on links. */
export const emailTypeFor = (templateId: string) => `erp_${templateById(templateId) ? templateId : "custom"}`;

/** "Bruce Wayne" -> "Bruce". Falls back to something that still reads. */
export function firstName(name?: string | null): string {
  const f = (name ?? "").trim().split(/\s+/)[0];
  return f && f.length <= 40 ? f : "there";
}

export const fillVars = (text: string, name?: string | null) => text.replace(/\{\{\s*first_name\s*\}\}/g, firstName(name));

/** Unfilled placeholders like [COUPON_CODE] that must not reach anyone. */
export function unfilledPlaceholders(text: string): string[] {
  return [...new Set(text.match(/\[[A-Z0-9_ ]{1,40}\]|\[New feature \d\]|\[X\]/g) ?? [])];
}

// ─── Composition ──────────────────────────────────────────────────────────────

/** What the admin wrote, before it is filled in for each recipient. */
export interface Draft {
  templateId: string;
  sender: SenderId;
  /** Unsubscribe link and opt-out check. Forced on for multi-recipient sends. */
  optional: boolean;
  subject: string;
  eyebrow: string;
  heading: string;
  body: string;
  /** Up to MAX_BUTTONS; the first is the primary. Rows with no text are ignored. */
  buttons: { label: string; url: string }[];
}

export const draftFromTemplate = (t: FollowUpTemplate): Draft => ({
  templateId: t.id, sender: t.sender, optional: t.optional,
  subject: t.subject, eyebrow: t.eyebrow, heading: t.heading, body: t.body,
  buttons: t.cta ? [{ ...t.cta }] : [],
});

export const MAX_BUTTONS = 3;

/** The buttons that will actually render: text present and a full http(s) link. */
export const usableButtons = (b: Draft["buttons"]) =>
  (b ?? []).map(x => ({ label: x.label.trim(), url: x.url.trim() }))
    .filter(x => x.label && /^https?:\/\/\S+$/.test(x.url)).slice(0, MAX_BUTTONS);

/** Rows that have something typed but cannot render, so the admin is told. */
export const brokenButtons = (b: Draft["buttons"]) =>
  (b ?? []).filter(x => (x.label.trim() || x.url.trim()) && !(x.label.trim() && /^https?:\/\/\S+$/.test(x.url.trim())));

const UNSUB_LABEL = "Unsubscribe from all optional emails";

/**
 * The finished email for one recipient. `unsubscribeUrl` is signed on the
 * server; the preview passes a stand-in so the footer looks the same.
 */
export function composeEmail(d: Draft, recipient: { name?: string | null }, unsubscribeUrl?: string) {
  const campaign = emailTypeFor(d.templateId);
  const fill = (s: string) => fillVars(s, recipient.name).trim();
  const sender = SENDERS[d.sender] ?? SENDERS.francesca;
  const subject = fill(d.subject);
  const heading = fill(d.heading) || subject;
  const body = fill(d.body);
  const ctas = usableButtons(d.buttons);
  const footerNote = d.optional
    ? "You're getting this because you have a Preciprocal account."
    : "You're getting this because it's about your Preciprocal account.";

  const html = renderShell({
    preheader: body.split("\n").find(l => l.trim() && !/^hi\b/i.test(l.trim()))?.slice(0, 140) ?? heading,
    eyebrow: fill(d.eyebrow) || "From Preciprocal",
    heading,
    paragraphs: textToParagraphs(body),
    ctas,
    signature: sender.signature,
    footerNote,
    footerExtraHtml: d.optional && unsubscribeUrl
      ? `<div style="margin:10px 0 0 0;font-family:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;font-size:12px;line-height:1.6;"><a href="${escapeHtml(unsubscribeUrl)}" class="t-dim" style="color:#64748b;text-decoration:underline;">${UNSUB_LABEL}</a></div>`
      : undefined,
    campaign,
  });
  const text = renderShellText({
    heading, body, ctas, signature: sender.signature, footerNote,
    footerExtra: d.optional && unsubscribeUrl ? `${UNSUB_LABEL}: ${unsubscribeUrl}` : undefined,
    campaign,
  });
  return { subject, html, text, from: sender.from, replyTo: sender.replyTo, emailType: campaign };
}

// ─── Scheduling ───────────────────────────────────────────────────────────────

/** Resend accepts scheduled_at up to 30 days ahead. */
export const MAX_SCHEDULE_DAYS = 30;
/** Earliest schedule, so a "scheduled" email can't be one that is effectively immediate. */
export const MIN_SCHEDULE_MS = 2 * 60_000;
/** Recipients per send. Scheduled sends go one by one at Resend's 2 per second. */
export const MAX_RECIPIENTS = 50;

export function scheduleError(iso: string, now = Date.now()): string | null {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "Pick a valid date and time";
  if (t < now + MIN_SCHEDULE_MS) return "Pick a time at least 2 minutes from now";
  if (t > now + MAX_SCHEDULE_DAYS * 86_400_000) return `Resend can schedule at most ${MAX_SCHEDULE_DAYS} days ahead`;
  return null;
}
