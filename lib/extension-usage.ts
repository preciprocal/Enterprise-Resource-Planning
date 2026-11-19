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
// ─── Install and usage telemetry (Dashboard migration 0072) ─────────────────
// From extension 1.14 the Dashboard also writes:
//   extension_installs  one row per browser install (version, browser, last seen, uninstalled)
//   extension_events    one row per thing the extension did (lib/extension-events.ts)
// Until that migration is applied both tables are missing; every read below
// degrades to "not available" and the job-based numbers still show.
//
// ─── Recognising an extension save ───────────────────────────────────────────
// track-job stores source = the platform name the extension detected, or
// 'chrome_extension' when it couldn't tell, and linkedin_job_id for LinkedIn.
// The platform names are the extension's own list (Dashboard
// extension/external-apply.js PLATFORM_NAMES). The manual job tracker's Source
// field is free text, so a hand-typed "Indeed" is indistinguishable from an
// extension save; that ambiguity is accepted and stated in the UI.
import type { SupabaseClient } from "@supabase/supabase-js";
import { EXT_LIFECYCLE_EVENTS, EXT_UPSELL_EVENTS, compareVersions } from "@/lib/extension-events";

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

// ─── Telemetry reads (never throw: a missing table reads as ok=false) ────────

type PageResult<T> = { rows: T[]; ok: boolean; capped: boolean };
async function pageAll<T>(
  build: (from: number, to: number) => PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>,
  maxRows: number,
): Promise<PageResult<T>> {
  const rows: T[] = [];
  try {
    for (let from = 0; from < maxRows; from += 1000) {
      const { data, error } = await build(from, Math.min(from + 999, maxRows - 1));
      if (error) return { rows, ok: false, capped: false };
      rows.push(...((data ?? []) as T[]));
      if (!data || data.length < 1000) return { rows, ok: true, capped: false };
    }
    return { rows, ok: true, capped: true };
  } catch { return { rows, ok: false, capped: false }; }
}

export interface InstallRow {
  install_id: string; user_id: string | null; version: string | null; browser: string | null; os: string | null;
  installed_at: string | null; last_seen_at: string; uninstalled_at: string | null; created_at: string;
}
interface EventRow {
  install_id: string | null; user_id: string | null; event: string; version: string | null;
  platform: string | null; host: string | null; ok: string | null; created_at: string;
}
const INSTALL_COLS = "install_id,user_id,version,browser,os,installed_at,last_seen_at,uninstalled_at,created_at";
// detail is small, but only `ok` is needed here.
const EVENT_COLS = "install_id,user_id,event,version,platform,host,ok:detail->>ok,created_at";
const EVENT_CAP = 25_000;

export const installedAt = (i: InstallRow) => i.installed_at ?? i.created_at;

/** Every install (or one user's), newest activity first. ok=false until migration 0072 is applied. */
export async function extensionInstalls(sb: SupabaseClient, userId?: string) {
  return pageAll<InstallRow>((a, b) => {
    let q = sb.from("extension_installs").select(INSTALL_COLS).order("last_seen_at", { ascending: false }).range(a, b);
    if (userId) q = q.eq("user_id", userId);
    return q;
  }, 20_000);
}

async function extensionEvents(sb: SupabaseClient, since: string) {
  return pageAll<EventRow>((a, b) => sb.from("extension_events").select(EVENT_COLS)
    .gte("created_at", since).order("created_at", { ascending: false }).range(a, b), EVENT_CAP);
}

/** profiles + plan for a set of user ids, chunked so the URL stays short. */
async function peopleFor(sb: SupabaseClient, ids: string[]) {
  const prof = new Map<string, { name: string | null; email: string | null }>();
  const plan = new Map<string, string>();
  for (let i = 0; i < ids.length; i += 200) {
    const chunk = ids.slice(i, i + 200);
    const [p, s] = await Promise.all([
      sb.from("profiles").select("user_id,name,email").in("user_id", chunk),
      sb.from("subscriptions").select("user_id,plan").in("user_id", chunk),
    ]);
    ((p.data ?? []) as { user_id: string; name: string | null; email: string | null }[]).forEach(r => prof.set(r.user_id, r));
    ((s.data ?? []) as { user_id: string; plan: string | null }[]).forEach(r => plan.set(r.user_id, r.plan ?? "free"));
  }
  return { prof, plan };
}

const isUse = (e: string) => !EXT_LIFECYCLE_EVENTS.has(e) && !e.startsWith("upsell_");

function telemetry(installs: PageResult<InstallRow>, events: PageResult<EventRow>, since: string, now: number) {
  const live = installs.rows.filter(i => !i.uninstalled_at);
  const seenSince = (ms: number) => live.filter(i => Date.parse(i.last_seen_at) >= now - ms).length;
  const uninstalled = installs.rows.length - live.length;

  const group = (rows: EventRow[], key: (e: EventRow) => string | null) => {
    const m = new Map<string, { n: number; who: Set<string>; failed: number }>();
    for (const e of rows) {
      const k = key(e); if (!k) continue;
      const v = m.get(k) ?? { n: 0, who: new Set(), failed: 0 };
      v.n++; v.who.add(e.user_id ?? e.install_id ?? "?"); if (e.ok === "false") v.failed++;
      m.set(k, v);
    }
    return [...m].map(([key, v]) => ({ key, n: v.n, users: v.who.size, failed: v.failed })).sort((a, b) => b.n - a.n);
  };
  const use = events.rows.filter(e => isUse(e.event));

  const versions = new Map<string, { installs: number; active30: number }>();
  for (const i of live) {
    const k = i.version ?? "Unknown", v = versions.get(k) ?? { installs: 0, active30: 0 };
    v.installs++; if (Date.parse(i.last_seen_at) >= now - 30 * DAY) v.active30++;
    versions.set(k, v);
  }
  const browsers = new Map<string, number>();
  for (const i of live) { const k = [i.browser, i.os].filter(Boolean).join(" · ") || "Unknown"; browsers.set(k, (browsers.get(k) ?? 0) + 1); }
  const n = (e: string) => events.rows.filter(x => x.event === e).length;

  return {
    available: installs.ok && events.ok, eventsCapped: events.capped,
    installs: {
      total: installs.rows.length, live: live.length, active7: seenSince(7 * DAY), active30: seenSince(30 * DAY), uninstalled,
      uninstallRatePct: installs.rows.length ? Math.round((uninstalled / installs.rows.length) * 1000) / 10 : null,
      signedIn: installs.rows.filter(i => i.user_id).length, anonymous: installs.rows.filter(i => !i.user_id).length,
      newInRange: installs.rows.filter(i => installedAt(i) >= since).length,
      uninstalledInRange: installs.rows.filter(i => i.uninstalled_at && i.uninstalled_at >= since).length,
    },
    versions: [...versions].map(([version, v]) => ({ version, ...v }))
      .sort((a, b) => a.version === "Unknown" ? 1 : b.version === "Unknown" ? -1 : compareVersions(b.version, a.version)),
    browsers: [...browsers].map(([name, c]) => ({ name, n: c })).sort((a, b) => b.n - a.n),
    events: group(events.rows, e => e.event).map(({ key, ...r }) => ({ event: key, ...r })),
    usePlatforms: group(use, e => e.platform).map(({ key, ...r }) => ({ platform: key, ...r })),
    useHosts: group(use, e => e.host).slice(0, 15).map(({ key, ...r }) => ({ host: key, ...r })),
    upsell: { shown: n(EXT_UPSELL_EVENTS[0]), dismissed: n(EXT_UPSELL_EVENTS[1]), clicked: n(EXT_UPSELL_EVENTS[2]) },
    // Raw timestamps of "use" events; the browser buckets them by local day.
    useTimes: use.map(e => ({ at: e.created_at, userId: e.user_id ?? e.install_id ?? "" })),
  };
}
const interviewed = (r: JobRow) => !!r.reached_interview_at || ["interview", "interviewing", "offer"].includes(String(r.status));

export async function extensionOverview(sb: SupabaseClient, days: number) {
  const now = Date.now();
  const since = new Date(now - days * DAY).toISOString();
  const [jobs, upsell, usersCount, installs, events] = await Promise.all([
    extensionJobs(sb),
    upsellEvents(sb, since),
    sb.from("profiles").select("user_id", { count: "exact", head: true }),
    extensionInstalls(sb),
    extensionEvents(sb, since),
  ]);
  const tele = telemetry(installs, events, since, now);
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

  // Per signed-in owner of an install: version, last seen, event counts in range.
  type TeleUser = { version: string | null; browser: string | null; installs: number; uninstalled: number; installedAt: string | null; lastSeenAt: string; counts: Record<string, number>; total: number };
  const teleBy = new Map<string, TeleUser>();
  const browserOf = (i: InstallRow) => [i.browser, i.os].filter(Boolean).join(" · ") || null;
  for (const i of installs.rows) {
    if (!i.user_id) continue;
    const u = teleBy.get(i.user_id) ?? { version: i.version, browser: browserOf(i), installs: 0, uninstalled: 0, installedAt: installedAt(i), lastSeenAt: i.last_seen_at, counts: {}, total: 0 };
    u.installs++; if (i.uninstalled_at) u.uninstalled++;
    if (!u.installedAt || installedAt(i) < u.installedAt) u.installedAt = installedAt(i);
    if (i.last_seen_at > u.lastSeenAt) { u.lastSeenAt = i.last_seen_at; u.version = i.version; u.browser = browserOf(i); }
    teleBy.set(i.user_id, u);
  }
  for (const e of events.rows) {
    if (!e.user_id) continue;
    // Older extension versions send no install_id, so a user can have events and no install row.
    const u = teleBy.get(e.user_id) ?? { version: e.version, browser: null, installs: 0, uninstalled: 0, installedAt: null, lastSeenAt: e.created_at, counts: {}, total: 0 };
    u.counts[e.event] = (u.counts[e.event] ?? 0) + 1; u.total++;
    if (e.created_at > u.lastSeenAt) u.lastSeenAt = e.created_at;
    if (!u.version && e.version) u.version = e.version;
    teleBy.set(e.user_id, u);
  }
  const { prof, plan } = await peopleFor(sb, [...new Set([...ids, ...teleBy.keys()])]);

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
    telemetry: {
      ...tele,
      users: [...teleBy].map(([id, u]) => ({
        id, name: prof.get(id)?.name ?? null, email: prof.get(id)?.email ?? null, plan: plan.get(id) ?? "free", ...u,
        jobsSaved: byUser.get(id)?.jobs ?? 0,
      })).sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt)),
    },
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

/** One user's installs and extension events (user page). available=false until migration 0072. */
export async function extensionUserTelemetry(sb: SupabaseClient, userId: string) {
  const [installs, events] = await Promise.all([
    extensionInstalls(sb, userId),
    // Small facts only: no detail blob beyond these keys.
    // detail keys written by the Dashboard's /api/extension/* routes.
    pageAll<EventRow & { error: string | null; fields: string | null; fit: string | null; prev: string | null; result: string | null; ghost: string | null; odds: string | null; state: string | null; variant: string | null }>((a, b) => sb.from("extension_events")
      .select(`${EVENT_COLS},error:detail->>error,fields:detail->>fields_filled,fit:detail->>fit_score,prev:detail->>previous_version,result:detail->>result,ghost:detail->>ghost_risk,odds:detail->>company_odds,state:detail->>state,variant:detail->>variant`)
      .eq("user_id", userId).order("created_at", { ascending: false }).range(a, b), 3000),
  ]);
  const counts = new Map<string, { n: number; failed: number; last: string }>();
  for (const e of events.rows) {
    const c = counts.get(e.event) ?? { n: 0, failed: 0, last: e.created_at };
    c.n++; if (e.ok === "false") c.failed++; if (e.created_at > c.last) c.last = e.created_at;
    counts.set(e.event, c);
  }
  return {
    available: installs.ok && events.ok, capped: events.capped,
    installs: installs.rows.map(i => ({
      id: i.install_id, version: i.version, browser: i.browser, os: i.os,
      installedAt: installedAt(i), lastSeenAt: i.last_seen_at, uninstalledAt: i.uninstalled_at,
    })),
    counts: [...counts].map(([event, c]) => ({ event, ...c, use: isUse(event) })).sort((a, b) => b.n - a.n),
    recent: events.rows.slice(0, 300).map(e => ({
      event: e.event, version: e.version, platform: e.platform, host: e.host,
      ok: e.ok === "false" ? false : e.ok === "true" ? true : null, error: e.error,
      fieldsFilled: e.fields != null ? Number(e.fields) : null, fitScore: e.fit != null ? Number(e.fit) : null,
      previousVersion: e.prev, result: e.result, ghostRisk: e.ghost, companyOdds: e.odds, state: e.state, variant: e.variant,
      installId: e.install_id, at: e.created_at,
    })),
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
