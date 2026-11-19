// lib/user-360.ts
// Everything the Dashboard stores about one user, shaped for the ERP's user
// page (components/admin/UserInsights.tsx). One call, parallel queries, heavy
// columns (resume text, transcripts, raw payloads) left out. Any table that's
// missing or errors comes back empty rather than failing the whole page.
import "server-only";
import { extensionPlatform, extensionUserActivity, extensionUserTelemetry } from "@/lib/extension-usage";
import { EXT_LIFECYCLE_EVENTS, extEventLabel } from "@/lib/extension-events";
import { SupabaseClient } from "@supabase/supabase-js";

type Row = Record<string, unknown>;
const LIMIT = 50;
const ACTIVITY_DAYS = 90;
const ACTIVITY_MAX = 5000;
const STRIP_DAYS = 60;
const DAY_MS = 86_400_000;

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
  // Never throw: a missing table or column just yields []. Tables that
  // errored are remembered so the page can tell "missing" from "empty".
  // `select` may list fallbacks, tried in order, for columns added by a later
  // Dashboard migration that may not be applied yet.
  const failed = new Set<string>();
  const q = async (table: string, select: string | string[], opts: { order?: string; limit?: number; eq?: [string, unknown]; inList?: [string, string[]]; since?: [string, string] } = {}) => {
    for (const sel of Array.isArray(select) ? select : [select]) {
      try {
        let query = sb.from(table).select(sel);
        query = opts.inList ? query.in(opts.inList[0], opts.inList[1]) : query.eq(opts.eq?.[0] ?? "user_id", opts.eq?.[1] ?? userId);
        if (opts.since) query = query.gte(opts.since[0], opts.since[1]);
        if (opts.order) query = query.order(opts.order, { ascending: false });
        const { data, error } = await query.limit(opts.limit ?? LIMIT);
        if (error) { console.warn(`[user360] ${table}:`, error.message); continue; }
        return (data ?? []) as unknown as Row[];
      } catch { /* try the next select */ }
    }
    failed.add(table);
    return [] as Row[];
  };
  const count = async (table: string, col = "user_id") => {
    try {
      const { count: c, error } = await sb.from(table).select("*", { count: "exact", head: true }).eq(col, userId);
      if (error) failed.add(table);
      return c ?? 0;
    } catch { failed.add(table); return 0; }
  };
  // Product analytics: the last ACTIVITY_DAYS, newest first, up to ACTIVITY_MAX
  // rows. The first page decides whether the rest are needed; those run in parallel.
  const activityRows = async () => {
    const since = new Date(Date.now() - ACTIVITY_DAYS * 86_400_000).toISOString();
    const page = async (i: number) => {
      try {
        const { data, error } = await sb.from("activity_events").select("event,feature,path,label,target,duration_ms,source,session_id,created_at")
          .eq("user_id", userId).gte("created_at", since).order("created_at", { ascending: false }).range(i * 1000, i * 1000 + 999);
        if (error) { failed.add("activity_events"); return [] as Row[]; }
        return (data ?? []) as Row[];
      } catch { failed.add("activity_events"); return [] as Row[]; }
    };
    const first = await page(0);
    if (first.length < 1000) return { rows: first, capped: false };
    const rest = await Promise.all(Array.from({ length: ACTIVITY_MAX / 1000 - 1 }, (_, i) => page(i + 1)));
    const rows = [first, ...rest].flat();
    return { rows, capped: rows.length >= ACTIVITY_MAX };
  };

  const [
    profileRows, subRows, resumes, tailored, interviews, feedback, applications, statusEvents,
    coverLetters, plans, debriefs, sessions, emailSends, notifications, tickets, surveys, ratings,
    refunds, flags, packs, nLinkedin, nOutreach, nContacts, nJobAnalyses, linkedinLast, outreachLast, unsubscribes,
    accountEvents, disputes,
    // Career tools, calendar, inbound mail, billing extras (metadata only)
    contacts, interactions, contactSearchRows, outreachRows, linkedinRows, jobAnalysisRows, quizRows,
    schedules, googleCal, microsoftCal, inboundAddr, inboundMail, transfersOut, transfersIn,
    groupsOwned, groupMemberships, rewards, plannerChats, nPlannerChats, transcriptRows, outcomes,
    nInteractions, nInboundMail, nContactRows, activityRes, extTelemetry, extJobs,
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
    q("email_sends", "resend_id,email_type,subject,sent_at", { order: "sent_at" }),
    q("notifications", "id,title,type,read,deleted,created_at", { order: "created_at", limit: 30 }),
    q("support_tickets", "id,subject,status,priority,category,reply_count,last_reply_by,last_reply_at,created_at,updated_at", { order: "created_at" }),
    q("product_surveys", "id,page,overall_rating,nps,top_improvement,free_text,created_at", { order: "created_at" }),
    q("feature_ratings", "id,feature,rating,nps,comment,created_at", { order: "created_at" }),
    q("refund_requests", "id,kind,status,user_reason,quoted_refund_cents,quoted_fee_cents,amount_paid_cents,decision_note,stripe_refund_id,refunded_at,refund_error,created_at,decided_at", { order: "created_at" }),
    q("flagged_accounts", "id,reason,status,resolution_note,created_at,resolved_at", { order: "created_at" }),
    q("credit_packs", "pack_key,price_cents,purchased_at,refunded_at", { order: "purchased_at" }),
    count("linkedin_optimizations"), count("outreach_history"), count("contact_searches"), count("job_analyses"),
    q("linkedin_optimizations", "created_at", { order: "created_at", limit: 1 }),
    q("outreach_history", "created_at", { order: "created_at", limit: 1 }),
    // Written by the Dashboard's unsubscribe routes (migration 0050).
    q("email_unsubscribes", "scope,method,last_email_type,created_at", { order: "created_at", limit: 20 }),
    // Dashboard migration 0052.
    q("account_events", "type,detail,ip,created_at", { order: "created_at", limit: 30 }),
    q("payment_disputes", "id,amount_cents,currency,reason,status,evidence_due_by,what,created_at", { order: "created_at", limit: 10 }),
    // ── Never loaded: notes, summaries, message bodies, tokens, job descriptions ──
    // Dashboard 0062. Contact email / LinkedIn URL are third-party details, left out.
    q("contacts", "id,name,role,company,relationship,status,last_contacted_at,next_follow_up_at,replied_at,application_id,source,created_at,updated_at", { order: "updated_at", limit: 200 }),
    q("contact_interactions", "id,contact_id,type,occurred_at,created_at", { order: "occurred_at", limit: 100 }),
    // jsonb paths written by the Dashboard's find-contacts / cold-outreach / linkedin-optimize / analyze-job routes.
    q("contact_searches", "id,company:query->>company,jobTitle:query->>jobTitle,contactCount:results->>contactCount,emailsGenerated:results->>emailsGenerated,created_at", { order: "created_at" }),
    q("outreach_history", "id,company:contact->>recipientCompany,role:contact->>recipientRole,platform:contact->>platform,type:contact->>outreachType,tone:contact->>tone,created_at", { order: "created_at" }),
    q("linkedin_optimizations", "id,targetRole:input->>targetRole,targetIndustry:input->>targetIndustry,created_at", { order: "created_at" }),
    q("job_analyses", "id,jobTitle:result->>jobTitle,company:result->>jobCompany,score:result->>overallScore,source:result->>source,created_at", { order: "created_at" }),
    q("quiz_results", "id,interview_plan_id,score,created_at", { order: "created_at" }),
    // Dashboard 0063 (+ microsoft_event_id from 0070, which may not be applied).
    q("interview_schedules", ["id,application_id,starts_at,ends_at,time_zone,stage,google_event_id,microsoft_event_id,created_at", "id,application_id,starts_at,ends_at,time_zone,stage,google_event_id,created_at"], { order: "starts_at" }),
    // Connection metadata only, never the *_token_enc columns.
    q("google_calendar_connections", "google_email,scopes,calendar_id,connected_at,updated_at,last_error,broken_at", { limit: 1 }),
    q("microsoft_calendar_connections", "account_email,scopes,connected_at,updated_at,last_error,broken_at", { limit: 1 }),
    // Dashboard 0057. The address token is a secret (it lets anyone post into the tracker), so only its dates.
    q("inbound_addresses", "created_at,rotated_at", { limit: 1 }),
    q("inbound_emails", "id,from_address,subject,received_at,kind,confidence,company,job_title,stage,application_id,previous_status,new_status,outcome", { order: "received_at" }),
    // Dashboard 0069 / 0068.
    q("credit_transfers", "id,to_user_id,grants,created_at", { eq: ["from_user_id", userId], order: "created_at" }),
    q("credit_transfers", "id,from_user_id,grants,created_at", { eq: ["to_user_id", userId], order: "created_at" }),
    q("pack_groups", "id,pack_key,seats,created_at", { eq: ["owner_id", userId], order: "created_at" }),
    q("pack_group_members", "group_id,joined_at", { order: "joined_at" }),
    q("feature_rewards", "feature_type,field,amount,claimed_at", { order: "claimed_at" }),
    q("planner_chat_sessions", "id,created_at,updated_at", { order: "updated_at", limit: 1 }),
    count("planner_chat_sessions"),
    q("transcripts", "id,file_name,created_at", { order: "created_at" }),
    q("outcome_data", "id,outcome,resume_score,ats_score,job_title,company_name,days_after_application,benchmark_percentile,actually_got_interview,reported_at,created_at", { order: "created_at" }),
    count("contact_interactions"), count("inbound_emails"), count("contacts"),
    activityRows(),
    extensionUserTelemetry(sb, userId).catch(() => null),
    extensionUserActivity(sb, userId).catch(() => null),
  ]);
  const activity = activityRes.rows;

  // Other people this user's group packs and transfers involve, and the groups they joined.
  const memberGroupIds = groupMemberships.map(m => m.group_id as string).filter(Boolean);
  const ownedGroupIds = groupsOwned.map(g => g.id as string);
  const [joinedGroups, ownedMembers] = await Promise.all([
    memberGroupIds.length ? q("pack_groups", "id,owner_id,pack_key,seats,created_at", { inList: ["id", memberGroupIds] }) : Promise.resolve([] as Row[]),
    ownedGroupIds.length ? q("pack_group_members", "group_id,user_id,joined_at", { inList: ["group_id", ownedGroupIds], limit: 200 }) : Promise.resolve([] as Row[]),
  ]);
  const otherIds = [...new Set([
    ...transfersOut.map(t => t.to_user_id as string), ...transfersIn.map(t => t.from_user_id as string),
    ...joinedGroups.map(g => g.owner_id as string), ...ownedMembers.map(m => m.user_id as string),
  ].filter(id => id && id !== userId))];
  const others = otherIds.length ? await q("profiles", "user_id,name,email", { inList: ["user_id", otherIds], limit: 200 }) : [];
  const person = (id: unknown) => {
    const p = others.find(o => o.user_id === id);
    return { id: id as string, name: (p?.name as string) ?? null, email: (p?.email as string) ?? null };
  };

  // The Dashboard writes interview_call_costs with user_id null (only
  // interview_id), so costs are found through this user's interviews.
  const interviewIds = interviews.map(i => i.id as string);
  const callCosts = interviewIds.length
    ? await q("interview_call_costs", "interview_id,cost_usd,duration_seconds,ended_reason,created_at", { inList: ["interview_id", interviewIds], limit: 500 })
    : [];

  const profile = profileRows[0] ?? {};

  // The two opt-outs that live outside profiles: emailed support replies
  // (user_settings) and product updates (newsletter_subscribers, by email).
  const [settingsRow, newsletterRow] = await Promise.all([
    sb.from("user_settings").select("settings").eq("user_id", userId).maybeSingle().then(r => r.data, () => null),
    profile.email
      ? sb.from("newsletter_subscribers").select("subscribed").eq("email", String(profile.email).toLowerCase().trim()).maybeSingle().then(r => r.data, () => null)
      : Promise.resolve(null),
  ]);
  const notif = ((settingsRow?.settings as Record<string, unknown> | undefined)?.notifications ?? {}) as Record<string, unknown>;
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

  // By page: views, clicks, engaged time, and the page's title (page_view label).
  const byPath = new Map<string, { path: string; title: string | null; feature: string; views: number; clicks: number; timeMs: number; last: string }>();
  activity.forEach(a => {
    const p = (a.path as string) || "/";
    const v = byPath.get(p) ?? { path: p, title: null, feature: (a.feature as string) || "other", views: 0, clicks: 0, timeMs: 0, last: a.created_at as string };
    if (a.event === "page_view") { v.views++; if (!v.title && a.label) v.title = a.label as string; }
    else if (a.event === "click") v.clicks++;
    else if (a.event === "time") v.timeMs += Number(a.duration_ms ?? 0);
    if ((a.created_at as string) > v.last) v.last = a.created_at as string;
    byPath.set(p, v);
  });

  // Day-by-day strip (UTC days), zero-filled.
  const dayKey = (iso: string) => iso.slice(0, 10);
  const days = new Map<string, { day: string; views: number; clicks: number; timeMs: number }>();
  for (let i = STRIP_DAYS - 1; i >= 0; i--) { const k = new Date(Date.now() - i * DAY_MS).toISOString().slice(0, 10); days.set(k, { day: k, views: 0, clicks: 0, timeMs: 0 }); }
  activity.forEach(a => {
    const d = days.get(dayKey(a.created_at as string)); if (!d) return;
    if (a.event === "page_view") d.views++; else if (a.event === "click") d.clicks++; else if (a.event === "time") d.timeMs += Number(a.duration_ms ?? 0);
  });

  // Sittings: grouped by session_id (rows without one are grouped by day).
  const bySession = new Map<string, Row[]>();
  activity.forEach(a => { const k = (a.session_id as string) || `day:${dayKey(a.created_at as string)}`; const l = bySession.get(k) ?? []; l.push(a); bySession.set(k, l); });
  const clickSessions = [...bySession].map(([id, rows]) => {
    const asc = [...rows].sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
    return {
      id, start: asc[0].created_at as string, end: asc[asc.length - 1].created_at as string,
      views: asc.filter(r => r.event === "page_view").length, clicks: asc.filter(r => r.event === "click").length,
      timeMs: asc.reduce((s, r) => s + (r.event === "time" ? Number(r.duration_ms ?? 0) : 0), 0),
      source: (asc.find(r => r.source)?.source as string) ?? null,
      steps: asc.filter(r => r.event !== "time").slice(-80).map(r => ({
        event: r.event as string, path: r.path as string, feature: r.feature as string,
        label: (r.label as string) ?? null, target: (r.target as string) ?? null, at: r.created_at as string,
      })),
    };
  }).sort((a, b) => b.end.localeCompare(a.end));

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

  // ── Career tools, calendar, inbound mail, billing extras ─────────────────
  const appTitle = (id: unknown) => { const a = apps.find(x => x.id === id); return a ? [a.jobTitle, a.company].filter(Boolean).join(" at ") || null : null; };
  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
  const num = (v: unknown) => (v == null || v === "" || Number.isNaN(Number(v)) ? null : Number(v));
  const contactName = new Map(contacts.map(c => [c.id as string, c.name as string]));
  const interactionTypes = new Map<string, number>();
  interactions.forEach(i => interactionTypes.set(i.type as string, (interactionTypes.get(i.type as string) ?? 0) + 1));
  const planTitle = new Map(plans.map(p => [p.id as string, pick(p.data, ["title", "role", "targetRole", "jobTitle", "company"]) ?? "Study plan"]));
  const grantText = (g: unknown) => g && typeof g === "object"
    ? Object.entries(g as Record<string, unknown>).filter(([, v]) => Number(v) > 0).map(([k, v]) => `${v} ${k}`).join(", ") : "";
  const calendar = (r: Row | undefined, emailCol: string) => r ? {
    connected: !r.broken_at, account: str(r[emailCol]), connectedAt: r.connected_at as string, updatedAt: (r.updated_at as string) ?? null,
    brokenAt: (r.broken_at as string) ?? null, error: str(r.last_error), scopes: (r.scopes as string[] | null)?.length ?? 0,
  } : null;

  const careerTools = {
    contacts: contacts.map(c => ({
      id: c.id as string, name: c.name as string, role: str(c.role), company: str(c.company), relationship: c.relationship as string,
      status: c.status as string, source: c.source as string, lastContactedAt: (c.last_contacted_at as string) ?? null,
      nextFollowUpAt: (c.next_follow_up_at as string) ?? null, repliedAt: (c.replied_at as string) ?? null,
      application: appTitle(c.application_id), createdAt: c.created_at as string, updatedAt: c.updated_at as string,
    })),
    contactCount: nContactRows,
    interactions: interactions.map(i => ({ id: i.id as string, contact: contactName.get(i.contact_id as string) ?? null, type: i.type as string, at: (i.occurred_at ?? i.created_at) as string })),
    interactionCount: nInteractions,
    interactionTypes: [...interactionTypes].map(([type, n]) => ({ type, n })).sort((a, b) => b.n - a.n),
    contactSearches: contactSearchRows.map(r => ({ id: r.id as string, company: str(r.company), jobTitle: str(r.jobTitle), contacts: num(r.contactCount), emails: num(r.emailsGenerated), at: r.created_at as string })),
    outreach: outreachRows.map(r => ({ id: r.id as string, company: str(r.company), role: str(r.role), platform: str(r.platform), type: str(r.type), tone: str(r.tone), at: r.created_at as string })),
    linkedin: linkedinRows.map(r => ({ id: r.id as string, targetRole: str(r.targetRole), targetIndustry: str(r.targetIndustry), at: r.created_at as string })),
    jobAnalyses: jobAnalysisRows.map(r => ({ id: r.id as string, jobTitle: str(r.jobTitle), company: str(r.company), score: num(r.score), source: str(r.source), at: r.created_at as string })),
    quizzes: quizRows.map(r => ({ id: r.id as string, plan: planTitle.get(r.interview_plan_id as string) ?? null, score: num(r.score), at: r.created_at as string })),
    plannerChats: { count: nPlannerChats, lastAt: (plannerChats[0]?.updated_at ?? plannerChats[0]?.created_at ?? null) as string | null },
    transcripts: transcriptRows.map(r => ({ id: r.id as string, fileName: str(r.file_name), at: r.created_at as string })),
    outcomes: outcomes.map(r => ({
      id: r.id as string, outcome: r.outcome as string, jobTitle: str(r.job_title), company: str(r.company_name),
      resumeScore: num(r.resume_score), atsScore: num(r.ats_score), percentile: num(r.benchmark_percentile),
      days: num(r.days_after_application), gotInterview: r.actually_got_interview == null ? null : !!r.actually_got_interview,
      at: (r.reported_at ?? r.created_at) as string,
    })),
  };
  const integrations = {
    google: calendar(googleCal[0], "google_email"),
    microsoft: calendar(microsoftCal[0], "account_email"),
    schedules: schedules.map(s => ({
      id: s.id as string, application: appTitle(s.application_id), startsAt: s.starts_at as string, endsAt: s.ends_at as string,
      timeZone: s.time_zone as string, stage: s.stage as string,
      calendar: s.google_event_id ? "Google" : s.microsoft_event_id ? "Outlook" : ".ics", createdAt: s.created_at as string,
    })),
    inbound: {
      address: inboundAddr[0] ? { createdAt: inboundAddr[0].created_at as string, rotatedAt: (inboundAddr[0].rotated_at as string) ?? null } : null,
      count: nInboundMail,
      emails: inboundMail.map(m => ({
        id: m.id as string, from: str(m.from_address), subject: str(m.subject), at: m.received_at as string, kind: m.kind as string,
        confidence: num(m.confidence), company: str(m.company), jobTitle: str(m.job_title), stage: str(m.stage),
        application: appTitle(m.application_id), previousStatus: str(m.previous_status), newStatus: str(m.new_status), outcome: m.outcome as string,
      })),
    },
  };
  const billingExtras = {
    transfers: [
      ...transfersOut.map(t => ({ id: t.id as string, direction: "sent" as const, other: person(t.to_user_id), grants: grantText(t.grants), at: t.created_at as string })),
      ...transfersIn.map(t => ({ id: t.id as string, direction: "received" as const, other: person(t.from_user_id), grants: grantText(t.grants), at: t.created_at as string })),
    ].sort((a, b) => b.at.localeCompare(a.at)),
    groupsOwned: groupsOwned.map(g => ({
      id: g.id as string, packKey: g.pack_key as string, seats: num(g.seats) ?? 0, createdAt: g.created_at as string,
      members: ownedMembers.filter(m => m.group_id === g.id && m.user_id !== userId).map(m => ({ ...person(m.user_id), joinedAt: m.joined_at as string })),
    })),
    groupsJoined: groupMemberships.map(m => {
      const g = joinedGroups.find(x => x.id === m.group_id);
      return { id: m.group_id as string, packKey: (g?.pack_key as string) ?? null, seats: num(g?.seats), owner: g ? person(g.owner_id) : null, joinedAt: m.joined_at as string };
    }).filter(g => g.owner?.id !== userId),
    rewards: rewards.map(r => ({ feature: r.feature_type as string, field: r.field as string, amount: num(r.amount) ?? 0, at: r.claimed_at as string })),
  };

  // ── Chrome extension ──────────────────────────────────────────────────────
  const extension = {
    available: extTelemetry?.available ?? false, capped: extTelemetry?.capped ?? false,
    installs: extTelemetry?.installs ?? [], counts: extTelemetry?.counts ?? [], recent: extTelemetry?.recent ?? [],
    jobs: extJobs?.jobs ?? apps.filter(a => a.viaExtension).map(a => ({
      id: a.id, company: a.company, title: a.jobTitle, status: a.status, platform: a.viaExtension as string, url: a.jobUrl,
      savedAt: a.createdAt, firstResponseAt: a.firstResponseAt, reachedInterviewAt: a.reachedInterviewAt,
    })),
    upsell: extJobs?.upsell ?? [],
  };
  const extLastSeen = [...extension.installs.map(i => i.lastSeenAt), ...extension.recent.map(e => e.at), ...extension.jobs.map(j => j.savedAt)].sort().pop() ?? null;

  // ── Which sections have data (Raw tab) ────────────────────────────────────
  const src = (table: string, label: string, tab: string, n: number) => ({ table, label, tab, n, state: failed.has(table) ? "missing" as const : n ? "data" as const : "empty" as const });
  const sources = [
    src("resumes", "Resumes", "jobsearch", resumes.length), src("tailored_resumes", "Tailored resumes", "jobsearch", tailored.length),
    src("interviews", "Mock interviews", "jobsearch", interviews.length), src("job_applications", "Job tracker", "jobsearch", applications.length),
    src("application_status_events", "Application status history", "jobsearch", statusEvents.length),
    src("cover_letters", "Cover letters", "jobsearch", coverLetters.length), src("interview_plans", "Study plans", "jobsearch", plans.length),
    src("quiz_results", "Study plan quizzes", "jobsearch", quizRows.length), src("interview_debriefs", "Interview debriefs", "jobsearch", debriefs.length),
    src("interview_schedules", "Scheduled interviews", "jobsearch", schedules.length), src("inbound_emails", "Forwarded job emails", "jobsearch", nInboundMail),
    src("inbound_addresses", "Forwarding address", "jobsearch", inboundAddr.length), src("outcome_data", "Reported outcomes", "jobsearch", outcomes.length),
    src("contacts", "Contacts", "careertools", nContactRows), src("contact_interactions", "Contact interactions", "careertools", nInteractions),
    src("contact_searches", "Contact searches", "careertools", nContacts), src("outreach_history", "Cold outreach", "careertools", nOutreach),
    src("linkedin_optimizations", "LinkedIn optimisations", "careertools", nLinkedin), src("job_analyses", "Job analyses", "careertools", nJobAnalyses),
    src("planner_chat_sessions", "Planner chats", "careertools", nPlannerChats), src("transcripts", "Transcripts", "careertools", transcriptRows.length),
    src("extension_installs", "Extension installs", "extension", extension.installs.length), src("extension_events", "Extension events", "extension", extension.recent.length),
    src("activity_events", "Dashboard clickstream (90 days)", "activity", activity.length), src("user_sessions", "Devices", "activity", sessions.length),
    src("email_sends", "Emails sent", "activity", emailSends.length), src("notifications", "Notifications", "activity", notifications.length),
    src("email_unsubscribes", "Unsubscribes", "activity", unsubscribes.length),
    src("google_calendar_connections", "Google Calendar", "account", googleCal.length), src("microsoft_calendar_connections", "Outlook Calendar", "account", microsoftCal.length),
    src("account_events", "Security events", "support", accountEvents.length),
    src("credit_packs", "Credit packs", "subscription", packs.length), src("credit_transfers", "Credit transfers", "subscription", transfersOut.length + transfersIn.length),
    src("pack_groups", "Group packs owned", "subscription", groupsOwned.length), src("pack_group_members", "Group packs joined", "subscription", groupMemberships.length),
    src("feature_rewards", "Feedback rewards", "subscription", rewards.length), src("refund_requests", "Refund requests", "support", refunds.length),
    src("payment_disputes", "Payment disputes", "support", disputes.length),
    src("support_tickets", "Support tickets", "support", tickets.length), src("product_surveys", "Surveys", "support", surveys.length),
    src("feature_ratings", "Feature ratings", "support", ratings.length), src("flagged_accounts", "Account flags", "support", flags.length),
  ];
  // extension_* are optional until Dashboard migration 0072 is applied.
  if (!extension.available) { failed.add("extension_installs"); failed.add("extension_events"); }
  sources.forEach(s => { if (failed.has(s.table)) s.state = "missing"; });

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
  // Career tools
  careerTools.contacts.forEach(c => push(c.createdAt, "networking", "Added contact", [c.name, c.company].filter(Boolean).join(" · ")));
  careerTools.interactions.forEach(i => push(i.at, "networking", `Logged ${i.type}`, i.contact));
  careerTools.contactSearches.forEach(s => push(s.at, "networking", "Searched for contacts", [s.company, s.contacts != null ? `${s.contacts} found` : null].filter(Boolean).join(" · ")));
  careerTools.outreach.forEach(o => push(o.at, "networking", "Wrote cold outreach", [o.role, o.company, o.platform].filter(Boolean).join(" · ")));
  careerTools.linkedin.forEach(l => push(l.at, "career", "Optimised LinkedIn profile", l.targetRole));
  careerTools.jobAnalyses.forEach(j => push(j.at, j.source === "extension" ? "extension" : "career", "Analysed a job", [j.jobTitle, j.company, j.score != null ? `score ${j.score}` : null].filter(Boolean).join(" · ")));
  careerTools.quizzes.forEach(z => push(z.at, "career", "Took a study quiz", [z.plan, z.score != null ? `score ${z.score}` : null].filter(Boolean).join(" · ")));
  careerTools.transcripts.forEach(t => push(t.at, "career", "Uploaded transcript", t.fileName));
  careerTools.outcomes.forEach(o => push(o.at, "application", `Reported outcome: ${o.outcome.replace(/_/g, " ")}`, [o.jobTitle, o.company].filter(Boolean).join(" at ")));
  // Calendar and inbound mail
  push(integrations.google?.connectedAt, "account", "Connected Google Calendar", integrations.google?.account);
  push(integrations.microsoft?.connectedAt, "account", "Connected Outlook Calendar", integrations.microsoft?.account);
  integrations.schedules.forEach(s => push(s.createdAt, "interview", "Scheduled an interview", [s.application, s.stage].filter(Boolean).join(" · ")));
  push(integrations.inbound.address?.createdAt, "account", "Set up email forwarding", null);
  integrations.inbound.emails.forEach(m => push(m.at, "application", `Forwarded email: ${m.kind.replace(/_/g, " ")}`, [m.company, m.outcome].filter(Boolean).join(" · ")));
  // Billing extras
  billingExtras.transfers.forEach(t => push(t.at, "billing", t.direction === "sent" ? "Sent credits" : "Received credits", [t.grants, t.other.name ?? t.other.email].filter(Boolean).join(" · ")));
  billingExtras.groupsOwned.forEach(g => push(g.createdAt, "billing", "Bought a group pack", `${g.packKey} · ${g.members.length + 1} of ${g.seats} seats`));
  billingExtras.groupsJoined.forEach(g => push(g.joinedAt, "billing", "Joined a group pack", g.owner?.name ?? g.owner?.email ?? null));
  billingExtras.rewards.forEach(r => push(r.at, "billing", "Claimed feedback reward", `${r.amount} ${r.feature.replace(/[-_]/g, " ")}`));
  // Chrome extension: installs, plus one line per day of use
  extension.installs.forEach(i => {
    push(i.installedAt, "extension", "Installed the Chrome extension", [i.version && `v${i.version}`, i.browser, i.os].filter(Boolean).join(" · "));
    push(i.uninstalledAt, "extension", "Uninstalled the Chrome extension", i.version ? `v${i.version}` : null);
  });
  const extDays = new Map<string, Map<string, number>>();
  extension.recent.filter(e => !EXT_LIFECYCLE_EVENTS.has(e.event)).forEach(e => {
    const k = e.at.slice(0, 10), m = extDays.get(k) ?? new Map<string, number>();
    m.set(e.event, (m.get(e.event) ?? 0) + 1); extDays.set(k, m);
  });
  extDays.forEach((m, k) => {
    const last = extension.recent.find(e => e.at.startsWith(k))?.at ?? `${k}T12:00:00Z`;
    push(last, "extension", "Used the Chrome extension", [...m].map(([e, c]) => `${c} × ${extEventLabel(e).toLowerCase()}`).join(" · "));
  });
  // Dashboard sittings (90 days)
  clickSessions.forEach(s => push(s.end, "session", "Dashboard session", [`${s.views} page${s.views === 1 ? "" : "s"}`, s.clicks ? `${s.clicks} clicks` : null, s.timeMs >= 60_000 ? `${Math.round(s.timeMs / 60_000)} min` : null, s.source && `from ${s.source}`].filter(Boolean).join(" · ")));
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
        supportReplies: notif.supportReplies !== false,
        // null: never on the list, which is "not subscribed" rather than an opt-out.
        productUpdates: newsletterRow ? newsletterRow.subscribed !== false : null,
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
      extensionJobs: extension.jobs.length,
      extensionLastAt: extLastSeen,
      extensionInstalls: extension.installs.filter(i => !i.uninstalledAt).length,
      extensionEvents: extension.counts.filter(c => c.use).reduce((s, c) => s + c.n, 0),
      contacts: nContactRows, inboundEmails: nInboundMail,
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
    activity: {
      windowDays: ACTIVITY_DAYS, rows: activity.length, capped: activityRes.capped,
      engagedMs: activity.reduce((s, a) => s + (a.event === "time" ? Number(a.duration_ms ?? 0) : 0), 0),
      views: activity.filter(a => a.event === "page_view").length, clicks: activity.filter(a => a.event === "click").length,
      sessions: clickSessions.length,
      pages: [...byPath.values()].sort((a, b) => b.timeMs - a.timeMs || b.views - a.views).slice(0, 40),
      days: [...days.values()],
      // The 25 most recent sittings with their steps; the rest only count.
      recentSessions: clickSessions.slice(0, 25),
    },
    careerTools,
    integrations,
    billingExtras,
    extension,
    sources,
    emails,
    notifications: notifications.filter(n => !n.deleted).map(n => ({ id: n.id, title: n.title, type: n.type, read: !!n.read, createdAt: n.created_at })),
    tickets: tickets.map(t => ({ id: t.id, subject: t.subject, status: t.status, priority: t.priority, category: t.category, replies: t.reply_count ?? 0, lastReplyBy: t.last_reply_by, createdAt: t.created_at, updatedAt: t.updated_at })),
    surveys: surveys.map(s => ({ id: s.id, page: s.page, rating: s.overall_rating, nps: s.nps, improvement: s.top_improvement, text: s.free_text, createdAt: s.created_at })),
    ratings: ratings.map(r => ({ id: r.id, feature: r.feature, rating: r.rating, nps: r.nps, comment: r.comment, createdAt: r.created_at })),
    accountEvents: accountEvents.map(e => ({ type: e.type as string, detail: (e.detail as Record<string, unknown>) ?? {}, at: e.created_at as string })),
    disputes: disputes.map(x => ({ id: x.id as string, amountCents: x.amount_cents as number, reason: x.reason as string, status: x.status as string, dueBy: (x.evidence_due_by as string) ?? null, what: (x.what as string) ?? null, at: x.created_at as string })),
    unsubscribes: unsubscribes.map(u => ({ scope: u.scope as string, method: u.method as string, lastEmailType: (u.last_email_type as string) ?? null, at: u.created_at as string })),
    refunds: refunds.map(r => ({
      id: r.id, kind: r.kind ?? null, status: r.status, reason: r.user_reason,
      quotedCents: r.quoted_refund_cents, feeCents: r.quoted_fee_cents ?? null, paidCents: r.amount_paid_cents,
      note: r.refund_error ?? r.decision_note, stripeRefundId: r.stripe_refund_id ?? null,
      createdAt: r.created_at, decidedAt: r.decided_at, refundedAt: r.refunded_at ?? null,
    })),
    flags: flags.map(f => ({ id: f.id, reason: f.reason, status: f.status, note: f.resolution_note, createdAt: f.created_at, resolvedAt: f.resolved_at })),
    timeline: timeline.slice(0, 300),
  };
}

export type User360 = Awaited<ReturnType<typeof loadUser360>>;
