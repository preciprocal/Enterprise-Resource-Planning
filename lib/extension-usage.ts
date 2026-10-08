// lib/extension-usage.ts — server only.
// Who uses the Preciprocal Chrome extension, and what they do with it.
//
// ─── What can and can't be measured ──────────────────────────────────────────
// The extension authenticates with the user's normal Supabase access token
// (Dashboard: lib/auth/verify-request.ts), so installing or "connecting" it
// writes nothing. Its job analysis and auto-apply calls don't write either.
// The footprints it does leave:
//   job_applications       every job it saves (Dashboard /api/extension/track-job)
//   extension_upsell_events the in-extension Pro prompt: shown / dismissed / clicked
// So an "extension user" here is someone who saved at least one job through it.
//
// ─── Recognising an extension save ───────────────────────────────────────────
// track-job stores source = the platform name the extension detected, or
// 'chrome_extension' when it couldn't tell, and linkedin_job_id for LinkedIn.
// The platform names are the extension's own list (Dashboard
// extension/external-apply.js PLATFORM_NAMES). The manual job tracker's Source
// field is free text, so a hand-typed "Indeed" is indistinguishable from an
// extension save; that ambiguity is accepted and stated in the UI.
import type { SupabaseClient } from "@supabase/supabase-js";

const EXT_PLATFORMS = new Set([
  "Greenhouse", "Lever", "Workday", "Indeed", "Ashby", "iCIMS", "Jobvite",
  "SmartRecruiters", "Taleo", "BambooHR", "Recruitee", "Wellfound",
]);

export function extensionPlatform(source: string | null, linkedinJobId: string | null): string | null {
  if (linkedinJobId) return "LinkedIn";
  if (source === "chrome_extension") return "Other sites";
  if (source && EXT_PLATFORMS.has(source)) return source;
  return null;
}

interface JobRow {
  id: string; user_id: string; company: string | null; job_title: string | null; status: string | null;
  source: string | null; linkedin_job_id: string | null; job_url: string | null; created_at: string;
  first_response_at: string | null; reached_interview_at: string | null;
}

const JOB_COLS = "id,user_id,company,job_title,status,source,linkedin_job_id,job_url,created_at,first_response_at,reached_interview_at";

/** Every extension-saved job, paged so the count is never silently capped. */
async function extensionJobs(sb: SupabaseClient, userId?: string): Promise<(JobRow & { platform: string })[]> {
  const out: (JobRow & { platform: string })[] = [];
  for (let off = 0; ; off += 1000) {
    let q = sb.from("job_applications").select(JOB_COLS).order("created_at", { ascending: false }).range(off, off + 999);
    if (userId) q = q.eq("user_id", userId);
    const { data, error } = await q;
    if (error) throw new Error(`job_applications: ${error.message}`);
    for (const r of (data ?? []) as JobRow[]) {
      const platform = extensionPlatform(r.source, r.linkedin_job_id);
      if (platform) out.push({ ...r, platform });
    }
    if (!data || data.length < 1000) break;
  }
  return out;
}

/** Upsell events; the table is optional (Dashboard migration 0027 is applied by hand). */
async function upsellEvents(sb: SupabaseClient, since?: string, userId?: string) {
  let q = sb.from("extension_upsell_events").select("user_id,event,variant,created_at").order("created_at", { ascending: false }).limit(5000);
  if (since) q = q.gte("created_at", since);
  if (userId) q = q.eq("user_id", userId);
  const { data, error } = await q;
  return error ? [] : (data ?? []) as { user_id: string; event: string; variant: string; created_at: string }[];
}

const DAY = 86_400_000;
const interviewed = (r: JobRow) => !!r.reached_interview_at || ["interview", "interviewing", "offer"].includes(String(r.status));

export async function extensionOverview(sb: SupabaseClient, days: number) {
  const now = Date.now();
  const since = new Date(now - days * DAY).toISOString();
  const [jobs, upsell, usersCount] = await Promise.all([
    extensionJobs(sb),
    upsellEvents(sb, since),
    sb.from("profiles").select("user_id", { count: "exact", head: true }),
  ]);
  const inRange = jobs.filter(j => j.created_at >= since);

  // Per-user rollup (all time, plus the selected range).
  const byUser = new Map<string, { jobs: number; jobsInRange: number; first: string; last: string; platforms: Map<string, number>; interviews: number }>();
  for (const j of jobs) {
    const u = byUser.get(j.user_id) ?? { jobs: 0, jobsInRange: 0, first: j.created_at, last: j.created_at, platforms: new Map(), interviews: 0 };
    u.jobs++; if (j.created_at >= since) u.jobsInRange++;
    if (j.created_at < u.first) u.first = j.created_at;
    if (j.created_at > u.last) u.last = j.created_at;
    u.platforms.set(j.platform, (u.platforms.get(j.platform) ?? 0) + 1);
    if (interviewed(j)) u.interviews++;
    byUser.set(j.user_id, u);
  }
  const ids = [...byUser.keys()];
  const [profiles, subs] = ids.length ? await Promise.all([
    sb.from("profiles").select("user_id,name,email").in("user_id", ids),
    sb.from("subscriptions").select("user_id,plan,status").in("user_id", ids),
  ]) : [{ data: [] }, { data: [] }];
  const prof = new Map(((profiles.data ?? []) as { user_id: string; name: string | null; email: string | null }[]).map(p => [p.user_id, p]));
  const plan = new Map(((subs.data ?? []) as { user_id: string; plan: string | null }[]).map(s => [s.user_id, s.plan ?? "free"]));

  const activeSince = (ms: number) => [...byUser.values()].filter(u => Date.parse(u.last) >= now - ms).length;
  const platformAgg = new Map<string, { jobs: number; users: Set<string> }>();
  for (const j of inRange) {
    const p = platformAgg.get(j.platform) ?? { jobs: 0, users: new Set() };
    p.jobs++; p.users.add(j.user_id); platformAgg.set(j.platform, p);
  }
  const statusAgg = new Map<string, number>();
  for (const j of inRange) statusAgg.set(j.status ?? "unknown", (statusAgg.get(j.status ?? "unknown") ?? 0) + 1);
  const count = (e: string) => upsell.filter(x => x.event === e).length;
  const totalUsers = usersCount.count ?? 0;

  return {
    range: { days, from: since },
    totals: {
      users: byUser.size,
      activeInRange: new Set(inRange.map(j => j.user_id)).size,
      active7: activeSince(7 * DAY), active30: activeSince(30 * DAY),
      jobsInRange: inRange.length, jobsAllTime: jobs.length,
      totalUsers, shareOfUsersPct: totalUsers ? Math.round((byUser.size / totalUsers) * 1000) / 10 : null,
      interviewsInRange: inRange.filter(interviewed).length,
      respondedInRange: inRange.filter(j => !!j.first_response_at).length,
    },
    // Raw timestamps: the browser buckets them into days in the viewer's time zone.
    saves: inRange.map(j => ({ at: j.created_at, userId: j.user_id })),
    platforms: [...platformAgg].map(([platform, p]) => ({ platform, jobs: p.jobs, users: p.users.size })).sort((a, b) => b.jobs - a.jobs),
    statuses: [...statusAgg].map(([status, n]) => ({ status, n })).sort((a, b) => b.n - a.n),
    upsell: { shown: count("shown"), dismissed: count("dismissed"), clicked: count("clicked") },
    users: ids.map(id => {
      const u = byUser.get(id)!, p = prof.get(id);
      return {
        id, name: p?.name ?? null, email: p?.email ?? null, plan: plan.get(id) ?? "free",
        firstUsedAt: u.first, lastUsedAt: u.last, jobs: u.jobs, jobsInRange: u.jobsInRange, interviews: u.interviews,
        platforms: [...u.platforms].sort((a, b) => b[1] - a[1]).map(([name, n]) => ({ name, n })),
      };
    }).sort((a, b) => b.lastUsedAt.localeCompare(a.lastUsedAt)),
  };
}

/** One user's extension activity, newest first. */
export async function extensionUserActivity(sb: SupabaseClient, userId: string) {
  const [jobs, upsell] = await Promise.all([extensionJobs(sb, userId), upsellEvents(sb, undefined, userId)]);
  return {
    jobs: jobs.slice(0, 200).map(j => ({
      id: j.id, company: j.company, title: j.job_title, status: j.status, platform: j.platform, url: j.job_url,
      savedAt: j.created_at, firstResponseAt: j.first_response_at, reachedInterviewAt: j.reached_interview_at,
    })),
    upsell: upsell.slice(0, 100).map(e => ({ event: e.event, variant: e.variant, at: e.created_at })),
  };
}
