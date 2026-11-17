// components/admin/OverviewTab.tsx
"use client";
import { useState, useCallback, useEffect, useMemo, type ReactNode } from "react";
import {
  AnalyticsData, User, USAGE_FIELDS,
  MetricCard, HBar, Donut, BarChart, SL, Spinner,
  SkeletonMetricCard, useIsMobile, Select,
} from "./admin-shared";
import PacksPanel from "./PacksPanel";

type TimeRange  = "1" | "7" | "30" | "90";
type DeviceType = "all" | "desktop" | "mobile" | "tablet" | "other";

const COMMON_COUNTRIES: { code: string; name: string }[] = [
  { code: "US", name: "United States" }, { code: "GB", name: "United Kingdom" },
  { code: "IN", name: "India"          }, { code: "CA", name: "Canada"         },
  { code: "AU", name: "Australia"      }, { code: "DE", name: "Germany"        },
  { code: "FR", name: "France"         }, { code: "BR", name: "Brazil"         },
  { code: "JP", name: "Japan"          }, { code: "SG", name: "Singapore"      },
];

interface CFSummary { visitors: number | null; requests: number | null; bandwidth: string; cacheRate: number | null; adaptive: boolean; visits: number }
interface Props { analytics: AnalyticsData | null; users: User[]; loading: boolean; token?: string }

function fmtBytes(b = 0) {
  if (b >= 1e9) return `${(b / 1e9).toFixed(1)}GB`;
  if (b >= 1e6) return `${(b / 1e6).toFixed(0)}MB`;
  return `${(b / 1e3).toFixed(0)}KB`;
}
function fmtNum(n = 0) {
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}k`;
  return String(n);
}

export default function OverviewTab({ analytics, users, loading, token = "" }: Props) {
  const isMobile = useIsMobile();
  // .edu student perk: claimed the free month / verified email (any) / started but unverified
  const studentStats = useMemo(() => ({
    claimed:  users.filter(u => u.student?.status === "claimed").length,
    verified: users.filter(u => u.student && u.student.status !== "pending").length,
    pending:  users.filter(u => u.student?.status === "pending").length,
  }), [users]);
  const [cf, setCf]           = useState<CFSummary | null>(null);
  const [cfLoading, setCfLoad] = useState(false);
  const [cfErr, setCfErr]     = useState("");
  const [availableCountries, setAvailableCountries] = useState<{ code: string; name: string }[]>([]);
  const [fltDays,    setFltDays]    = useState<TimeRange>("7");
  const [fltCountry, setFltCountry] = useState<string>("all");
  const [fltDevice,  setFltDevice]  = useState<DeviceType>("all");

  const timeLabel = useMemo(() => ({ "1": "Last 24 hours", "7": "Last 7 days", "30": "Last 30 days", "90": "Last 90 days" }[fltDays]), [fltDays]);

  const countryOptions = useMemo(() => {
    const map = new Map<string, string>();
    COMMON_COUNTRIES.forEach(c => map.set(c.code, c.name));
    availableCountries.forEach(c => { if (c.code) map.set(c.code, c.name); });
    return Array.from(map.entries()).map(([code, name]) => ({ code, name })).sort((a, b) => a.name.localeCompare(b.name));
  }, [availableCountries]);

  const loadCF = useCallback(() => {
    queueMicrotask(() => {
      setCfLoad(true); setCfErr("");
      const params = new URLSearchParams({ days: fltDays });
      if (fltCountry !== "all") params.set("country", fltCountry);
      if (fltDevice  !== "all") params.set("device",  fltDevice);
      fetch(`/api/admin?action=cloudflare&${params.toString()}`, { headers: token ? { "x-admin-token": token } : {} })
        .then(r => r.json() as Promise<{
          adaptive?: boolean;
          daily?: { sum?: { visits?: number | null; bytes?: number | null; cachedBytes?: number | null; requests?: number | null } }[];
          totals?: { uniqueVisitors: number | null; requests: number | null; bytes: number; cachedBytes: number | null; cacheRate: number | null; visits?: number } | null;
          countries?: { clientCountryName: string; requests: number; bytes: number }[];
          error?: string;
        }>)
        .then(json => {
          if (json.error) throw new Error(json.error);
          const t = json.totals;
          if (!t) { setCf(null); setCfLoad(false); return; }
          setCf({ visitors: t.uniqueVisitors, requests: t.requests, bandwidth: fmtBytes(t.bytes ?? 0), cacheRate: t.cacheRate, adaptive: !!json.adaptive, visits: t.visits ?? 0 });
          if (json.countries && json.countries.length > 0) {
            setAvailableCountries(json.countries.map(c => ({ code: c.clientCountryName, name: c.clientCountryName })));
          }
          setCfLoad(false);
        })
        .catch((e: Error) => { setCfErr(e.message); setCfLoad(false); });
    });
  }, [token, fltDays, fltCountry, fltDevice]);

  useEffect(() => { loadCF(); }, [loadCF]);

  if (loading) return (
    <div className="flex-1 overflow-auto p-4 md:p-6 flex flex-col gap-5 bg-canvas">
      <section>
        <div className="skeleton h-3 w-24 rounded-full mb-3" />
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
          {Array.from({ length: 5 }).map((_, i) => <SkeletonMetricCard key={i} />)}
        </div>
      </section>
      <section>
        <div className="skeleton h-3 w-32 rounded-full mb-3" />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {Array.from({ length: 4 }).map((_, i) => <SkeletonMetricCard key={i} />)}
        </div>
      </section>
      <section>
        <div className="skeleton h-3 w-28 rounded-full mb-3" />
        <div className="skeleton h-48 rounded-xl" />
      </section>
    </div>
  );
  if (!analytics) return <div className="empty flex-1">No data — click Refresh.</div>;

  const provColors = ["#5b6cff", "#10b981", "#f59e0b", "#ef4444", "#3b82f6"];

  return (
    <div className="flex-1 overflow-auto p-4 md:p-6 flex flex-col gap-5 bg-canvas">

      {/* User Health */}
      <section>
        <SL>User Health</SL>
        <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-3">
          <MetricCard label="Total Users"    value={analytics.total} />
          <MetricCard label="New This Month" value={analytics.newThisMonth}          color={analytics.growthDelta >= 0 ? "var(--success-fg)" : "var(--danger-fg)"} sub={`${analytics.growthDelta >= 0 ? "+" : ""}${analytics.growthDelta}% vs last mo`} />
          <MetricCard label="Pro"            value={analytics.planCounts.pro}        color="var(--brand-fg)" />
          <MetricCard label="Premium"        value={analytics.planCounts.premium}    color="var(--warning-fg)" />
          <MetricCard label="Canceled"       value={analytics.canceledCount}         color="var(--danger-fg)" />
          <MetricCard label="Students"       value={studentStats.claimed}            color="var(--violet-fg)"
            sub={`claimed · ${studentStats.verified} verified${studentStats.pending ? ` · ${studentStats.pending} pending` : ""}`} />
        </div>
      </section>

      {/* Cloudflare traffic */}
      <section>
        <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
          <div className="flex items-baseline gap-2">
            <div className="label">Website Traffic · {timeLabel}</div>
            {(fltCountry !== "all" || fltDevice !== "all") && (
              <span className="text-caption">
                · filtered{fltCountry !== "all" ? ` · ${fltCountry}` : ""}{fltDevice !== "all" ? ` · ${fltDevice}` : ""}
              </span>
            )}
          </div>
          {cfErr && <span className="inline-flex items-center gap-1.5 text-[12px] text-warning-fg font-medium" title={cfErr}><span className="dot bg-warning" />Cloudflare unavailable</span>}
        </div>

        <div className="flex flex-wrap gap-2 mb-3">
          <FilterSelect label="Time" value={fltDays} onChange={v => setFltDays(v as TimeRange)}
            options={[{ value: "1", label: "Last 24 hours" }, { value: "7", label: "Last 7 days" }, { value: "30", label: "Last 30 days" }, { value: "90", label: "Last 90 days" }]} />
          <FilterSelect label="Country" value={fltCountry} onChange={setFltCountry}
            options={[{ value: "all", label: "All countries" }, ...countryOptions.map(c => ({ value: c.code, label: `${c.code} - ${c.name}` }))]} />
          <FilterSelect label="Device" value={fltDevice} onChange={v => setFltDevice(v as DeviceType)}
            options={[{ value: "all", label: "All devices" }, { value: "desktop", label: "Desktop" }, { value: "mobile", label: "Mobile" }, { value: "tablet", label: "Tablet" }, { value: "other", label: "Other" }]} />
          {(fltCountry !== "all" || fltDevice !== "all" || fltDays !== "7") && (
            <button
              onClick={() => { setFltDays("7"); setFltCountry("all"); setFltDevice("all"); }}
              className="btn btn-ghost"
              type="button"
            >
              Reset
            </button>
          )}
        </div>

        {cfLoading ? (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {Array.from({ length: 4 }).map((_, i) => <SkeletonMetricCard key={i} />)}
          </div>
        ) : cf ? (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {cf.adaptive ? (
              <>
                <MetricCard label="Visits"          value={fmtNum(cf.visits)} sub={`Device: ${fltDevice}`} />
                <MetricCard label="Bandwidth"       value={cf.bandwidth}      sub="Data served" />
                <MetricCard label="Unique Visitors" value="n/a"               color="var(--fg-5)" sub="N/A with device filter" />
                <MetricCard label="Cache Rate"      value="n/a"               color="var(--fg-5)" sub="N/A with device filter" />
              </>
            ) : (
              <>
                <MetricCard label="Unique Visitors" value={fmtNum(cf.visitors ?? 0)} sub={fltCountry !== "all" ? `Country: ${fltCountry}` : "preciprocal.com"} />
                <MetricCard label="Total Requests"  value={fmtNum(cf.requests ?? 0)} sub="HTTP requests" />
                <MetricCard label="Bandwidth"       value={cf.bandwidth}             sub="Data served" />
                <MetricCard label="Cache Rate"      value={cf.cacheRate !== null ? `${cf.cacheRate}%` : "n/a"} color={(cf.cacheRate ?? 0) > 50 ? "var(--success-fg)" : "var(--warning-fg)"} sub={(cf.cacheRate ?? 0) > 50 ? "Good caching" : "Could improve"} />
              </>
            )}
          </div>
        ) : !cfErr ? (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[1, 2, 3, 4].map(i => <div key={i} className="card h-20 animate-pulse" />)}
          </div>
        ) : (
          <div className="px-4 py-3 bg-warning-soft border border-warning-line rounded-xl text-[13px] text-warning-fg">
            <div className="font-semibold mb-1">Cloudflare traffic data unavailable</div>
            <div className="text-[12px] text-warning-fg/70 wrap-break-word font-mono">{cfErr}</div>
            <div className="text-caption mt-2">
              Required in <code className="bg-raised-2 px-1 rounded-md">.env</code>:{" "}
              <code className="bg-raised-2 px-1 rounded-md">CLOUDFLARE_API_TOKEN</code> and{" "}
              <code className="bg-raised-2 px-1 rounded-md">CLOUDFLARE_ZONE_ID</code>
            </div>
          </div>
        )}
      </section>

      {/* Engagement */}
      <section>
        <SL>Engagement</SL>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <MetricCard label="Active Users"  value={analytics.activeThisMonth}      sub="Used ≥1 feature" />
          <MetricCard label="Power Users"   value={analytics.powerUsers}           sub=">10 actions" />
          <MetricCard label="Dormant"       value={analytics.dormant}              sub="Zero usage" />
          <MetricCard label="Conversion"    value={`${analytics.conversionRate}%`} color="var(--success-fg)" sub="Free → paid" />
        </div>
      </section>

      {/* Trends */}
      <section>
        <SL>Trends & Distribution</SL>
        <div className="flex flex-col gap-4">
          <SectionCard title="Monthly Signups">
            <BarChart data={analytics.signupArr.map(m => ({ l: m.label, v: m.count }))} color="#5b6cff" h={isMobile ? 65 : 90} />
          </SectionCard>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <SectionCard title="Plan Distribution">
              {/* Wraps the legend under the donut when the card is narrow (tablet) */}
              <div className="flex flex-wrap items-center gap-4">
                <Donut segments={analytics.planSegments} size={80} label={String(analytics.total)} />
                <div className="flex-1 min-w-35 flex flex-col gap-2.5">
                  {analytics.planSegments.map(s => (
                    <div key={s.label} className="flex items-center gap-2">
                      <span className="dot" style={{ background: s.color }} />
                      <span className="text-[13px] text-fg-3 flex-1 min-w-0 truncate">{s.label}</span>
                      <span className="text-[14px] font-semibold text-fg shrink-0 num">{s.value}</span>
                      <span className="text-[12px] text-fg-4 shrink-0 w-8 text-right num">{analytics.total ? Math.round(s.value / analytics.total * 100) : 0}%</span>
                    </div>
                  ))}
                </div>
              </div>
            </SectionCard>
            <SectionCard title="Sign-in Providers">
              <div className="flex flex-col gap-3">
                {Object.entries(analytics.providers).sort((a, b) => b[1] - a[1]).map(([prov, count], i) => {
                  const pct = analytics.total ? Math.round(count / analytics.total * 100) : 0;
                  return (
                    <div key={prov}>
                      <div className="flex justify-between items-center mb-1.5">
                        <span className="text-[13px] text-fg-3 font-medium capitalize">{prov}</span>
                        <span className="text-[13px] font-semibold text-fg num">{count} <span className="text-fg-4 font-normal">({pct}%)</span></span>
                      </div>
                      <HBar pct={pct} color={provColors[i % provColors.length]} />
                    </div>
                  );
                })}
              </div>
            </SectionCard>
          </div>
        </div>
      </section>

      {/* Revenue */}
      <section>
        <SL>Revenue</SL>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <SectionCard title="Revenue Overview">
            <div className="flex flex-col gap-2 mb-3">
              {([
                ["Active Paid", analytics.planCounts.pro + analytics.planCounts.premium, "text-success-fg", "bg-success-soft border-success-line"],
                ["Free Tier",   analytics.planCounts.free,                               "text-fg-2",       "bg-subtle border-line-soft"],
                ["Canceled",    analytics.canceledCount,                                 "text-danger-fg",  "bg-danger-soft border-danger-line"],
                ["Has Stripe",  analytics.stripeCount,                                   "text-brand-fg",   "bg-brand-soft border-brand-line"],
              ] as [string, number, string, string][]).map(([l, v, tc, well]) => (
                <div key={l} className={`flex items-center gap-3 px-3.5 py-2.5 rounded-lg border ${well}`}>
                  <span className="flex-1 text-[13px] text-fg-3 font-medium">{l}</span>
                  <span className={`text-[20px] font-semibold tracking-tight num ${tc}`}>{v}</span>
                </div>
              ))}
            </div>
            <div className="p-4 rounded-lg border bg-success-soft border-success-line">
              <div className="label text-success-fg! mb-1.5">Conversion Rate</div>
              <div className="text-[24px] font-semibold text-success-fg tracking-tight leading-none num">{analytics.conversionRate}%</div>
              <div className="text-caption mt-1.5">Free → Paid · Est. MRR <strong className="text-success-fg num">${analytics.revenue.toFixed(2)}</strong></div>
            </div>
          </SectionCard>
          <SectionCard title="Feature Adoption" action={<span className="text-caption num">{analytics.totalUsage} total actions</span>}>
            <div className="flex flex-col">
              {analytics.featureRank.map(f => {
                const uf  = USAGE_FIELDS.find(u => u.label === f.label);
                const pct = Math.round(f.value / analytics.maxFeature * 100);
                const col = uf?.color ?? "#5b6cff";
                return (
                  <div key={f.label} className="flex items-center gap-3 py-2 border-b border-line-soft last:border-0">
                    <span className="text-[12px] text-fg-3 font-medium shrink-0 w-24 truncate">{f.label}</span>
                    <HBar pct={pct} color={col} />
                    <span className="text-[13px] font-semibold text-fg shrink-0 w-8 text-right num">{f.value}</span>
                  </div>
                );
              })}
            </div>
          </SectionCard>
        </div>
      </section>

      <PacksPanel token={token} />
      <OpsHealth token={token} />
      <RecentUnsubscribes token={token} />
    </div>
  );
}

// A section card: header row (title left, optional action right) over a padded body.
// `flush` drops the body padding for full-bleed lists and tables.
function SectionCard({ title, action, flush, children }: { title: string; action?: ReactNode; flush?: boolean; children: ReactNode }) {
  return (
    <div className="card overflow-hidden">
      <div className="card-header">
        <h3 className="section-title truncate">{title}</h3>
        {action}
      </div>
      <div className={flush ? "" : "card-pad"}>{children}</div>
    </div>
  );
}

// ─── Operations health ────────────────────────────────────────────────────────
// Open disputes with their evidence deadline, whether Stripe webhooks are
// arriving and being handled, and how each email type is landing.

interface OpsData {
  disputes: { id: string; email: string | null; amountCents: number; currency: string; reason: string; status: string; evidenceDueBy: string | null; what: string | null; createdAt: string }[] | null;
  webhook: { lastReceivedAt: string | null; lastType: string | null; last24h: number; stuck: { event_id: string; type: string; received_at: string }[] } | null;
  deliverability: { type: string; sent: number; delivered: number; opened: number; clicked: number; bounced: number; complained: number }[];
  security: { failedLogins24h: number; passwordChanges7d: number } | null;
}

const ago = (iso: string | null) => {
  if (!iso) return "never";
  const m = Math.round((Date.now() - Date.parse(iso)) / 60_000);
  return m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`;
};
const pct = (n: number, d: number) => (d ? `${Math.round((n / d) * 100)}%` : "-");

function OpsHealth({ token }: { token: string }) {
  const [d, setD] = useState<OpsData | null>(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    let live = true;
    fetch("/api/admin?action=ops_health", { headers: token ? { "x-admin-token": token } : {} })
      .then(async r => { const j = await r.json(); if (!r.ok || j.error) throw new Error(j.error ?? `HTTP ${r.status}`); return j as OpsData; })
      .then(j => { if (live) setD(j); })
      .catch((e: Error) => { if (live) setErr(e.message); });
    return () => { live = false; };
  }, [token]);

  if (err) return <SectionCard title="Operations"><p className="text-[13px] text-danger-fg">Could not load: {err}</p></SectionCard>;
  if (!d) return <SectionCard title="Operations"><div className="skeleton h-24 rounded-lg" /></SectionCard>;

  const wh = d.webhook;
  const quiet = wh?.lastReceivedAt ? Date.now() - Date.parse(wh.lastReceivedAt) > 3 * 86_400_000 : true;
  return (
    <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
      <SectionCard title="Open disputes" flush>
        {d.disputes === null ? <div className="empty">Starts recording once Dashboard migration 0052 is applied.</div>
          : d.disputes.length === 0 ? <div className="empty">No open disputes.</div>
          : <ul className="divide-y divide-line-soft">{d.disputes.map(x => (
              <li key={x.id} className="px-4 py-2.5 flex items-start justify-between gap-3 hover-row">
                <div className="min-w-0">
                  <div className="text-[13px] text-fg-2 truncate">{x.email ?? "Unknown customer"} <span className="text-fg-4">· {x.what ?? "Payment"}</span></div>
                  <div className="text-caption mt-0.5">{String(x.reason).replace(/_/g, " ")} · {String(x.status).replace(/_/g, " ")}</div>
                </div>
                <div className="shrink-0 text-right">
                  <div className="text-[13px] font-semibold text-warning-fg num">${(x.amountCents / 100).toFixed(2)}</div>
                  {x.evidenceDueBy && <div className="text-[11px] text-danger-fg mt-0.5">Evidence due {new Date(x.evidenceDueBy).toLocaleDateString(undefined, { day: "numeric", month: "short" })}</div>}
                </div>
              </li>))}</ul>}
      </SectionCard>

      <SectionCard title="Stripe webhooks">
        {wh === null ? <p className="text-[13px] text-fg-4">Not set up (Dashboard migration 0035).</p> : (
          <div className="flex flex-col gap-2 text-[13px]">
            <div className="flex justify-between gap-3"><span className="text-fg-3">Last event</span><span className={`text-right ${quiet ? "text-warning-fg" : "text-fg-2"}`}>{ago(wh.lastReceivedAt)}{wh.lastType ? ` · ${wh.lastType}` : ""}</span></div>
            <div className="flex justify-between gap-3"><span className="text-fg-3">Events, last 24 h</span><span className="text-fg-2 num">{wh.last24h}</span></div>
            <div className="flex justify-between gap-3"><span className="text-fg-3">Not finished (7 days)</span><span className={wh.stuck.length ? "text-danger-fg font-semibold" : "text-success-fg"}>{wh.stuck.length || "None"}</span></div>
            {wh.stuck.slice(0, 4).map(s => <div key={s.event_id} className="text-[11px] text-fg-4 truncate">{s.type} · {ago(s.received_at)} · {s.event_id}</div>)}
            {d.security && <>
              <div className="divider my-1" />
              <div className="flex justify-between gap-3"><span className="text-fg-3">Failed sign-ins, 24 h</span><span className={`num ${d.security.failedLogins24h > 20 ? "text-warning-fg" : "text-fg-2"}`}>{d.security.failedLogins24h}</span></div>
              <div className="flex justify-between gap-3"><span className="text-fg-3">Password changes, 7 days</span><span className="text-fg-2 num">{d.security.passwordChanges7d}</span></div>
            </>}
          </div>
        )}
      </SectionCard>

      <SectionCard title="Email deliverability, 30 days" flush>
        {d.deliverability.length === 0 ? <div className="empty">No emails sent in the last 30 days.</div> : (
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead><tr><th>Type</th><th className="text-right">Sent</th><th className="text-right">Opened</th><th className="text-right">Bounced</th><th className="text-right">Spam</th></tr></thead>
              <tbody>{d.deliverability.slice(0, 10).map(r => (
                <tr key={r.type}>
                  <td className="truncate max-w-[140px]">{r.type.replace(/_/g, " ")}</td>
                  <td className="text-right num">{r.sent}</td>
                  <td className="text-right num text-brand-fg!">{pct(r.opened, r.sent)}</td>
                  <td className={`text-right num ${r.bounced ? "text-warning-fg!" : "text-fg-4!"}`}>{r.bounced}</td>
                  <td className={`text-right num ${r.complained ? "text-danger-fg!" : "text-fg-4!"}`}>{r.complained}</td>
                </tr>))}</tbody>
            </table>
          </div>
        )}
      </SectionCard>
    </div>
  );
}

// ─── Recent unsubscribes ──────────────────────────────────────────────────────
// Who turned emails off, from what, and the last email they got before they
// did. Written by the Dashboard's unsubscribe routes (email_unsubscribes).

const UNSUB_SCOPE: Record<string, string> = {
  weeklyDigest: "Weekly summaries", supportReplies: "Emailed support replies", activation: "Next-step suggestions",
  coaching: "Application coaching", all: "All optional emails",
};

interface Unsub { userId: string | null; name: string | null; email: string | null; scope: string; method: string; lastEmailType: string | null; at: string }

function RecentUnsubscribes({ token }: { token: string }) {
  const [rows, setRows] = useState<Unsub[] | null>(null);
  const [pending, setPending] = useState(false);
  useEffect(() => {
    let live = true;
    fetch("/api/admin?action=unsubscribes", { headers: token ? { "x-admin-token": token } : {} })
      .then(r => r.json())
      .then((j: { unsubscribes?: Unsub[]; pending?: boolean }) => { if (live) { setRows(j.unsubscribes ?? []); setPending(!!j.pending); } })
      .catch(() => { if (live) setRows([]); });
    return () => { live = false; };
  }, [token]);

  return (
    <SectionCard title="Recent unsubscribes" flush>
      {rows === null ? <div className="p-4"><div className="skeleton h-16 rounded-lg" /></div>
        : rows.length === 0 ? (
          <div className="empty">{pending ? "Starts recording once migration 0050 is applied." : "Nobody has unsubscribed yet."}</div>
        ) : (
          <ul className="divide-y divide-line-soft">
            {rows.map((u, i) => (
              <li key={i} className="px-4 py-2.5 flex items-start justify-between gap-4 hover-row">
                <div className="min-w-0">
                  <div className="text-[13px] text-fg-2 truncate">{u.name ?? "Unknown"} <span className="text-fg-4">· {u.email ?? "no email"}</span></div>
                  <div className="text-caption mt-0.5">
                    {u.method === "one_click" ? "Email app button" : "Email link"}{u.lastEmailType ? ` · after ${u.lastEmailType.replace(/_/g, " ")}` : ""}
                  </div>
                </div>
                <div className="shrink-0 text-right">
                  <div className="text-[12px] font-medium text-warning-fg">{UNSUB_SCOPE[u.scope] ?? u.scope}</div>
                  <div className="text-[11px] text-fg-4 mt-0.5">{new Date(u.at).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</div>
                </div>
              </li>
            ))}
          </ul>
        )}
    </SectionCard>
  );
}

// ─── FilterSelect ─────────────────────────────────────────────────────────────

function FilterSelect({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: { value: string; label: string }[] }) {
  return (
    <Select value={value} onChange={e => onChange(e.target.value)} leading={label}
      wrapperClassName="w-auto" className="h-8 rounded-lg text-[12px] font-medium text-fg-2">
      {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
    </Select>
  );
}
