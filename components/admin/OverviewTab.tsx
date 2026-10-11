// components/admin/OverviewTab.tsx
"use client";
import { useState, useCallback, useEffect, useMemo } from "react";
import {
  AnalyticsData, User, USAGE_FIELDS,
  MetricCard, HBar, Donut, BarChart, SL, Card, CardTitle, Spinner,
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
    <div className="flex-1 overflow-auto p-4 md:p-7 flex flex-col gap-5 bg-black">
      <section>
        <div className="skeleton h-3 w-24 rounded-full mb-3" />
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-2">
          {Array.from({ length: 5 }).map((_, i) => <SkeletonMetricCard key={i} />)}
        </div>
      </section>
      <section>
        <div className="skeleton h-3 w-32 rounded-full mb-3" />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          {Array.from({ length: 4 }).map((_, i) => <SkeletonMetricCard key={i} />)}
        </div>
      </section>
      <section>
        <div className="skeleton h-3 w-28 rounded-full mb-3" />
        <div className="skeleton h-48 rounded-xl" />
      </section>
    </div>
  );
  if (!analytics) return <div className="flex-1 flex items-center justify-center text-sm text-[#444]">No data — click Refresh.</div>;

  const provColors = ["#0070f3", "#3ecf8e", "#f5a623", "#f44", "#38bdf8"];

  return (
    <div className="flex-1 overflow-auto p-4 md:p-7 flex flex-col gap-5 bg-black">

      {/* User Health */}
      <section>
        <SL>User Health</SL>
        <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-2">
          <MetricCard label="Total Users"    value={analytics.total}                color="#ededed" />
          <MetricCard label="New This Month" value={analytics.newThisMonth}          color={analytics.growthDelta >= 0 ? "#3ecf8e" : "#f44"} sub={`${analytics.growthDelta >= 0 ? "+" : ""}${analytics.growthDelta}% vs last mo`} />
          <MetricCard label="Pro"            value={analytics.planCounts.pro}        color="#0070f3" />
          <MetricCard label="Premium"        value={analytics.planCounts.premium}    color="#f5a623" />
          <MetricCard label="Canceled"       value={analytics.canceledCount}         color="#f44" />
          <MetricCard label="Students"       value={studentStats.claimed}            color="#a855f7"
            sub={`claimed · ${studentStats.verified} verified${studentStats.pending ? ` · ${studentStats.pending} pending` : ""}`} />
        </div>
      </section>

      {/* Cloudflare traffic */}
      <section>
        <div className="flex items-center justify-between mb-2.5 flex-wrap gap-2">
          <div className="flex items-baseline gap-2">
            <SL>Website Traffic · {timeLabel}</SL>
            {(fltCountry !== "all" || fltDevice !== "all") && (
              <span className="text-[11px] text-[#555]">
                · filtered{fltCountry !== "all" ? ` · ${fltCountry}` : ""}{fltDevice !== "all" ? ` · ${fltDevice}` : ""}
              </span>
            )}
          </div>
          {cfErr && <span className="text-[11px] text-[#f5a623] font-medium" title={cfErr}>⚠ Cloudflare unavailable</span>}
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
              className="text-[12px] text-[#555] hover:text-[#888] px-2.5 py-1.5 rounded-lg border border-[#2a2a2a] bg-transparent hover:bg-[#0a0a0a] transition-colors"
              type="button"
            >
              Reset
            </button>
          )}
        </div>

        {cfLoading ? (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            {Array.from({ length: 4 }).map((_, i) => <SkeletonMetricCard key={i} />)}
          </div>
        ) : cf ? (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            {cf.adaptive ? (
              <>
                <MetricCard label="Visits"          value={fmtNum(cf.visits)} color="#ededed" sub={`Device: ${fltDevice}`} />
                <MetricCard label="Bandwidth"       value={cf.bandwidth}      color="#ededed" sub="Data served" />
                <MetricCard label="Unique Visitors" value="n/a"               color="#444"    sub="N/A with device filter" />
                <MetricCard label="Cache Rate"      value="n/a"               color="#444"    sub="N/A with device filter" />
              </>
            ) : (
              <>
                <MetricCard label="Unique Visitors" value={fmtNum(cf.visitors ?? 0)} color="#ededed" sub={fltCountry !== "all" ? `Country: ${fltCountry}` : "preciprocal.com"} />
                <MetricCard label="Total Requests"  value={fmtNum(cf.requests ?? 0)} color="#ededed" sub="HTTP requests" />
                <MetricCard label="Bandwidth"       value={cf.bandwidth}             color="#ededed" sub="Data served" />
                <MetricCard label="Cache Rate"      value={cf.cacheRate !== null ? `${cf.cacheRate}%` : "n/a"} color={(cf.cacheRate ?? 0) > 50 ? "#3ecf8e" : "#f5a623"} sub={(cf.cacheRate ?? 0) > 50 ? "Good caching" : "Could improve"} />
              </>
            )}
          </div>
        ) : !cfErr ? (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            {[1, 2, 3, 4].map(i => <div key={i} className="bg-[#0a0a0a] border border-[#1a1a1a] rounded-xl p-4 h-20 animate-pulse" />)}
          </div>
        ) : (
          <div className="px-4 py-3 bg-[rgba(245,166,35,0.06)] border border-[rgba(245,166,35,0.2)] rounded-xl text-xs text-[#f5a623]">
            <div className="font-semibold mb-1">Cloudflare traffic data unavailable</div>
            <div className="text-[12px] text-[#f5a623]/70 wrap-break-word font-mono">{cfErr}</div>
            <div className="text-[12px] text-[#555] mt-2">
              Required in <code className="bg-[#1a1a1a] px-1 rounded">.env</code>:{" "}
              <code className="bg-[#1a1a1a] px-1 rounded">CLOUDFLARE_API_TOKEN</code> and{" "}
              <code className="bg-[#1a1a1a] px-1 rounded">CLOUDFLARE_ZONE_ID</code>
            </div>
          </div>
        )}
      </section>

      {/* Engagement */}
      <section>
        <SL>Engagement</SL>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          <MetricCard label="Active Users"  value={analytics.activeThisMonth}      color="#ededed" sub="Used ≥1 feature" />
          <MetricCard label="Power Users"   value={analytics.powerUsers}           color="#ededed" sub=">10 actions" />
          <MetricCard label="Dormant"       value={analytics.dormant}              color="#ededed" sub="Zero usage" />
          <MetricCard label="Conversion"    value={`${analytics.conversionRate}%`} color="#3ecf8e" sub="Free → paid" />
        </div>
      </section>

      {/* Trends */}
      <section>
        <SL>Trends & Distribution</SL>
        <div className="flex flex-col gap-3">
          <Card>
            <CardTitle>Monthly Signups</CardTitle>
            <BarChart data={analytics.signupArr.map(m => ({ l: m.label, v: m.count }))} color="#0070f3" h={isMobile ? 65 : 90} />
          </Card>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Card>
              <CardTitle>Plan Distribution</CardTitle>
              {/* Wraps the legend under the donut when the card is narrow (tablet) */}
              <div className="flex flex-wrap items-center gap-4">
                <Donut segments={analytics.planSegments} size={80} label={String(analytics.total)} />
                <div className="flex-1 min-w-35">
                  {analytics.planSegments.map(s => (
                    <div key={s.label} className="flex items-center gap-2 mb-2.5">
                      <div className="w-2 h-2 rounded-full shrink-0" style={{ background: s.color }} />
                      <span className="text-[13px] text-[#888] flex-1 min-w-0 truncate">{s.label}</span>
                      <span className="text-[14px] font-semibold text-[#ededed] shrink-0">{s.value}</span>
                      <span className="text-[11px] text-[#555] shrink-0 w-7 text-right">{analytics.total ? Math.round(s.value / analytics.total * 100) : 0}%</span>
                    </div>
                  ))}
                </div>
              </div>
            </Card>
            <Card>
              <CardTitle>Sign-in Providers</CardTitle>
              <div className="flex flex-col gap-2.5">
                {Object.entries(analytics.providers).sort((a, b) => b[1] - a[1]).map(([prov, count], i) => {
                  const pct = analytics.total ? Math.round(count / analytics.total * 100) : 0;
                  return (
                    <div key={prov}>
                      <div className="flex justify-between items-center mb-1">
                        <span className="text-[13px] text-[#888] font-medium capitalize">{prov}</span>
                        <span className="text-[13px] font-semibold text-[#ededed]">{count} <span className="text-[#555] font-normal">({pct}%)</span></span>
                      </div>
                      <HBar pct={pct} color={provColors[i % provColors.length]} />
                    </div>
                  );
                })}
              </div>
            </Card>
          </div>
        </div>
      </section>

      {/* Revenue */}
      <section>
        <SL>Revenue</SL>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Card>
            <CardTitle>Revenue Overview</CardTitle>
            <div className="flex flex-col gap-2 mb-3">
              {([
                ["Active Paid", analytics.planCounts.pro + analytics.planCounts.premium, "#3ecf8e",  "rgba(62,207,142,0.08)",  "rgba(62,207,142,0.2)"],
                ["Free Tier",   analytics.planCounts.free,                               "#888",      "rgba(136,136,136,0.06)", "rgba(136,136,136,0.15)"],
                ["Canceled",    analytics.canceledCount,                                 "#f44",      "rgba(255,68,68,0.06)",   "rgba(255,68,68,0.2)"],
                ["Has Stripe",  analytics.stripeCount,                                   "#0070f3",   "rgba(0,112,243,0.06)",   "rgba(0,112,243,0.2)"],
              ] as [string, number, string, string, string][]).map(([l, v, c, bg, bo]) => (
                <div key={l} className="flex items-center gap-3 px-3.5 py-2.5 rounded-lg border" style={{ background: bg, borderColor: bo }}>
                  <span className="flex-1 text-[14px] text-[#888] font-medium">{l}</span>
                  <span className="text-xl font-bold tracking-tight" style={{ color: c }}>{v}</span>
                </div>
              ))}
            </div>
            <div className="p-4 rounded-xl border" style={{ background: "rgba(62,207,142,0.06)", borderColor: "rgba(62,207,142,0.2)" }}>
              <div className="text-[11px] text-[#3ecf8e]/70 font-medium uppercase tracking-widest mb-1">Conversion Rate</div>
              <div className="text-4xl font-bold text-[#3ecf8e] tracking-tighter leading-none">{analytics.conversionRate}%</div>
              <div className="text-xs text-[#555] mt-1.5">Free → Paid · Est. MRR <strong className="text-[#3ecf8e]">${analytics.revenue.toFixed(2)}</strong></div>
            </div>
          </Card>
          <Card>
            <div className="flex items-baseline justify-between mb-3 flex-wrap gap-1">
              <CardTitle>Feature Adoption</CardTitle>
              <span className="text-[12px] text-[#444]">{analytics.totalUsage} total actions</span>
            </div>
            <div className="flex flex-col">
              {analytics.featureRank.map(f => {
                const uf  = USAGE_FIELDS.find(u => u.label === f.label);
                const pct = Math.round(f.value / analytics.maxFeature * 100);
                const col = uf?.color ?? "#0070f3";
                return (
                  <div key={f.label} className="flex items-center gap-2 py-1.5 border-b border-[#111] last:border-0">
                    <span className="text-[12px] text-[#888] font-medium shrink-0 w-24 truncate">{f.label}</span>
                    <HBar pct={pct} color={col} />
                    <span className="text-[13px] font-semibold text-[#ededed] shrink-0 w-7 text-right">{f.value}</span>
                  </div>
                );
              })}
            </div>
          </Card>
        </div>
      </section>

      <PacksPanel token={token} />
      <OpsHealth token={token} />
      <RecentUnsubscribes token={token} />
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

  if (err) return <Card><CardTitle>Operations</CardTitle><p className="text-[13px] text-[#f44] mt-3">Could not load: {err}</p></Card>;
  if (!d) return <Card><CardTitle>Operations</CardTitle><div className="skeleton h-24 rounded-lg mt-3" /></Card>;

  const wh = d.webhook;
  const quiet = wh?.lastReceivedAt ? Date.now() - Date.parse(wh.lastReceivedAt) > 3 * 86_400_000 : true;
  return (
    <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
      <Card>
        <CardTitle>Open disputes</CardTitle>
        {d.disputes === null ? <p className="text-[13px] text-[#555] mt-3">Starts recording once Dashboard migration 0052 is applied.</p>
          : d.disputes.length === 0 ? <p className="text-[13px] text-[#555] mt-3">No open disputes.</p>
          : <ul className="divide-y divide-[#111] mt-2">{d.disputes.map(x => (
              <li key={x.id} className="py-2.5 flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-[13px] text-[#ddd] truncate">{x.email ?? "Unknown customer"} <span className="text-[#555]">· {x.what ?? "Payment"}</span></div>
                  <div className="text-[12px] text-[#666] mt-0.5">{String(x.reason).replace(/_/g, " ")} · {String(x.status).replace(/_/g, " ")}</div>
                </div>
                <div className="shrink-0 text-right">
                  <div className="text-[13px] font-semibold text-[#f5a623] tabular-nums">${(x.amountCents / 100).toFixed(2)}</div>
                  {x.evidenceDueBy && <div className="text-[11px] text-[#f44] mt-0.5">Evidence due {new Date(x.evidenceDueBy).toLocaleDateString(undefined, { day: "numeric", month: "short" })}</div>}
                </div>
              </li>))}</ul>}
      </Card>

      <Card>
        <CardTitle>Stripe webhooks</CardTitle>
        {wh === null ? <p className="text-[13px] text-[#555] mt-3">Not set up (Dashboard migration 0035).</p> : (
          <div className="mt-3 flex flex-col gap-2 text-[13px]">
            <div className="flex justify-between"><span className="text-[#888]">Last event</span><span className={quiet ? "text-[#f5a623]" : "text-[#ddd]"}>{ago(wh.lastReceivedAt)}{wh.lastType ? ` · ${wh.lastType}` : ""}</span></div>
            <div className="flex justify-between"><span className="text-[#888]">Events, last 24 h</span><span className="text-[#ddd] tabular-nums">{wh.last24h}</span></div>
            <div className="flex justify-between"><span className="text-[#888]">Not finished (7 days)</span><span className={wh.stuck.length ? "text-[#f44] font-semibold" : "text-[#3ecf8e]"}>{wh.stuck.length || "None"}</span></div>
            {wh.stuck.slice(0, 4).map(s => <div key={s.event_id} className="text-[11px] text-[#666] truncate">{s.type} · {ago(s.received_at)} · {s.event_id}</div>)}
            {d.security && <>
              <div className="h-px bg-[#141414] my-1" />
              <div className="flex justify-between"><span className="text-[#888]">Failed sign-ins, 24 h</span><span className={d.security.failedLogins24h > 20 ? "text-[#f5a623]" : "text-[#ddd]"}>{d.security.failedLogins24h}</span></div>
              <div className="flex justify-between"><span className="text-[#888]">Password changes, 7 days</span><span className="text-[#ddd]">{d.security.passwordChanges7d}</span></div>
            </>}
          </div>
        )}
      </Card>

      <Card>
        <CardTitle>Email deliverability, 30 days</CardTitle>
        {d.deliverability.length === 0 ? <p className="text-[13px] text-[#555] mt-3">No emails sent in the last 30 days.</p> : (
          <table className="w-full text-[12px] mt-2">
            <thead><tr className="text-[#555] text-left"><th className="font-medium py-1">Type</th><th className="font-medium text-right">Sent</th><th className="font-medium text-right">Opened</th><th className="font-medium text-right">Bounced</th><th className="font-medium text-right">Spam</th></tr></thead>
            <tbody>{d.deliverability.slice(0, 10).map(r => (
              <tr key={r.type} className="border-t border-[#111]">
                <td className="py-1.5 text-[#ccc] truncate max-w-[140px]">{r.type.replace(/_/g, " ")}</td>
                <td className="text-right tabular-nums text-[#ddd]">{r.sent}</td>
                <td className="text-right tabular-nums text-[#0070f3]">{pct(r.opened, r.sent)}</td>
                <td className={`text-right tabular-nums ${r.bounced ? "text-[#f5a623]" : "text-[#555]"}`}>{r.bounced}</td>
                <td className={`text-right tabular-nums ${r.complained ? "text-[#f44]" : "text-[#555]"}`}>{r.complained}</td>
              </tr>))}</tbody>
          </table>
        )}
      </Card>
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
    <Card>
      <CardTitle>Recent unsubscribes</CardTitle>
      {rows === null ? <div className="skeleton h-16 rounded-lg mt-3" />
        : rows.length === 0 ? (
          <p className="text-[13px] text-[#555] mt-3">{pending ? "Starts recording once migration 0050 is applied." : "Nobody has unsubscribed yet."}</p>
        ) : (
          <ul className="divide-y divide-[#111] mt-2">
            {rows.map((u, i) => (
              <li key={i} className="py-2.5 flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="text-[13px] text-[#ddd] truncate">{u.name ?? "Unknown"} <span className="text-[#555]">· {u.email ?? "no email"}</span></div>
                  <div className="text-[12px] text-[#666] mt-0.5">
                    {u.method === "one_click" ? "Email app button" : "Email link"}{u.lastEmailType ? ` · after ${u.lastEmailType.replace(/_/g, " ")}` : ""}
                  </div>
                </div>
                <div className="shrink-0 text-right">
                  <div className="text-[12px] font-medium text-[#f5a623]">{UNSUB_SCOPE[u.scope] ?? u.scope}</div>
                  <div className="text-[11px] text-[#555] mt-0.5">{new Date(u.at).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</div>
                </div>
              </li>
            ))}
          </ul>
        )}
    </Card>
  );
}

// ─── FilterSelect ─────────────────────────────────────────────────────────────

function FilterSelect({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: { value: string; label: string }[] }) {
  return (
    <Select value={value} onChange={e => onChange(e.target.value)} leading={label}
      wrapperClassName="w-auto" className="h-8 rounded-lg text-[12px] font-medium text-[#bbb]">
      {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
    </Select>
  );
}
