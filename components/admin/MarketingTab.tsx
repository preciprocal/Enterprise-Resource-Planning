// components/admin/MarketingTab.tsx
// Marketing-site analytics (preciprocal.com): Overview, Traffic sources, Pages,
// Sections, Visitors. Data: /api/marketing → lib/web-analytics.ts, which
// enforces the aggregation rules (no summed uniques, no averaged averages).
// Labels here follow the same rules: "clicked through to app" is never called
// a signup, multi-day uniques are "avg daily", anon visitor rows are 1-day.
"use client";
import { ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import { Select, LineChart, BarChart, daysAgo } from "./admin-shared";
import { Block, Empty, Stat, Table, Muted, dash, human, Primary } from "./ui-kit";

// ─── Data ─────────────────────────────────────────────────────────────────────

type Section = "overview" | "sources" | "pages" | "sections" | "visitors";
const cache = new Map<string, { at: number; data: unknown }>();

function useMarketing<T>(query: string, token: string) {
  const [data, setData] = useState<T | null>(() => (cache.get(query)?.data as T) ?? null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(!cache.has(query));
  const load = useCallback(async (force = false) => {
    const hit = cache.get(query);
    if (!force && hit && Date.now() - hit.at < 60_000) { setData(hit.data as T); setLoading(false); return; }
    setLoading(true); setError("");
    try {
      const res  = await fetch(`/api/marketing?${query}`, { headers: { "x-admin-token": token }, cache: "no-store" });
      const json = await res.json() as T & { error?: string };
      if (!res.ok || json.error) throw new Error(json.error ?? `HTTP ${res.status}`);
      cache.set(query, { at: Date.now(), data: json }); setData(json);
    } catch (e) { setError((e as Error).message); }
    setLoading(false);
  }, [query, token]);
  useEffect(() => { void load(); }, [load]);
  return { data, error, loading, reload: () => load(true) };
}

// ─── Formatting ───────────────────────────────────────────────────────────────

const n = (v?: number | null) => (v == null ? "—" : v.toLocaleString());
const pctS = (v?: number | null) => (v == null ? "—" : `${v}%`);
function dur(ms?: number | null) {
  if (ms == null) return "—";
  const s = ms / 1000;
  if (s < 1) return `${Math.round(ms)} ms`;
  if (s < 60) return `${s < 10 ? s.toFixed(1) : Math.round(s)}s`;
  const m = Math.floor(s / 60), r = Math.round(s % 60);
  return r ? `${m}m ${r}s` : `${m}m`;
}
// The section is labelled "times in UTC", so dates are formatted in UTC, not the browser zone.
const fmt = (iso?: string | null) => iso ? new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" }) : "";
const fmtFull = (iso?: string | null) => iso ? new Date(iso).toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "UTC" }) : "";
const shortDay = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

// Definitions surfaced as hover hints (title attribute — keyboard focusable).
const DEF = {
  bounce:  "A bounce is a session that saw one page, clicked nothing, and never read a section for 3 seconds or more. Someone who lands, reads one section properly and leaves is not a bounce.",
  uniques: "Visitors who decline cookies get an id that changes every day, so unique visitors can't be added across days. Over multiple days this shows the average per day with traffic.",
  app:     "Sessions that clicked through to app.preciprocal.com — the furthest the marketing site can see. This is not signups.",
  timed:   "Time on page is only known when we saw the visitor leave. The number in brackets is how many views that average is based on.",
  sessionTime: "Average over sessions with a recorded duration (sessions that ended while we were watching).",
  viewRate: "Share of page views that scrolled this section into view — how far down the page people actually get.",
  engagement: "Share of times the section was seen for 3 seconds or more.",
  consent: "Share of sessions that accepted analytics cookies (and so have a stable, cross-day visitor id).",
};

function Hint({ text }: { text: string }) {
  return (
    <span title={text} tabIndex={0} aria-label={text}
      className="inline-flex items-center justify-center w-3.5 h-3.5 rounded-full border border-[#333] text-[9px] font-semibold text-[#666] cursor-help align-middle ml-1 select-none">i</span>
  );
}
const H = ({ children, hint }: { children: ReactNode; hint: string }) => <>{children}<Hint text={hint} /></>;

function Note({ children }: { children: ReactNode }) {
  return <p className="text-[12px] text-[#555] leading-relaxed">{children}</p>;
}

function State({ loading, error, reload, empty, children }: { loading: boolean; error: string; reload: () => void; empty?: boolean; children: ReactNode }) {
  if (error) return (
    <div className="flex items-center justify-between gap-3 px-4 py-3 rounded-xl border border-[rgba(255,68,68,0.2)] bg-[rgba(255,68,68,0.05)]">
      <span className="text-[13px] text-[#f55]">Couldn&apos;t load analytics: {error}</span>
      <button onClick={reload} className="text-[12px] font-medium text-[#f55] border border-[rgba(255,68,68,0.3)] bg-transparent rounded-md px-2.5 py-1 cursor-pointer">Retry</button>
    </div>
  );
  if (loading) return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">{Array.from({ length: 4 }).map((_, i) => <div key={i} className="skeleton h-20 rounded-xl" />)}</div>
      <div className="skeleton h-56 rounded-xl" />
    </div>
  );
  if (empty) return (
    <div className="flex flex-col items-center justify-center gap-2 py-20 text-center">
      <div className="text-[14px] text-[#888]">No visits in this range</div>
      <div className="text-[12px] text-[#555] max-w-sm">The marketing site only started recording recently. Try a longer range, or check back once traffic comes in.</div>
    </div>
  );
  return <>{children}</>;
}

/** Horizontal bar list — used for breakdowns, scroll funnels and sections. */
function Bars({ items, max, color = "#ededed" }: { items: { label: ReactNode; value: number; right?: ReactNode; sub?: ReactNode; highlight?: boolean }[]; max?: number; color?: string }) {
  const top = max ?? Math.max(1, ...items.map(i => i.value));
  return (
    <ul className="px-4 py-3 flex flex-col gap-3">
      {items.map((it, i) => (
        <li key={i} className="flex flex-col gap-1">
          <div className="flex items-baseline justify-between gap-3 text-[12px]">
            <span className={`truncate ${it.highlight ? "text-[#3ecf8e]" : "text-[#bbb]"}`}>{it.label}</span>
            <span className="shrink-0 text-[#888] tabular-nums">{it.right ?? it.value}</span>
          </div>
          <span className="h-1.5 rounded-full bg-[#141414] overflow-hidden">
            <span className="block h-full rounded-full" style={{ width: `${Math.max(it.value > 0 ? 2 : 0, Math.round((it.value / top) * 100))}%`, background: it.highlight ? "#3ecf8e" : color, opacity: it.highlight ? 1 : 0.7 }} />
          </span>
          {it.sub && <span className="text-[11px] text-[#555]">{it.sub}</span>}
        </li>
      ))}
    </ul>
  );
}

/** Table with clickable column sorting (Traffic sources). */
type SortCol<T> = { label: ReactNode; key: string; get: (r: T) => number | string | null; cell?: (r: T) => ReactNode; hide?: "sm" | "md" | "lg"; align?: "right" };
const HIDE = { sm: "hidden sm:table-cell", md: "hidden md:table-cell", lg: "hidden lg:table-cell" } as const;
function SortTable<T>({ rows, cols, initial, rowKey, empty }: { rows: T[]; cols: SortCol<T>[]; initial: string; rowKey: (r: T) => string; empty: string }) {
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 }>({ key: initial, dir: -1 });
  const sorted = useMemo(() => {
    const c = cols.find(x => x.key === sort.key) ?? cols[0];
    return [...rows].sort((a, b) => {
      const av = c.get(a), bv = c.get(b);
      if (av == null && bv == null) return 0; if (av == null) return 1; if (bv == null) return -1;
      return (av < bv ? -1 : av > bv ? 1 : 0) * sort.dir;
    });
  }, [rows, cols, sort]);
  if (!rows.length) return <Empty>{empty}</Empty>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-left">
        <thead><tr className="border-b border-[#141414]">
          {cols.map(c => (
            <th key={c.key} className={`px-4 py-2 text-[11px] font-semibold uppercase tracking-wider text-[#444] whitespace-nowrap ${c.align === "right" ? "text-right" : ""} ${c.hide ? HIDE[c.hide] : ""}`}
              aria-sort={sort.key === c.key ? (sort.dir === 1 ? "ascending" : "descending") : undefined}>
              <button onClick={() => setSort(s => ({ key: c.key, dir: s.key === c.key ? (s.dir === 1 ? -1 : 1) : -1 }))}
                className={`bg-transparent border-none p-0 cursor-pointer uppercase tracking-wider font-semibold text-[11px] inline-flex items-center gap-1 ${sort.key === c.key ? "text-[#999]" : "text-[#444] hover:text-[#777]"}`}>
                {c.label}{sort.key === c.key && <span aria-hidden>{sort.dir === 1 ? "↑" : "↓"}</span>}
              </button>
            </th>
          ))}
        </tr></thead>
        <tbody>
          {sorted.map(r => (
            <tr key={rowKey(r)} className="border-b border-[#0f0f0f] last:border-0 hover:bg-[#0d0d0d] transition-colors">
              {cols.map((c, i) => (
                <td key={c.key} className={`px-4 py-2.5 text-[13px] align-top ${i === 0 ? "text-[#ddd]" : "text-[#999] whitespace-nowrap tabular-nums"} ${c.align === "right" ? "text-right" : ""} ${c.hide ? HIDE[c.hide] : ""}`}>
                  {c.cell ? c.cell(r) : (c.get(r) ?? "—")}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Types (mirror lib/web-analytics.ts) ──────────────────────────────────────

interface Range { from: string; to: string; days: number }
interface OverviewData { range: Range; totals: {
  sessions: number; pageViews: number; uniqueVisitors: number | null; avgDailyUniques: number; activeDays: number;
  pagesPerSession: number | null; avgSessionMs: number | null; timedSessions: number; bounceRatePct: number | null;
  consentRatePct: number | null; reachedApp: number; appClickRatePct: number | null; };
  series: { day: string; sessions: number; uniques: number; pageViews: number }[] }
interface SrcRow { sessions: number; leads: number; conversionPct: number | null; bounceRatePct: number | null; avgPages: number | null; avgDurationMs: number | null }
interface AudRow { name: string; sessions: number; bounceRatePct: number | null; avgPages: number | null }
interface SourcesData { range: Range; bySource: (SrcRow & { source: string; channel: string })[]; byChannel: (SrcRow & { channel: string })[];
  byCampaign: (SrcRow & { campaign: string })[]; byLanding: (SrcRow & { path: string })[]; devices: AudRow[]; countries: AudRow[]; browsers: AudRow[] }
interface PagesData { range: Range;
  pages: { path: string; views: number; sessions: number; timedViews: number; avgTimeOnPageMs: number | null; medianTimeOnPageMs: number | null }[];
  scrollFunnels: { path: string; pageSessions: number; levels: { depth: number; sessions: number; reachPct: number | null }[] }[];
  entries: { path: string; sessions: number; bounceRatePct: number | null; avgDurationMs: number | null; avgPages: number | null }[];
  exits: { path: string; sessions: number; bounceRatePct: number | null; avgDurationMs: number | null; avgPages: number | null }[];
  flows: { from: string; to: string; navigations: number; sessions: number }[];
  links: { from: string; to: string; label: string | null; section: string | null; clicks: number; ctrPct: number | null; sessionCtrPct: number | null }[];
  clickKinds: { kind: string; clicks: number }[];
  topTargets: { kind: string; href: string | null; label: string | null; clicks: number; sessions: number }[] }
interface SectionRow { path: string; id: string; name: string; index: number; impressions: number; sessions: number; pageViews: number;
  viewRatePct: number | null; avgDwellMs: number | null; medianDwellMs: number | null; engagementRatePct: number | null; avgVisiblePct: number | null }
interface SectionsData { range: Range; pages: { path: string; impressions: number; sections: number }[]; sections: SectionRow[] }
interface Visitor { key: string; persistent: boolean; sessions: number; firstSeenAt: string; lastSeenAt: string; pageViews: number; totalTimeMs: number;
  bouncedSessions: number; firstEntryPath: string | null; firstChannel: string | null; firstSource: string | null; lastChannel: string | null; lastSource: string | null;
  firstCampaign: string | null; country: string | null; device: string | null; browser: string | null; os: string | null; topPaths: string[]; topSections: string[]; reachedApp: boolean }

// ─── Shell ────────────────────────────────────────────────────────────────────

const SECTIONS: { id: Section; label: string }[] = [
  { id: "overview", label: "Overview" }, { id: "sources", label: "Traffic sources" }, { id: "pages", label: "Pages" },
  { id: "sections", label: "Sections" }, { id: "visitors", label: "Visitors" },
];
const RANGES = [{ v: "1", l: "Today" }, { v: "7", l: "Last 7 days" }, { v: "30", l: "Last 30 days" }, { v: "90", l: "Last 90 days" }, { v: "365", l: "Last 12 months" }];

export default function MarketingTab({ token }: { token: string }) {
  const [view, setView] = useState<Section>("overview");
  const [days, setDays] = useState("30");
  return (
    <div className="flex-1 flex flex-col min-h-0 min-w-0 bg-black">
      <div className="px-4 md:px-8 pt-6 pb-4 border-b border-[#111] shrink-0">
        <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-3">
          <div>
            <h1 className="text-[20px] font-semibold text-[#ededed] tracking-tight">Marketing site</h1>
            <p className="text-[13px] text-[#666] mt-1">First-party analytics for preciprocal.com · times in UTC</p>
          </div>
          <Select value={days} onChange={e => setDays(e.target.value)} leading="Range" wrapperClassName="w-auto" className="h-8 text-[12px]" aria-label="Date range">
            {RANGES.map(r => <option key={r.v} value={r.v}>{r.l}</option>)}
          </Select>
        </div>
        <nav className="mt-4 flex gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" aria-label="Marketing sections">
          {SECTIONS.map(s => (
            <button key={s.id} onClick={() => setView(s.id)} aria-current={view === s.id ? "page" : undefined}
              className={`shrink-0 h-8 px-3 rounded-md text-[13px] font-medium border-none cursor-pointer transition-colors ${view === s.id ? "bg-[#111] text-[#ededed]" : "bg-transparent text-[#555] hover:text-[#999]"}`}>
              {s.label}
            </button>
          ))}
        </nav>
      </div>
      <div className="flex-1 min-h-0 overflow-auto">
        <div className="px-4 md:px-8 py-6 flex flex-col gap-7">
          {view === "overview" && <OverviewView token={token} days={days} />}
          {view === "sources"  && <SourcesView  token={token} days={days} />}
          {view === "pages"    && <PagesView    token={token} days={days} />}
          {view === "sections" && <SectionsView token={token} days={days} />}
          {view === "visitors" && <VisitorsView token={token} days={days} />}
        </div>
      </div>
    </div>
  );
}

// ─── Overview ─────────────────────────────────────────────────────────────────

function OverviewView({ token, days }: { token: string; days: string }) {
  const q = useMarketing<OverviewData>(`section=overview&days=${days}`, token);
  const t = q.data?.totals;
  const single = q.data?.range.days === 1;
  return (
    <State loading={q.loading && !q.data} error={q.error} reload={q.reload} empty={!!q.data && t!.sessions === 0}>
      {q.data && t && (<>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <Stat label="Sessions" value={n(t.sessions)} sub={`${t.activeDays} day${t.activeDays === 1 ? "" : "s"} with traffic`} />
          {single
            ? <Stat label="Unique visitors" value={n(t.uniqueVisitors)} sub="today" />
            : <Stat label="Avg daily uniques" value={t.avgDailyUniques} sub={<H hint={DEF.uniques}>not summed across days</H>} />}
          <Stat label="Page views" value={n(t.pageViews)} sub={t.pagesPerSession != null ? `${t.pagesPerSession.toFixed(2)} per session` : undefined} />
          <Stat label="Bounce rate" value={pctS(t.bounceRatePct)} sub={<H hint={DEF.bounce}>custom definition</H>} />
          <Stat label="Clicked through to app" value={n(t.reachedApp)} sub={<H hint={DEF.app}>{pctS(t.appClickRatePct)} of sessions</H>} tone={t.reachedApp ? "#3ecf8e" : undefined} />
          <Stat label="Avg session" value={dur(t.avgSessionMs)} sub={<H hint={DEF.sessionTime}>from {t.timedSessions} timed session{t.timedSessions === 1 ? "" : "s"}</H>} />
          <Stat label="Consent rate" value={pctS(t.consentRatePct)} sub={<H hint={DEF.consent}>accepted cookies</H>} />
          <Stat label="Range" value={single ? "Today" : `${q.data.range.days} days`} sub={`${shortDay(q.data.range.from)} – ${shortDay(q.data.range.to)}`} />
        </div>

        <Block title="Sessions over time" count={single ? undefined : "daily"}>
          {q.data.series.length > 1 ? (
            <div className="px-2 pt-2">
              <LineChart data={[q.data.series.map(s => s.sessions), q.data.series.map(s => s.pageViews)]}
                labels={q.data.series.map(s => shortDay(s.day))} h={200} area smooth={false} />
              <div className="flex gap-4 px-3 pb-3 text-[11px] text-[#666]">
                <span className="inline-flex items-center gap-1.5"><span className="w-2.5 h-0.5 bg-[#0070f3] rounded" />Sessions</span>
                <span className="inline-flex items-center gap-1.5"><span className="w-2.5 h-0.5 bg-[#3ecf8e] rounded" />Page views</span>
              </div>
            </div>
          ) : (
            <div className="px-4 py-5 flex items-baseline gap-6">
              <div><div className="text-[24px] font-semibold text-[#ededed] tabular-nums">{n(t.sessions)}</div><div className="text-[12px] text-[#555]">sessions today</div></div>
              <div><div className="text-[24px] font-semibold text-[#ededed] tabular-nums">{n(t.pageViews)}</div><div className="text-[12px] text-[#555]">page views today</div></div>
              <Note>Pick a longer range to see a trend.</Note>
            </div>
          )}
        </Block>
      </>)}
    </State>
  );
}

// ─── Traffic sources ──────────────────────────────────────────────────────────

function SourcesView({ token, days }: { token: string; days: string }) {
  const q = useMarketing<SourcesData>(`section=sources&days=${days}`, token);
  const d = q.data;
  const total = d?.bySource.reduce((a, s) => a + s.sessions, 0) ?? 0;
  const srcCols: SortCol<SourcesData["bySource"][number]>[] = [
    { key: "source", label: "Source", get: r => r.source, cell: r => <Primary sub={human(r.channel) ?? undefined}>{r.source}</Primary> },
    { key: "sessions", label: "Sessions", get: r => r.sessions, cell: r => <>{n(r.sessions)} <Muted>· {total ? Math.round((100 * r.sessions) / total) : 0}%</Muted></> },
    { key: "leads", label: <>Clicked through to app<Hint text={DEF.app} /></>, get: r => r.leads, cell: r => <span className={r.leads ? "text-[#3ecf8e]" : ""}>{n(r.leads)}</span> },
    { key: "conv", label: "Conversion", get: r => r.conversionPct, cell: r => pctS(r.conversionPct) },
    { key: "bounce", label: <>Bounce<Hint text={DEF.bounce} /></>, get: r => r.bounceRatePct, cell: r => pctS(r.bounceRatePct), hide: "sm" },
    { key: "pages", label: "Pages / session", get: r => r.avgPages, cell: r => r.avgPages != null ? r.avgPages.toFixed(2) : "—", hide: "md" },
    { key: "dur", label: "Avg session", get: r => r.avgDurationMs, cell: r => dur(r.avgDurationMs), hide: "lg" },
  ];
  return (
    <State loading={q.loading && !d} error={q.error} reload={q.reload} empty={!!d && total === 0}>
      {d && (<>
        <Note>
          Where should we spend effort? Sessions show reach; <b className="text-[#999] font-medium">clicked through to app</b>{" "}is the strongest outcome the marketing site can see.
          Signups aren&apos;t attributed to sources yet — the app doesn&apos;t store the <code className="font-mono text-[#777]">pr_sid</code> / <code className="font-mono text-[#777]">pr_vid</code> link ids on new accounts — so nothing here can be tied to a named customer.
        </Note>

        <Block title="Sources" count={d.bySource.length}>
          <SortTable rows={d.bySource} cols={srcCols} initial="sessions" rowKey={r => `${r.source}|${r.channel}`} empty="No traffic in this range" />
        </Block>

        <div className="grid grid-cols-1 xl:grid-cols-2 gap-7">
          <Block title="Sessions by source">
            {d.bySource.length ? <div className="px-2 pt-2"><BarChart data={d.bySource.slice(0, 10).map(s => ({ l: s.source, v: s.sessions }))} h={180} /></div> : <Empty>No traffic</Empty>}
          </Block>
          <Block title="By channel">
            <Bars items={d.byChannel.map(c => ({ label: human(c.channel), value: c.sessions, right: <>{n(c.sessions)} <Muted>· {n(c.leads)} to app</Muted></> }))} />
          </Block>
        </div>

        {d.byCampaign.length > 0 && (
          <Block title="Campaigns" count={d.byCampaign.length}>
            <Table rows={d.byCampaign} rowKey={r => r.campaign} empty="" cols={[
              { label: "Campaign", cell: r => <Primary>{r.campaign}</Primary> },
              { label: "Sessions", cell: r => n(r.sessions) },
              { label: "To app", cell: r => n(r.leads) },
              { label: "Conversion", cell: r => pctS(r.conversionPct) },
              { label: "Bounce", hide: "sm", cell: r => pctS(r.bounceRatePct) },
            ]} />
          </Block>
        )}

        <Block title="Landing pages" count={d.byLanding.length}>
          <Table rows={d.byLanding} rowKey={r => r.path} empty="No landing pages" cols={[
            { label: "Page", cell: r => <Primary><code className="font-mono text-[12px]">{r.path}</code></Primary> },
            { label: "Sessions", cell: r => n(r.sessions) },
            { label: "To app", cell: r => n(r.leads) },
            { label: "Bounce", hide: "sm", cell: r => pctS(r.bounceRatePct) },
            { label: "Avg session", hide: "md", cell: r => dur(r.avgDurationMs) },
          ]} />
        </Block>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-7">
          {([["Devices", d.devices], ["Countries", d.countries], ["Browsers", d.browsers]] as [string, AudRow[]][]).map(([title, list]) => (
            <Block key={title} title={title}>
              {list.length ? <Bars items={list.slice(0, 8).map(a => ({ label: human(a.name), value: a.sessions, right: n(a.sessions) }))} /> : <Empty>No data</Empty>}
            </Block>
          ))}
        </div>
      </>)}
    </State>
  );
}

// ─── Pages ────────────────────────────────────────────────────────────────────

function PagesView({ token, days }: { token: string; days: string }) {
  const q = useMarketing<PagesData>(`section=pages&days=${days}`, token);
  const d = q.data;
  const [scrollPath, setScrollPath] = useState("");
  const funnel = d?.scrollFunnels.find(f => f.path === scrollPath) ?? d?.scrollFunnels[0];
  const single = d?.range.days === 1;
  return (
    <State loading={q.loading && !d} error={q.error} reload={q.reload} empty={!!d && d.pages.length === 0}>
      {d && (<>
        <Block title="Pages" count={d.pages.length}>
          <Table rows={d.pages} rowKey={r => r.path} limit={15} empty="No page views" cols={[
            { label: "Page", cell: r => <Primary><code className="font-mono text-[12px]">{r.path}</code></Primary> },
            { label: "Views", cell: r => n(r.views) },
            { label: "Sessions", hide: "sm", cell: r => n(r.sessions) },
            { label: "Avg time on page", cell: r => {
                const thin = r.timedViews < 5 || r.timedViews < r.views / 2;
                return r.avgTimeOnPageMs == null ? <Muted>no timed views</Muted> : (
                  <span title={thin ? `Based on only ${r.timedViews} of ${r.views} views — treat as indicative` : undefined}>
                    {dur(r.avgTimeOnPageMs)} <Muted>({r.timedViews} timed)</Muted>{thin && <span className="text-[#f5a623] ml-1" aria-label="thin sample">·thin</span>}
                  </span>);
              } },
            { label: "Median", hide: "md", cell: r => r.medianTimeOnPageMs != null ? dur(r.medianTimeOnPageMs) : <span title="Medians can't be combined across days — pick “Today”.">{dash}</span> },
          ]} />
        </Block>
        <Note><H hint={DEF.timed}>Time on page</H> is only measured when we see the visitor leave, so each average shows how many views it&apos;s based on. Medians are shown for single-day ranges only{single ? "" : " (choose Today)"}.</Note>

        <div className="grid grid-cols-1 xl:grid-cols-2 gap-7">
          <Block title="Scroll depth" action={d.scrollFunnels.length > 1 ? (
            <Select value={funnel?.path ?? ""} onChange={e => setScrollPath(e.target.value)} wrapperClassName="w-auto max-w-[60%]" className="h-7 text-[12px]" aria-label="Page">
              {d.scrollFunnels.map(f => <option key={f.path} value={f.path}>{f.path}</option>)}
            </Select>) : undefined}>
            {funnel ? (<>
              <Bars max={100} items={funnel.levels.map(l => ({ label: `Reached ${l.depth}%`, value: l.reachPct ?? 0, right: <>{pctS(l.reachPct)} <Muted>· {n(l.sessions)}</Muted></> }))} />
              <div className="px-4 pb-3 -mt-1"><Note><code className="font-mono">{funnel.path}</code> · {n(funnel.pageSessions)} session{funnel.pageSessions === 1 ? "" : "s"}</Note></div>
            </>) : <Empty>No scroll data yet</Empty>}
          </Block>
          <Block title="What people click">
            {d.clickKinds.length ? <Bars items={d.clickKinds.map(k => ({ label: k.kind === "app" ? "Through to app (conversion)" : human(k.kind), value: k.clicks, highlight: k.kind === "app" }))} />
              : <Empty>No clicks recorded yet</Empty>}
          </Block>
        </div>

        <div className="grid grid-cols-1 2xl:grid-cols-2 gap-7">
          <Block title="Entry pages" count={d.entries.length}>
            <Table rows={d.entries} rowKey={r => r.path} empty="No sessions" cols={[
              { label: "Page", cell: r => <Primary><code className="font-mono text-[12px]">{r.path}</code></Primary> },
              { label: "Sessions", cell: r => n(r.sessions) },
              { label: "Bounce", cell: r => pctS(r.bounceRatePct) },
              { label: "Avg session", hide: "sm", cell: r => dur(r.avgDurationMs) },
            ]} />
          </Block>
          <Block title="Exit pages" count={d.exits.length}>
            <Table rows={d.exits} rowKey={r => r.path} empty="No sessions" cols={[
              { label: "Page", cell: r => <Primary><code className="font-mono text-[12px]">{r.path}</code></Primary> },
              { label: "Sessions", cell: r => n(r.sessions) },
              { label: "Pages / session", hide: "sm", cell: r => r.avgPages != null ? r.avgPages.toFixed(2) : "—" },
            ]} />
          </Block>
        </div>

        <Block title="Links clicked" count={d.links.length}>
          <Table rows={d.links} rowKey={(r, i) => `${r.from}|${r.to}|${r.label}|${i}`} empty="No internal link clicks yet" cols={[
            { label: "Link", cell: r => <Primary sub={<>on <code className="font-mono">{r.from}</code>{r.section ? ` · ${r.section}` : ""}</>}>{r.label || r.to}</Primary> },
            { label: "Goes to", hide: "md", cell: r => <code className="font-mono text-[12px]">{r.to}</code> },
            { label: "Clicks", cell: r => n(r.clicks) },
            { label: "CTR", cell: r => <span title="Clicks ÷ views of the page the link is on">{pctS(r.ctrPct)}</span> },
          ]} />
        </Block>

        <Block title="Page to page" count={d.flows.length}>
          <Table rows={d.flows} rowKey={(r, i) => `${r.from}|${r.to}|${i}`} empty="No page-to-page navigation yet" cols={[
            { label: "From", cell: r => <Primary><code className="font-mono text-[12px]">{r.from}</code></Primary> },
            { label: "To", cell: r => <code className="font-mono text-[12px]">{r.to}</code> },
            { label: "Navigations", cell: r => n(r.navigations) },
          ]} />
        </Block>
      </>)}
    </State>
  );
}

// ─── Sections ─────────────────────────────────────────────────────────────────

function SectionsView({ token, days }: { token: string; days: string }) {
  const q = useMarketing<SectionsData>(`section=sections&days=${days}`, token);
  const d = q.data;
  const [path, setPath] = useState("");
  const current = path || d?.pages[0]?.path || "";
  const list = (d?.sections ?? []).filter(s => s.path === current).sort((a, b) => a.index - b.index);
  // Where attention dies: the biggest drop in view rate between consecutive sections.
  let drop: { at: number; by: number } | null = null;
  for (let i = 1; i < list.length; i++) {
    const by = (list[i - 1].viewRatePct ?? 0) - (list[i].viewRatePct ?? 0);
    if (by > 0 && (!drop || by > drop.by)) drop = { at: i, by };
  }
  return (
    <State loading={q.loading && !d} error={q.error} reload={q.reload} empty={!!d && d.pages.length === 0}>
      {d && (<>
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
          <Note>Each page&apos;s sections, top to bottom. <H hint={DEF.viewRate}>Reached</H> shows how far down people get; <H hint={DEF.engagement}>engaged</H> shows whether they actually read it.</Note>
          <Select value={current} onChange={e => setPath(e.target.value)} leading="Page" wrapperClassName="w-auto max-w-full" className="h-8 text-[12px]" aria-label="Page">
            {d.pages.map(p => <option key={p.path} value={p.path}>{p.path} ({p.sections})</option>)}
          </Select>
        </div>
        <Block title={current} count={`${list.length} section${list.length === 1 ? "" : "s"}${list[0] ? ` · ${n(list[0].pageViews)} page view${list[0].pageViews === 1 ? "" : "s"}` : ""}`}>
          {list.length ? (
            <ol className="divide-y divide-[#0f0f0f]">
              {list.map((s, i) => (
                <li key={s.id} className="px-4 py-3">
                  {drop?.at === i && (
                    <div className="mb-2 text-[11px] font-medium text-[#f5a623]">▼ Biggest drop-off: {Math.round(drop.by)} points fewer reach this section</div>
                  )}
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="text-[13px] text-[#ddd] truncate"><span className="text-[#444] tabular-nums mr-2">{s.index + 1}</span>{s.name}</span>
                    <span className="shrink-0 text-[12px] text-[#888] tabular-nums">
                      {pctS(s.viewRatePct)} reached · {dur(s.avgDwellMs)} avg{s.medianDwellMs != null ? ` (median ${dur(s.medianDwellMs)})` : ""} · {pctS(s.engagementRatePct)} engaged
                    </span>
                  </div>
                  <span className="mt-2 block h-2 rounded-full bg-[#141414] overflow-hidden">
                    <span className="block h-full rounded-full bg-[#ededed]" style={{ width: `${Math.min(100, s.viewRatePct ?? 0)}%`, opacity: 0.25 + 0.75 * Math.min(1, (s.engagementRatePct ?? 0) / 100) }} />
                  </span>
                  <div className="mt-1 text-[11px] text-[#555]">{n(s.impressions)} impression{s.impressions === 1 ? "" : "s"} · {n(s.sessions)} session{s.sessions === 1 ? "" : "s"}{s.avgVisiblePct != null ? ` · ${Math.round(s.avgVisiblePct)}% visible on average` : ""}</div>
                </li>
              ))}
            </ol>
          ) : <Empty>No section data for this page</Empty>}
        </Block>
        <Note>Bar length = share of page views that reached the section. Bar brightness = engagement (read for 3s+).</Note>
      </>)}
    </State>
  );
}

// ─── Visitors ─────────────────────────────────────────────────────────────────

function visitorLabel(v: Visitor) { return `Visitor ${v.key.slice(0, 6)}`; }

function VisitorsView({ token, days }: { token: string; days: string }) {
  const q = useMarketing<{ range: Range; visitors: Visitor[] }>(`section=visitors&days=${days}`, token);
  const [sel, setSel] = useState<Visitor | null>(null);
  const list = q.data?.visitors ?? [];
  return (
    <State loading={q.loading && !q.data} error={q.error} reload={q.reload} empty={!!q.data && list.length === 0}>
      <div className="flex flex-col xl:flex-row gap-7 min-w-0">
        <div className={`${sel ? "hidden xl:block" : ""} xl:w-[46%] min-w-0`}>
          <Block title="Visitors" count={list.length}>
            <ul className="divide-y divide-[#0f0f0f] max-h-[70vh] overflow-y-auto">
              {list.map(v => (
                <li key={v.key}>
                  <button onClick={() => setSel(v)} className={`w-full text-left px-4 py-3 border-none cursor-pointer transition-colors ${sel?.key === v.key ? "bg-[#111]" : "bg-transparent hover:bg-[#0d0d0d]"}`}>
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-[13px] text-[#ddd] truncate">
                        {visitorLabel(v)}
                        <span className={`ml-2 text-[11px] ${v.persistent ? "text-[#0070f3]" : "text-[#666]"}`} title={v.persistent ? "Accepted cookies — stable id across days" : "Declined cookies — id resets daily, so this is one day of history"}>
                          {v.persistent ? "Returning id" : "1-day profile"}
                        </span>
                        {v.reachedApp && <span className="ml-2 text-[11px] text-[#3ecf8e]">→ app</span>}
                      </span>
                      <span className="text-[12px] text-[#555] shrink-0">{daysAgo(v.lastSeenAt)}</span>
                    </div>
                    <div className="mt-0.5 text-[12px] text-[#555] truncate">
                      {[v.country, human(v.device), v.browser, v.firstSource ?? human(v.firstChannel),
                        `${v.sessions} session${v.sessions === 1 ? "" : "s"}`, `${v.pageViews} page${v.pageViews === 1 ? "" : "s"}`,
                        v.totalTimeMs ? dur(v.totalTimeMs) : null].filter(Boolean).join(" · ")}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          </Block>
          <div className="mt-3"><Note>Anonymous: no names, emails or IPs are stored. Visitors who declined cookies appear as a 1-day profile because their id resets daily.</Note></div>
        </div>
        <div className={`${sel ? "" : "hidden xl:block"} flex-1 min-w-0`}>
          {sel ? <VisitorDetail key={sel.key} v={sel} token={token} onBack={() => setSel(null)} />
            : <div className="h-full min-h-40 flex items-center justify-center text-[13px] text-[#555] border border-dashed border-[#1a1a1a] rounded-xl">Select a visitor to replay their visits</div>}
        </div>
      </div>
    </State>
  );
}

interface SessionRow { session_id: string; started_at: string; duration_ms: number | null; entry_path: string | null; exit_path: string | null; page_count: number | null;
  is_bounce: boolean | null; source_name: string | null; channel: string | null; utm_campaign: string | null; device_type: string | null; browser: string | null; os: string | null; country: string | null }
interface VisitorSection { path: string; section_id: string; section_name: string | null; times_seen: number; total_dwell_ms: number; avg_dwell_ms: number }

function VisitorDetail({ v, token, onBack }: { v: Visitor; token: string; onBack: () => void }) {
  const q = useMarketing<{ sessions: SessionRow[]; sections: VisitorSection[] }>(`section=visitor&key=${encodeURIComponent(v.key)}&persistent=${v.persistent ? 1 : 0}`, token);
  const [sid, setSid] = useState("");
  const sessions = q.data?.sessions ?? [];
  const current = sid || sessions[0]?.session_id || "";
  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <button onClick={onBack} className="xl:hidden mb-2 text-[13px] text-[#888] hover:text-[#ededed] bg-transparent border-none p-0 cursor-pointer">‹ All visitors</button>
          <h2 className="text-[16px] font-semibold text-[#ededed]">{visitorLabel(v)}</h2>
          <p className="text-[12px] text-[#555] mt-0.5">
            {v.persistent ? `Returning id · first seen ${fmt(v.firstSeenAt)}` : `1-day profile · ${fmt(v.lastSeenAt)} — id resets daily, so earlier or later visits can't be linked`}
          </p>
        </div>
        {v.reachedApp && <span className="shrink-0 text-[12px] font-medium text-[#3ecf8e] border border-[rgba(62,207,142,0.3)] rounded-md px-2 py-0.5">Clicked through to app</span>}
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Stat label="Sessions" value={v.sessions} sub={v.bouncedSessions ? `${v.bouncedSessions} bounced` : "none bounced"} />
        <Stat label="Page views" value={v.pageViews} />
        <Stat label="Time on site" value={v.totalTimeMs > 0 ? dur(v.totalTimeMs) : "—"} sub={v.totalTimeMs > 0 ? undefined : "not measured"} />
        <Stat label="Source" value={<span className="text-[15px]">{v.firstSource ?? human(v.firstChannel) ?? "Direct"}</span>} sub={v.firstCampaign ? `campaign ${v.firstCampaign}` : v.firstEntryPath ?? undefined} />
      </div>

      {(v.topPaths.length > 0 || v.topSections.length > 0) && (
        <Block title="Spent most time on">
          <div className="px-4 py-3 flex flex-col gap-2">
            {v.topPaths.length > 0 && <div className="text-[12px] text-[#888]">Pages: <span className="text-[#ccc]">{v.topPaths.slice(0, 5).join(" · ")}</span></div>}
            {v.topSections.length > 0 && <div className="text-[12px] text-[#888]">Sections: <span className="text-[#ccc]">{v.topSections.slice(0, 6).join(" · ")}</span></div>}
          </div>
        </Block>
      )}

      {q.error ? <Note>Couldn&apos;t load visits: {q.error}</Note> : q.loading && !q.data ? <div className="skeleton h-40 rounded-xl" /> : (<>
        <Block title="Visits" count={sessions.length} action={sessions.length > 1 ? (
          <Select value={current} onChange={e => setSid(e.target.value)} wrapperClassName="w-auto" className="h-7 text-[12px]" aria-label="Visit">
            {sessions.map(s => <option key={s.session_id} value={s.session_id}>{fmtFull(s.started_at)}</option>)}
          </Select>) : undefined}>
          {current ? <Journey token={token} sessionId={current} /> : <Empty>No visits recorded</Empty>}
        </Block>
        {(q.data?.sections.length ?? 0) > 0 && (
          <Block title="Sections read" count={q.data!.sections.length}>
            <Table rows={q.data!.sections} rowKey={(s, i) => `${s.path}|${s.section_id}|${i}`} empty="" cols={[
              { label: "Section", cell: s => <Primary sub={<code className="font-mono">{s.path}</code>}>{s.section_name ?? s.section_id}</Primary> },
              { label: "Seen", cell: s => `${s.times_seen}×` },
              { label: "Total time", cell: s => dur(s.total_dwell_ms) },
            ]} />
          </Block>
        )}
      </>)}
    </div>
  );
}

interface Step { step: number; occurred_at: string; type: string; path: string | null; page_title: string | null; section_name: string | null; section_id: string | null;
  dwell_ms: number | null; max_visible_pct: number | null; target_kind: string | null; target_path: string | null; target_label: string | null; target_section: string | null;
  scroll_pct: number | null; time_on_page_ms: number | null; metadata: Record<string, unknown> | null; country: string | null; device_type: string | null;
  browser: string | null; channel: string | null; source_name: string | null; utm_campaign: string | null }

const STEP_COLOR: Record<string, string> = { page: "#ededed", leave: "#555", section: "#0070f3", click: "#f5a623", app: "#3ecf8e", scroll: "#666", end: "#444" };

function describe(s: Step): { kind: keyof typeof STEP_COLOR; title: ReactNode; detail?: ReactNode } {
  const closing = s.metadata && String((s.metadata as Record<string, unknown>).closing) === "true";
  switch (s.type) {
    case "page_view":
      return closing
        ? { kind: "leave", title: <>Left <code className="font-mono">{s.path}</code></>, detail: s.time_on_page_ms != null ? `after ${dur(s.time_on_page_ms)} on the page` : undefined }
        : { kind: "page", title: <>Opened <code className="font-mono">{s.path}</code></>, detail: s.page_title ?? undefined };
    case "section_view":
      return { kind: "section", title: <>Read “{s.section_name ?? s.section_id}”</>, detail: [s.dwell_ms != null ? dur(s.dwell_ms) : null, s.max_visible_pct != null ? `${s.max_visible_pct}% visible` : null].filter(Boolean).join(" · ") || undefined };
    case "click": {
      const app = s.target_kind === "app";
      return { kind: app ? "app" : "click", title: <>{app ? "Clicked through to app" : "Clicked"} {s.target_label ? `“${s.target_label}”` : ""}</>,
        detail: [s.target_path, s.target_section ? `in ${s.target_section}` : null, human(s.target_kind)].filter(Boolean).join(" · ") || undefined };
    }
    case "scroll_depth":   // event types per web_analytics.sql: page_view, section_view, click, scroll_depth, session_end
      return { kind: "scroll", title: <>Scrolled to {s.scroll_pct}%</>, detail: s.path ? <code className="font-mono">{s.path}</code> : undefined };
    case "session_end":
      return { kind: "end", title: "Visit ended", detail: s.time_on_page_ms != null ? `${dur(s.time_on_page_ms)} on the last page` : undefined };
    default:
      return { kind: "scroll", title: human(s.type) ?? s.type, detail: s.path ?? undefined };
  }
}

function Journey({ token, sessionId }: { token: string; sessionId: string }) {
  const q = useMarketing<{ steps: Step[] }>(`section=journey&session=${sessionId}`, token);
  if (q.error) return <Empty>Couldn&apos;t load this visit: {q.error}</Empty>;
  if (q.loading && !q.data) return <div className="p-4"><div className="skeleton h-32 rounded-lg" /></div>;
  const steps = q.data?.steps ?? [];
  if (!steps.length) return <Empty>No events in this visit</Empty>;
  const first = steps[0], start = Date.parse(first.occurred_at);
  return (
    <div className="px-4 py-4">
      <div className="text-[12px] text-[#666] mb-4">
        {[first.source_name ?? human(first.channel) ?? "Direct", first.utm_campaign ? `campaign ${first.utm_campaign}` : null, first.country, human(first.device_type), first.browser].filter(Boolean).join(" · ")}
        {" · "}{fmtFull(first.occurred_at)} UTC
      </div>
      <ol className="relative border-l border-[#1f1f1f] ml-1.5 flex flex-col gap-4">
        {steps.map(s => {
          const d = describe(s);
          const t = Math.max(0, Date.parse(s.occurred_at) - start);
          return (
            <li key={s.step} className="pl-4 relative">
              <span className="absolute -left-[5px] top-1.5 w-2.5 h-2.5 rounded-full border-2 border-black" style={{ background: STEP_COLOR[d.kind] }} />
              <div className="flex items-baseline justify-between gap-3">
                <span className={`text-[13px] ${d.kind === "app" ? "text-[#3ecf8e]" : d.kind === "leave" || d.kind === "end" ? "text-[#888]" : "text-[#ddd]"}`}>{d.title}</span>
                <span className="shrink-0 text-[11px] text-[#555] tabular-nums">+{dur(t)}</span>
              </div>
              {d.detail && <div className="text-[12px] text-[#555] mt-0.5 break-all">{d.detail}</div>}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
