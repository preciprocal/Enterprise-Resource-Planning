// lib/user-360.ts
// Everything the Dashboard stores about one user, shaped for the ERP's user
// page (components/admin/UserInsights.tsx). One call, parallel queries, heavy
// columns (resume text, transcripts, raw payloads) left out. Any table that's
// missing or errors comes back empty rather than failing the whole page.
import "server-only";
import { extensionPlatform } from "@/lib/extension-usage";
import { SupabaseClient } from "@supabase/supabase-js";

type Row = Record<string, unknown>;
const LIMIT = 50;

function ua(s: string | null | undefined) {
  const u = (s ?? "").toLowerCase();
  const browser = u.includes("edg/") ? "Edge" : u.includes("opr/") ? "Opera" : u.includes("chrome") ? "Chrome"
    : u.includes("firefox") ? "Firefox" : u.includes("safari") ? "Safari" : "Unknown";
  const os = u.includes("windows") ? "Windows" : u.includes("iphone") || u.includes("ipad") ? "iOS"
    : u.includes("android") ? "Android" : u.includes("mac os") ? "macOS" : u.includes("linux") ? "Linux" : "Unknown";
  const device = u.includes("ipad") || u.includes("tablet") ? "tablet" : u.includes("mobile") || u.includes("iphone") || u.includes("android") ? "mobile" : "desktop";
  return { browser, os, device };
}

const pick = (o: unknown, keys: string[]): string | undefined => {
  if (!o || typeof o !== "object") return undefined;
  for (const k of keys) { const v = (o as Row)[k]; if (typeof v === "string" && v.trim()) return v.trim(); }
  return undefined;
};

export interface TimelineItem { at: string; kind: string; title: string; detail?: string }

export async function loadUser360(sb: SupabaseClient, userId: string) {
  // Never throw: a missing table or column just yields [].
  const q = async (table: string, select: string, opts: { order?: string; limit?: number; eq?: [string, unknown]; inList?: [string, string[]] } = {}) => {
    try {
      let query = sb.from(table).select(select);
      query = opts.inList ? query.in(opts.inList[0], opts.inList[1]) : query.eq(opts.eq?.[0] ?? "user_id", opts.eq?.[1] ?? userId);
      if (opts.order) query = query.order(opts.order, { ascending: false });
      const { data, error } = await query.limit(opts.limit ?? LIMIT);
      if (error) { console.warn(`[user360] ${table}:`, error.message); return [] as Row[]; }
      return (data ?? []) as unknown as Row[];
    } catch { return [] as Row[]; }
  };
  const count = async (table: string) => {
    try { const { count: c } = await sb.from(table).select("*", { count: "exact", head: true }).eq("user_id", userId); return c ?? 0; }
    catch { return 0; }
  };

  const [
    profileRows, subRows, resumes, tailored, interviews, feedback, applications, statusEvents,
    coverLetters, plans, debriefs, sessions, activity, emailSends, notifications, tickets, surveys, ratings,
    refunds, flags, packs, nLinkedin, nOutreach, nContacts, nJobAnalyses, linkedinLast, outreachLast,
  ] = await Promise.all([
    q("profiles", "name,email,created_at,provider,phone,phone_verified,phone_verified_at,city,state,bio,target_role,experience_level,preferred_tech,career_goals,linked_in,github,website,resume_file_name,transcript_file_name,welcome_email_sent_at,weekly_digest_opt_out,weekly_digest_sent_at,activation_email_opt_out,activation_email_sent_at,activation_email_count,activation_email_last_step,application_email_opt_out,application_email_sent_at", { limit: 1 }),
    q("subscriptions", "plan,status,subscription_started_at,student_verified,last_payment_at,canceled_at,trial_ends_at", { limit: 1 }),
    q("resumes", "id,company_name,job_title,file_name,original_file_name,status,score,created_at,analyzed_at,deleted,benchmark_generated_at,recruiter_simulation_generated_at,interview_intel_generated_at,deep_analysis_generated_at,tailor_result_generated_at", { order: "created_at" }),
    q("tailored_resumes", "id,resume_id,job_title,company_name,ats_score_before,ats_score_after,created_at", { order: "created_at" }),
    q("interviews", "id,role,type,level,company,position,duration,status,finalized,created_at,abandoned_at,abandoned_reason", { order: "created_at" }),
    q("interview_feedback", "interview_id,total_score,created_at", { order: "created_at", limit: 200 }),
    q("job_applications", "id,company,job_title,status,source,linkedin_job_id,location,work_type,applied_date,job_url,created_at,updated_at,first_response_at,reached_interview_at", { order: "updated_at", limit: 100 }),
    q("application_status_events", "application_id,from_status,to_status,outcome,created_at", { order: "created_at", limit: 200 }),
    q("cover_letters", "id,job_role,company_name,tone,word_count,created_at", { order: "created_at" }),
    q("interview_plans", "id,archived,created_at,updated_at,data", { order: "created_at", limit: 20 }),
    q("interview_debriefs", "id,company_name,job_title,interview_date,stage,outcome,self_score,difficulty_rating,created_at", { order: "created_at" }),
    q("user_sessions", "session_id,ip,geo_country,geo_city,user_agent,created_at,last_seen_at,revoked_at,revoked_reason", { order: "last_seen_at", limit: 30 }),
    q("activity_events", "event,feature,path,label,duration_ms,created_at", { order: "created_at", limit: 1000 }),
    q("email_sends", "resend_id,email_type,subject,sent_at", { order: "sent_at" }),
    q("notifications", "id,title,type,read,deleted,created_at", { order: "created_at", limit: 30 }),
    q("support_tickets", "id,subject,status,priority,category,reply_count,last_reply_by,last_reply_at,created_at,updated_at", { order: "created_at" }),
    q("product_surveys", "id,page,overall_rating,nps,top_improvement,free_text,created_at", { order: "created_at" }),
    q("feature_ratings", "id,feature,rating,nps,comment,created_at", { order: "created_at" }),
    q("refund_requests", "id,status,user_reason,quoted_refund_cents,amount_paid_cents,decision_note,created_at,decided_at", { order: "created_at" }),
    q("flagged_accounts", "id,reason,status,resolution_note,created_at,resolved_at", { order: "created_at" }),
    q("credit_packs", "pack_key,price_cents,purchased_at,refunded_at", { order: "purchased_at" }),
    count("linkedin_optimizations"), count("outreach_history"), count("contact_searches"), count("job_analyses"),
    q("linkedin_optimizations", "created_at", { order: "created_at", limit: 1 }),
    q("outreach_history", "created_at", { order: "created_at", limit: 1 }),
  ]);

  // The Dashboard writes interview_call_costs with user_id null (only
  // interview_id), so costs are found through this user's interviews.
  const interviewIds = interviews.map(i => i.id as string);
  const callCosts = interviewIds.length
    ? await q("interview_call_costs", "interview_id,cost_usd,duration_seconds,ended_reason,created_at", { inList: ["interview_id", interviewIds], limit: 500 })
    : [];

  const profile = profileRows[0] ?? {};
  const sub = subRows[0] ?? {};

  // Email engagement: Resend webhook events joined by resend_id.
  const resendIds = emailSends.map(e => e.resend_id as string).filter(Boolean);
  const emailEvents = resendIds.length ? await q("email_events", "resend_id,event,created_at", { inList: ["resend_id", resendIds], limit: 500 }) : [];
  const eventsBy = new Map<string, Set<string>>();
  emailEvents.forEach(e => { const s = eventsBy.get(e.resend_id as string) ?? new Set(); s.add(String(e.event).replace(/^email\./, "")); eventsBy.set(e.resend_id as string, s); });

  const scoreBy = new Map<string, number>();
  feedback.forEach(f => { if (!scoreBy.has(f.interview_id as string) && f.total_score != null) scoreBy.set(f.interview_id as string, Number(f.total_score)); });
  const costBy = new Map<string, { usd: number; secs: number }>();
  callCosts.forEach(c => { const k = (c.interview_id as string) ?? "_"; const v = costBy.get(k) ?? { usd: 0, secs: 0 }; v.usd += Number(c.cost_usd ?? 0); v.secs += Number(c.duration_seconds ?? 0); costBy.set(k, v); });
  const totalAiCost = callCosts.reduce((s, c) => s + Number(c.cost_usd ?? 0), 0);

  // Product activity, by feature
  const byFeature = new Map<string, { feature: string; views: number; clicks: number; timeMs: number; last: string }>();
  activity.forEach(a => {
    const f = (a.feature as string) || "other";
    const v = byFeature.get(f) ?? { feature: f, views: 0, clicks: 0, timeMs: 0, last: a.created_at as string };
    if (a.event === "page_view") v.views++; else if (a.event === "click") v.clicks++; else if (a.event === "time") v.timeMs += Number(a.duration_ms ?? 0);
    if ((a.created_at as string) > v.last) v.last = a.created_at as string;
    byFeature.set(f, v);
  });

  const apps = applications.map(a => ({
    id: a.id as string, company: a.company as string | null, jobTitle: a.job_title as string | null, status: (a.status as string) ?? "saved",
    source: a.source as string | null, viaExtension: extensionPlatform(a.source as string | null, a.linkedin_job_id as string | null), location: a.location as string | null, workType: a.work_type as string | null,
    appliedDate: a.applied_date as string | null, jobUrl: a.job_url as string | null, createdAt: a.created_at as string, updatedAt: a.updated_at as string,
    firstResponseAt: a.first_response_at as string | null, reachedInterviewAt: a.reached_interview_at as string | null,
    history: statusEvents.filter(e => e.application_id === a.id).map(e => ({ from: e.from_status as string | null, to: e.to_status as string, at: e.created_at as string })),
  }));
  const applied = apps.filter(a => a.appliedDate || !["saved", "wishlist", "interested"].includes(a.status.toLowerCase()));
  const responded = applied.filter(a => a.firstResponseAt || a.reachedInterviewAt);

  const ivs = interviews.map(i => ({
    id: i.id as string, role: i.role as string | null, type: i.type as string | null, level: i.level as string | null,
    company: i.company as string | null, duration: i.duration as string | null, finalized: !!i.finalized,
    status: i.abandoned_at ? "abandoned" : i.finalized ? "completed" : (i.status as string) ?? "started",
    abandonedReason: i.abandoned_reason as string | null, createdAt: i.created_at as string,
    score: scoreBy.get(i.id as string) ?? null, costUsd: costBy.get(i.id as string)?.usd ?? null, callSeconds: costBy.get(i.id as string)?.secs ?? null,
  }));
  const scored = ivs.filter(i => i.score != null);

  const liveResumes = resumes.filter(r => !r.deleted).map(r => ({
    id: r.id as string, title: [r.job_title, r.company_name].filter(Boolean).join(" · ") || (r.original_file_name as string) || (r.file_name as string) || "Resume",
    fileName: (r.original_file_name ?? r.file_name) as string | null, status: r.status as string, score: r.score as number | null,
    createdAt: r.created_at as string, analyzedAt: r.analyzed_at as string | null,
    extras: [r.benchmark_generated_at && "Benchmark", r.recruiter_simulation_generated_at && "Recruiter sim", r.deep_analysis_generated_at && "Deep analysis",
      r.interview_intel_generated_at && "Interview intel", r.tailor_result_generated_at && "Tailored"].filter(Boolean) as string[],
  }));

  const sess = sessions.map(s => ({
    id: s.session_id as string, ip: s.ip as string | null, city: s.geo_city as string | null, country: s.geo_country as string | null,
    ...ua(s.user_agent as string | null), createdAt: s.created_at as string, lastSeenAt: s.last_seen_at as string,
    revokedAt: s.revoked_at as string | null, revokedReason: s.revoked_reason as string | null,
  }));

  const emails = emailSends.map(e => {
    const ev = eventsBy.get(e.resend_id as string) ?? new Set<string>();
    return { type: e.email_type as string, subject: e.subject as string | null, sentAt: e.sent_at as string,
      delivered: ev.has("delivered"), opened: ev.has("opened"), clicked: ev.has("clicked"), bounced: ev.has("bounced") || ev.has("complained") };
  });

  // ── Lifecycle milestones (earliest occurrence of each) ────────────────────
  const earliest = (rows: { createdAt?: string; at?: string }[]) => rows.map(r => r.createdAt ?? r.at).filter(Boolean).sort()[0] as string | undefined;
  const milestones = [
    { key: "signup",      label: "Signed up",            at: profile.created_at as string | undefined },
    { key: "resume",      label: "Uploaded a resume",    at: earliest(liveResumes) },
    { key: "interview",   label: "Started a mock interview", at: earliest(ivs) },
    { key: "feedback",    label: "Completed an interview", at: earliest(ivs.filter(i => i.finalized)) },
    { key: "application", label: "Tracked a job application", at: earliest(apps) },
    { key: "paid",        label: sub.student_verified ? "Claimed student offer" : "Became a paying customer",
      at: (sub.subscription_started_at as string | null) ?? (packs[0]?.purchased_at as string | undefined) ?? undefined },
  ].map(m => ({ ...m, at: m.at ?? null }));

  // ── Unified timeline ──────────────────────────────────────────────────────
  const timeline: TimelineItem[] = [];
  const push = (at: unknown, kind: string, title: string, detail?: string | null) => { if (typeof at === "string" && at) timeline.push({ at, kind, title, detail: detail ?? undefined }); };
  push(profile.created_at, "account", "Signed up", profile.provider ? `via ${profile.provider}` : null);
  sess.forEach(s => push(s.createdAt, "session", "Signed in", [s.browser, s.os, [s.city, s.country].filter(Boolean).join(", ")].filter(v => v && v !== "Unknown").join(" · ")));
  liveResumes.forEach(r => push(r.createdAt, "resume", "Uploaded resume", r.title + (r.score != null ? ` · score ${r.score}` : "")));
  ivs.forEach(i => push(i.createdAt, "interview", i.status === "abandoned" ? "Abandoned mock interview" : "Mock interview", [i.role, i.type, i.score != null ? `score ${i.score}` : null].filter(Boolean).join(" · ")));
  apps.forEach(a => push(a.createdAt, "application", "Added job", [a.jobTitle, a.company].filter(Boolean).join(" at ")));
  statusEvents.forEach(e => { const a = apps.find(x => x.id === e.application_id); push(e.created_at, "application", `Application → ${e.to_status}`, a ? [a.jobTitle, a.company].filter(Boolean).join(" at ") : null); });
  coverLetters.forEach(c => push(c.created_at, "cover_letter", "Wrote cover letter", [c.job_role, c.company_name].filter(Boolean).join(" at ")));
  debriefs.forEach(d => push(d.created_at, "debrief", "Logged interview debrief", [d.job_title, d.company_name].filter(Boolean).join(" at ")));
  tickets.forEach(t => push(t.created_at, "support", "Opened support ticket", t.subject as string));
  surveys.forEach(s => push(s.created_at, "feedback", "Answered survey", `${s.page} · ${s.overall_rating}/5`));
  emails.forEach(e => push(e.sentAt, "email", `Email: ${e.subject ?? e.type}`, e.opened ? "opened" : e.delivered ? "delivered" : null));
  packs.forEach(p => push(p.purchased_at, "billing", "Bought credit pack", `${p.pack_key} · $${(Number(p.price_cents) / 100).toFixed(2)}`));
  refunds.forEach(r => push(r.created_at, "billing", "Requested refund", r.status as string));
  flags.forEach(f => push(f.created_at, "risk", "Account flagged", f.reason as string));
  push(sub.subscription_started_at, "billing", "Subscription started", sub.plan as string);
  push(sub.canceled_at, "billing", "Subscription canceled", null);
  timeline.sort((a, b) => b.at.localeCompare(a.at));

  const activeSessions = sess.filter(s => !s.revokedAt);
  const since30 = Date.now() - 30 * 86_400_000;

  return {
    userId,
    profile: {
      phone: profile.phone ?? null, phoneVerified: !!profile.phone_verified, phoneVerifiedAt: profile.phone_verified_at ?? null,
      location: [profile.city, profile.state].filter(Boolean).join(", ") || null, bio: profile.bio ?? null,
      targetRole: profile.target_role ?? null, experienceLevel: profile.experience_level ?? null,
      preferredTech: (profile.preferred_tech as string[] | null) ?? [], careerGoals: profile.career_goals ?? null,
      linkedIn: profile.linked_in ?? null, github: profile.github ?? null, website: profile.website ?? null,
      resumeFile: profile.resume_file_name ?? null, transcriptFile: profile.transcript_file_name ?? null,
      emailPrefs: {
        weeklyDigest: !profile.weekly_digest_opt_out, weeklyDigestSentAt: profile.weekly_digest_sent_at ?? null,
        activation: !profile.activation_email_opt_out, activationCount: profile.activation_email_count ?? 0, activationLastStep: profile.activation_email_last_step ?? null,
        applications: !profile.application_email_opt_out, welcomeSentAt: profile.welcome_email_sent_at ?? null,
      },
    },
    stats: {
      activeSessions: activeSessions.length,
      lastSeenAt: sess.map(s => s.lastSeenAt).filter(Boolean).sort().pop() ?? null,
      activeDays30: new Set(activity.filter(a => Date.parse(a.created_at as string) >= since30).map(a => (a.created_at as string).slice(0, 10))).size,
      resumes: liveResumes.length, bestResumeScore: liveResumes.reduce<number | null>((m, r) => r.score != null && (m == null || r.score > m) ? r.score : m, null),
      interviews: ivs.length, completedInterviews: ivs.filter(i => i.finalized).length,
      avgInterviewScore: scored.length ? Math.round(scored.reduce((s, i) => s + (i.score ?? 0), 0) / scored.length) : null,
      applications: apps.length, applied: applied.length, responseRate: applied.length ? Math.round((responded.length / applied.length) * 100) : null,
      interviewsLanded: apps.filter(a => a.reachedInterviewAt).length,
      extensionJobs: apps.filter(a => a.viaExtension).length,
      extensionLastAt: apps.filter(a => a.viaExtension).reduce<string | null>((m, a) => !m || a.createdAt > m ? a.createdAt : m, null),
      coverLetters: coverLetters.length, debriefs: debriefs.length, plans: plans.length,
      linkedin: nLinkedin, outreach: nOutreach, contactSearches: nContacts, jobAnalyses: nJobAnalyses,
      linkedinLastAt: (linkedinLast[0]?.created_at as string) ?? null, outreachLastAt: (outreachLast[0]?.created_at as string) ?? null,
      openTickets: tickets.filter(t => ["open", "in-progress"].includes(t.status as string)).length, tickets: tickets.length,
      aiCostUsd: Math.round(totalAiCost * 100) / 100, emailsSent: emails.length,
      emailsOpened: emails.filter(e => e.opened).length,
    },
    milestones,
    resumes: liveResumes,
    tailored: tailored.map(t => ({ id: t.id, title: [t.job_title, t.company_name].filter(Boolean).join(" · ") || "Tailored resume", before: t.ats_score_before, after: t.ats_score_after, createdAt: t.created_at })),
    interviews: ivs,
    applications: apps,
    coverLetters: coverLetters.map(c => ({ id: c.id, role: c.job_role, company: c.company_name, tone: c.tone, words: c.word_count, createdAt: c.created_at })),
    plans: plans.map(p => ({ id: p.id, title: pick(p.data, ["title", "role", "targetRole", "jobTitle", "company"]) ?? "Study plan", archived: !!p.archived, createdAt: p.created_at })),
    debriefs: debriefs.map(d => ({ id: d.id, company: d.company_name, role: d.job_title, stage: d.stage, outcome: d.outcome, selfScore: d.self_score, date: d.interview_date, createdAt: d.created_at })),
    sessions: sess,
    features: [...byFeature.values()].sort((a, b) => (b.views + b.clicks) - (a.views + a.clicks)),
    emails,
    notifications: notifications.filter(n => !n.deleted).map(n => ({ id: n.id, title: n.title, type: n.type, read: !!n.read, createdAt: n.created_at })),
    tickets: tickets.map(t => ({ id: t.id, subject: t.subject, status: t.status, priority: t.priority, category: t.category, replies: t.reply_count ?? 0, lastReplyBy: t.last_reply_by, createdAt: t.created_at, updatedAt: t.updated_at })),
    surveys: surveys.map(s => ({ id: s.id, page: s.page, rating: s.overall_rating, nps: s.nps, improvement: s.top_improvement, text: s.free_text, createdAt: s.created_at })),
    ratings: ratings.map(r => ({ id: r.id, feature: r.feature, rating: r.rating, nps: r.nps, comment: r.comment, createdAt: r.created_at })),
    refunds: refunds.map(r => ({ id: r.id, status: r.status, reason: r.user_reason, quotedCents: r.quoted_refund_cents, paidCents: r.amount_paid_cents, note: r.decision_note, createdAt: r.created_at, decidedAt: r.decided_at })),
    flags: flags.map(f => ({ id: f.id, reason: f.reason, status: f.status, note: f.resolution_note, createdAt: f.created_at, resolvedAt: f.resolved_at })),
    timeline: timeline.slice(0, 150),
  };
}

export type User360 = Awaited<ReturnType<typeof loadUser360>>;
