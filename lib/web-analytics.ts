// lib/web-analytics.ts
// ─────────────────────────────────────────────────────────────────────────────
// Server-side reads of the marketing-site analytics views (web_*), aggregated
// for the ERP's Marketing section (components/admin/MarketingTab.tsx).
// Schema source of truth: supabase/web_analytics.sql in the Landing-Page repo.
//
// The tables have RLS with no policies, so these MUST run with the service
// role (a browser query silently returns []).
//
// Aggregation rules — these are what keep the numbers honest:
//  • unique_visitors is never summed across days: declined-cookie visitors get
//    a hash regenerated daily, so a sum overstates reach. Multi-day ranges
//    report the AVERAGE DAILY unique count instead.
//  • Pre-averaged columns (avg_*, *_pct) are never averaged across rows. Every
//    rate is rebuilt from counts over the whole range. Where a view only
//    exposes an average/percentage, the underlying total is recovered by
//    multiplying back by that row's own denominator (e.g. avg_duration_ms ×
//    sessions, bounce_rate_pct × sessions / 100) and re-divided at the end.
//    That only works when the view's average is over the denominator it
//    exposes. Session durations (avg_duration_ms / avg_session_ms) average
//    only sessions with a duration and don't expose that count, so they're
//    recomputed from web_sessions instead (see sessionRows / durationBy).
//  • Medians can't be combined across days, so they're only returned for
//    single-day ranges.
//  • Only the views are read (never web_events), so page-exit records
//    (metadata.closing = 'true') can't be double counted.
//  • No IPs, names or emails exist here, and nothing is joined to user records.
// ─────────────────────────────────────────────────────────────────────────────
import "server-only";
import { SupabaseClient } from "@supabase/supabase-js";

type Row = Record<string, unknown>;
const num = (v: unknown) => (v == null ? 0 : Number(v) || 0);
const pct = (n: number, d: number) => (d > 0 ? Math.round((1000 * n) / d) / 10 : null);
const div = (n: number, d: number) => (d > 0 ? n / d : null);

export interface Range { from: string; to: string; days: number }

/** Last N days in UTC, inclusive of today. Capped at the 14-month retention window. */
export function rangeFromDays(days: number): Range {
  const n = Math.min(Math.max(Math.round(days) || 30, 1), 425);
  const to = new Date(); to.setUTCHours(0, 0, 0, 0);
  const from = new Date(to.getTime() - (n - 1) * 86_400_000);
  return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10), days: n };
}

async function rows(sb: SupabaseClient, view: string, r: Range, select = "*"): Promise<Row[]> {
  const out: Row[] = [];
  for (let off = 0; off < 50_000; off += 1000) {
    const { data, error } = await sb.from(view).select(select)
      .gte("day", `${r.from}T00:00:00Z`).lte("day", `${r.to}T00:00:00Z`).range(off, off + 999);
    if (error) throw new Error(`${view}: ${error.message}`);
    out.push(...((data ?? []) as unknown as Row[]));
    if (!data || data.length < 1000) break;
  }
  return out;
}

/**
 * Session durations, straight from web_sessions. The views' avg_duration_ms /
 * avg_session_ms average only sessions WHERE duration_ms IS NOT NULL and don't
 * expose that count, so "avg × sessions" can't recover the total. Exact
 * averages are rebuilt here instead, bucketed exactly like the views
 * (UTC day of started_at; channel/source coalesced to 'direct'/'Direct').
 */
async function sessionRows(sb: SupabaseClient, r: Range): Promise<Row[]> {
  const out: Row[] = [];
  const end = new Date(Date.parse(`${r.to}T00:00:00Z`) + 86_400_000).toISOString();
  for (let off = 0; off < 200_000; off += 1000) {
    const { data, error } = await sb.from("web_sessions").select("started_at,duration_ms,channel,source_name,utm_campaign,entry_path,exit_path")
      .gte("started_at", `${r.from}T00:00:00Z`).lt("started_at", end).range(off, off + 999);
    if (error) throw new Error(`web_sessions: ${error.message}`);
    out.push(...((data ?? []) as unknown as Row[]));
    if (!data || data.length < 1000) break;
  }
  return out;
}
/** Mean duration (ms) per key over sessions that have a duration. */
function durationBy(list: Row[], key: (r: Row) => string): Map<string, number | null> {
  const acc = group(list.filter(s => s.duration_ms != null), key, () => ({ sum: 0, n: 0 }), (a, s) => { a.sum += num(s.duration_ms); a.n++; });
  return new Map([...acc].map(([k, a]) => [k, div(a.sum, a.n)]));
}
const srcKey  = (x: Row) => `${(x.source_name as string) || "Direct"}\u0000${(x.channel as string) || "direct"}`;
const chanKey = (x: Row) => (x.channel as string) || "direct";

/** Group rows and fold each group with an accumulator. */
function group<T>(list: Row[], key: (r: Row) => string, init: () => T, add: (acc: T, r: Row) => void): Map<string, T> {
  const m = new Map<string, T>();
  for (const r of list) { const k = key(r); let a = m.get(k); if (!a) { a = init(); m.set(k, a); } add(a, r); }
  return m;
}

const dayKey = (r: Row) => String(r.day).slice(0, 10);

// ─── Overview ─────────────────────────────────────────────────────────────────

export async function overview(sb: SupabaseClient, r: Range) {
  const [daily, acq, sess] = await Promise.all([
    rows(sb, "web_daily_summary", r), rows(sb, "web_acquisition", r, "day,sessions,sessions_reaching_app"), sessionRows(sb, r),
  ]);
  let sessions = 0, pageViews = 0, bounces = 0, consented = 0, uniqDaySum = 0, known = 0;
  const byDay = new Map<string, { sessions: number; uniques: number; pageViews: number }>();
  for (const d of daily) {
    const s = num(d.sessions);
    sessions += s; pageViews += num(d.page_views); consented += num(d.consented_sessions); known += num(d.known_visitors);
    bounces += Math.round((num(d.bounce_rate_pct) * s) / 100);   // bounce_rate_pct is over all sessions, so this recovers the count
    uniqDaySum += num(d.unique_visitors);
    byDay.set(dayKey(d), { sessions: s, uniques: num(d.unique_visitors), pageViews: num(d.page_views) });
  }
  const reachedApp = acq.reduce((a, x) => a + num(x.sessions_reaching_app), 0);
  const activeDays = daily.length;

  // Continuous series (zero-filled) so the chart's x-axis is the real range.
  const series: { day: string; sessions: number; uniques: number; pageViews: number }[] = [];
  for (let t = Date.parse(r.from); t <= Date.parse(r.to); t += 86_400_000) {
    const k = new Date(t).toISOString().slice(0, 10);
    series.push({ day: k, ...(byDay.get(k) ?? { sessions: 0, uniques: 0, pageViews: 0 }) });
  }

  return {
    range: r,
    totals: {
      sessions, pageViews,
      // Rule: never a sum. Single day → that day's count; otherwise the mean over days that had traffic.
      uniqueVisitors: r.days === 1 ? uniqDaySum : null,
      avgDailyUniques: activeDays ? Math.round((uniqDaySum / activeDays) * 10) / 10 : 0,
      activeDays,
      pagesPerSession: div(pageViews, sessions),
      avgSessionMs: durationBy(sess, () => "all").get("all") ?? null,
      timedSessions: sess.filter(s => s.duration_ms != null).length,
      bounceRatePct: pct(bounces, sessions),
      consentRatePct: pct(consented, sessions),
      knownVisitorDays: known,
      reachedApp, appClickRatePct: pct(reachedApp, sessions),
    },
    series,
  };
}

// ─── Traffic sources ──────────────────────────────────────────────────────────

type SrcAcc = { sessions: number; leads: number; bounces: number; pages: number };
const srcInit = (): SrcAcc => ({ sessions: 0, leads: 0, bounces: 0, pages: 0 });
const srcAdd = (a: SrcAcc, x: Row) => {
  const s = num(x.sessions);
  a.sessions += s; a.leads += num(x.leads);
  a.bounces += Math.round((num(x.bounce_rate_pct) * s) / 100);   // pct over all sessions → exact count
  a.pages += num(x.avg_pages) * s;                                // avg(page_count) over all sessions → exact total
};
const srcOut = (a: SrcAcc, avgDurationMs: number | null | undefined) => ({
  sessions: a.sessions, leads: a.leads, conversionPct: pct(a.leads, a.sessions), bounceRatePct: pct(a.bounces, a.sessions),
  avgPages: div(a.pages, a.sessions), avgDurationMs: avgDurationMs ?? null,
});

export async function sources(sb: SupabaseClient, r: Range) {
  const [leads, audience, sess] = await Promise.all([rows(sb, "web_lead_sources", r), rows(sb, "web_audience", r), sessionRows(sb, r)]);
  const label = (v: unknown, fallback: string) => (typeof v === "string" && v.trim() ? v : fallback);
  const durSource = durationBy(sess, srcKey), durChannel = durationBy(sess, chanKey);
  const durCampaign = durationBy(sess.filter(s => s.utm_campaign), s => String(s.utm_campaign));
  const durLanding = durationBy(sess, s => label(s.entry_path, "/"));

  const bySource = [...group(leads, srcKey, srcInit, srcAdd)]
    .map(([k, a]) => { const [source, channel] = k.split("\u0000"); return { source, channel, ...srcOut(a, durSource.get(k)) }; })
    .sort((a, b) => b.sessions - a.sessions);
  const byChannel = [...group(leads, chanKey, srcInit, srcAdd)]
    .map(([channel, a]) => ({ channel, ...srcOut(a, durChannel.get(channel)) })).sort((a, b) => b.sessions - a.sessions);
  const byCampaign = [...group(leads.filter(x => x.utm_campaign), x => String(x.utm_campaign), srcInit, srcAdd)]
    .map(([campaign, a]) => ({ campaign, ...srcOut(a, durCampaign.get(campaign)) })).sort((a, b) => b.sessions - a.sessions);
  const byLanding = [...group(leads, x => label(x.entry_path, "/"), srcInit, srcAdd)]
    .map(([path, a]) => ({ path, ...srcOut(a, durLanding.get(path)) })).sort((a, b) => b.sessions - a.sessions);

  // Audience: sessions only (uniques can't be summed across days).
  const aud = (key: (x: Row) => string) => [...group(audience, key, () => ({ sessions: 0, bounces: 0, pages: 0 }), (a, x) => {
    const s = num(x.sessions); a.sessions += s; a.bounces += Math.round((num(x.bounce_rate_pct) * s) / 100); a.pages += num(x.avg_pages) * s;
  })].map(([name, a]) => ({ name, sessions: a.sessions, bounceRatePct: pct(a.bounces, a.sessions), avgPages: div(a.pages, a.sessions) }))
    .sort((a, b) => b.sessions - a.sessions);

  return {
    range: r, bySource, byChannel, byCampaign, byLanding,
    devices:   aud(x => label(x.device_type, "unknown")),
    countries: aud(x => label(x.country, "Unknown")),
    browsers:  aud(x => label(x.browser, "Unknown")),
  };
}

// ─── Pages ────────────────────────────────────────────────────────────────────

export async function pages(sb: SupabaseClient, r: Range) {
  const [stats, scroll, entryExit, flow, clicks, targets, sess] = await Promise.all([
    rows(sb, "web_page_stats", r), rows(sb, "web_scroll_depth", r), rows(sb, "web_entry_exit", r),
    rows(sb, "web_page_flow", r), rows(sb, "web_click_through", r), rows(sb, "web_click_targets", r), sessionRows(sb, r),
  ]);

  const pageRows = [...group(stats, x => String(x.path), () => ({ views: 0, sessions: 0, timed: 0, timeMs: 0, median: null as number | null, days: 0 }), (a, x) => {
    a.views += num(x.views); a.sessions += num(x.sessions); a.days++;
    const t = num(x.timed_views); a.timed += t; a.timeMs += num(x.avg_time_on_page_ms) * t;
    a.median = x.median_time_on_page_ms == null ? null : num(x.median_time_on_page_ms);
  })].map(([path, a]) => ({
    path, views: a.views, sessions: a.sessions, timedViews: a.timed,
    avgTimeOnPageMs: div(a.timeMs, a.timed),
    medianTimeOnPageMs: r.days === 1 && a.days === 1 ? a.median : null,   // medians don't combine across days
  })).sort((a, b) => b.views - a.views);

  // Scroll funnel per page: reach% = Σ sessions reaching depth ÷ Σ sessions on page.
  const scrollBy = new Map<string, Map<number, { reached: number; base: number }>>();
  for (const x of scroll) {
    const path = String(x.path), lvl = num(x.scroll_pct);
    const m = scrollBy.get(path) ?? new Map(); const a = m.get(lvl) ?? { reached: 0, base: 0 };
    a.reached += num(x.sessions); a.base += num(x.page_sessions); m.set(lvl, a); scrollBy.set(path, m);
  }
  const scrollFunnels = [...scrollBy].map(([path, m]) => ({
    path, pageSessions: Math.max(...[...m.values()].map(v => v.base)),
    levels: [25, 50, 75, 100].map(l => ({ depth: l, sessions: m.get(l)?.reached ?? 0, reachPct: m.get(l) ? pct(m.get(l)!.reached, m.get(l)!.base) : 0 })),
  })).sort((a, b) => b.pageSessions - a.pageSessions);

  const ee = (key: "entry_path" | "exit_path") => {
    const dur = durationBy(sess, s => String(s[key] ?? "/"));
    return [...group(entryExit, x => String(x[key] ?? "/"), () => ({ sessions: 0, bounces: 0, pages: 0 }), (a, x) => {
      const s = num(x.sessions); a.sessions += s; a.bounces += num(x.bounces); a.pages += num(x.avg_pages) * s;
    })].map(([path, a]) => ({ path, sessions: a.sessions, bounceRatePct: pct(a.bounces, a.sessions), avgDurationMs: dur.get(path) ?? null, avgPages: div(a.pages, a.sessions) }))
      .sort((a, b) => b.sessions - a.sessions);
  };

  const flows = [...group(flow, x => `${x.from_path}\u0000${x.to_path}`, () => ({ navigations: 0, sessions: 0 }), (a, x) => { a.navigations += num(x.navigations); a.sessions += num(x.sessions); })]
    .map(([k, a]) => { const [from, to] = k.split("\u0000"); return { from, to, ...a }; }).sort((a, b) => b.navigations - a.navigations).slice(0, 50);

  // CTR = Σ clicks ÷ Σ views of the page the link sits on (never an average of ctr_pct).
  const links = [...group(clicks, x => `${x.from_path}\u0000${x.to_path}\u0000${x.label ?? ""}\u0000${x.from_section ?? ""}`,
    () => ({ clicks: 0, sessions: 0, fromViews: 0, fromSessions: 0 }),
    (a, x) => { a.clicks += num(x.clicks); a.sessions += num(x.clicking_sessions); a.fromViews += num(x.from_page_views); a.fromSessions += num(x.from_page_sessions); })]
    .map(([k, a]) => { const [from, to, label, section] = k.split("\u0000");
      return { from, to, label: label || null, section: section || null, clicks: a.clicks, ctrPct: pct(a.clicks, a.fromViews), sessionCtrPct: pct(a.sessions, a.fromSessions) }; })
    .sort((a, b) => b.clicks - a.clicks).slice(0, 100);

  const kinds = [...group(targets, x => String(x.target_kind ?? "other"), () => ({ clicks: 0 }), (a, x) => { a.clicks += num(x.clicks); })]
    .map(([kind, a]) => ({ kind, clicks: a.clicks })).sort((a, b) => b.clicks - a.clicks);
  const topTargets = [...group(targets, x => `${x.target_kind}\u0000${x.target_href ?? ""}\u0000${x.target_label ?? ""}`, () => ({ clicks: 0, sessions: 0 }), (a, x) => { a.clicks += num(x.clicks); a.sessions += num(x.sessions); })]
    .map(([k, a]) => { const [kind, href, label] = k.split("\u0000"); return { kind, href: href || null, label: label || null, ...a }; })
    .sort((a, b) => b.clicks - a.clicks).slice(0, 50);

  return { range: r, pages: pageRows, scrollFunnels, entries: ee("entry_path"), exits: ee("exit_path"), flows, links, clickKinds: kinds, topTargets };
}

// ─── Sections ─────────────────────────────────────────────────────────────────

export async function sections(sb: SupabaseClient, r: Range) {
  const list = await rows(sb, "web_section_stats", r);
  const by = group(list, x => `${x.path}\u0000${x.section_id}`, () => ({
    path: "", id: "", name: "", index: 0, impressions: 0, sessions: 0, pageViews: 0, dwellMs: 0, engaged: 0, visibleSum: 0, median: null as number | null, days: 0,
  }), (a, x) => {
    const imp = num(x.impressions);
    a.path = String(x.path); a.id = String(x.section_id); a.name = String(x.section_name ?? x.section_id); a.index = num(x.section_index);
    a.impressions += imp; a.sessions += num(x.sessions); a.pageViews += num(x.page_views);
    a.dwellMs += num(x.total_dwell_ms); a.engaged += num(x.engaged_impressions);
    a.visibleSum += num(x.avg_visible_pct) * imp; a.days++;
    a.median = x.median_dwell_ms == null ? null : num(x.median_dwell_ms);
  });
  const all = [...by.values()].map(a => ({
    path: a.path, id: a.id, name: a.name, index: a.index, impressions: a.impressions, sessions: a.sessions, pageViews: a.pageViews,
    // view_rate_pct is defined as impressions / page_views (web_analytics.sql), so rebuild it from those counts
    viewRatePct: pct(a.impressions, a.pageViews), avgDwellMs: div(a.dwellMs, a.impressions),
    medianDwellMs: r.days === 1 && a.days === 1 ? a.median : null,
    engagementRatePct: pct(a.engaged, a.impressions), avgVisiblePct: div(a.visibleSum, a.impressions),
  }));
  const pagesWithSections = [...group(all as unknown as Row[], x => String(x.path), () => ({ impressions: 0, sections: 0 }), (a, x) => { a.impressions += num(x.impressions); a.sections++; })]
    .map(([path, a]) => ({ path, ...a })).sort((a, b) => b.impressions - a.impressions);
  return {
    range: r, pages: pagesWithSections,
    sections: all.sort((a, b) => a.path.localeCompare(b.path) || a.index - b.index),
  };
}

// ─── Visitors ─────────────────────────────────────────────────────────────────

export async function visitors(sb: SupabaseClient, r: Range) {
  const { data, error } = await sb.from("web_visitor_profile").select("*")
    .gte("last_seen_at", `${r.from}T00:00:00Z`).order("last_seen_at", { ascending: false }).limit(300);
  if (error) throw new Error(`web_visitor_profile: ${error.message}`);
  return {
    range: r,
    visitors: (data ?? []).map(v => ({
      key: v.visitor_key as string, persistent: !!v.ever_consented,
      sessions: num(v.sessions), firstSeenAt: v.first_seen_at, lastSeenAt: v.last_seen_at,
      pageViews: num(v.total_page_views), totalTimeMs: num(v.total_time_ms), bouncedSessions: num(v.bounced_sessions),
      firstEntryPath: v.first_entry_path, firstChannel: v.first_channel, firstSource: v.first_source,
      lastChannel: v.last_channel, lastSource: v.last_source, firstCampaign: v.first_campaign,
      country: v.country, device: v.device_type, browser: v.browser, os: v.os,
      topPaths: (v.top_paths as string[] | null) ?? [], topSections: (v.top_sections as string[] | null) ?? [], reachedApp: !!v.reached_app,
    })),
  };
}

/** One visitor: their sessions and what they read. Keyed by visitor_key + whether it's a persistent (consented) id. */
export async function visitor(sb: SupabaseClient, key: string, persistent: boolean) {
  const uuid = /^[0-9a-f-]{36}$/i.test(key);
  let sq = sb.from("web_sessions").select("session_id,started_at,last_seen_at,ended_at,duration_ms,entry_path,exit_path,page_count,event_count,is_bounce,source_name,channel,utm_campaign,device_type,browser,os,country,region,timezone,consent")
    .order("started_at", { ascending: false }).limit(100);
  sq = persistent && uuid ? sq.eq("visitor_id", key) : sq.eq("anon_id", key);
  const [s, sec] = await Promise.all([
    sq,
    sb.from("web_visitor_sections").select("path,section_id,section_name,times_seen,total_dwell_ms,avg_dwell_ms,max_visible_pct,first_seen_at,last_seen_at")
      .eq("visitor_key", key).order("total_dwell_ms", { ascending: false }).limit(100),
  ]);
  if (s.error) throw new Error(`web_sessions: ${s.error.message}`);
  return { sessions: s.data ?? [], sections: sec.data ?? [] };
}

/** One visit replayed in order. */
export async function journey(sb: SupabaseClient, sessionId: string) {
  const { data, error } = await sb.from("web_session_journey")
    .select("step,occurred_at,type,path,page_title,section_id,section_name,dwell_ms,max_visible_pct,target_kind,target_path,target_label,target_section,scroll_pct,time_on_page_ms,metadata,country,device_type,browser,channel,source_name,utm_campaign")
    .eq("session_id", sessionId).order("step", { ascending: true }).limit(2000);
  if (error) throw new Error(`web_session_journey: ${error.message}`);
  return { steps: data ?? [] };
}
