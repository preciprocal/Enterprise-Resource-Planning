// components/admin/OverviewTab.tsx
"use client";
import { useState, useCallback, useEffect, useMemo } from "react";
import {
  AnalyticsData, User, USAGE_FIELDS,
  MetricCard, HBar, Donut, BarChart, SL, Card, CardTitle, Spinner, useIsMobile,
} from "./admin-shared";

// Filter state types
type TimeRange = "1" | "7" | "30" | "90";
type DeviceType = "all" | "desktop" | "mobile" | "tablet" | "other";

// Cloudflare common country codes — shown in the dropdown if no countries
// are available yet from a previous load. Once a load completes, the dropdown
// populates from the actual `countries` array in the response.
const COMMON_COUNTRIES: { code: string; name: string }[] = [
  { code: "US", name: "United States" }, { code: "GB", name: "United Kingdom" },
  { code: "IN", name: "India"          }, { code: "CA", name: "Canada"         },
  { code: "AU", name: "Australia"      }, { code: "DE", name: "Germany"        },
  { code: "FR", name: "France"         }, { code: "BR", name: "Brazil"         },
  { code: "JP", name: "Japan"          }, { code: "SG", name: "Singapore"      },
];

interface CFSummary {
  visitors:    number | null;
  requests:    number | null;
  bandwidth:   string;
  cacheRate:   number | null;
  adaptive:    boolean;
  visits:      number;
}

interface Props { analytics: AnalyticsData | null; users: User[]; loading: boolean; token?: string; }

function fmtBytes(b = 0) {
  if (b >= 1e9) return `${(b/1e9).toFixed(1)}GB`;
  if (b >= 1e6) return `${(b/1e6).toFixed(0)}MB`;
  return `${(b/1e3).toFixed(0)}KB`;
}
function fmtNum(n = 0) {
  if (n >= 1e6) return `${(n/1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n/1e3).toFixed(1)}k`;
  return String(n);
}

export default function OverviewTab({ analytics, users, loading, token = "" }: Props) {
  const isMobile = useIsMobile();
  const [cf,      setCf]      = useState<CFSummary | null>(null);
  const [cfLoading, setCfLoad] = useState(false);
  const [cfErr,   setCfErr]   = useState("");
  const [availableCountries, setAvailableCountries] = useState<{ code: string; name: string }[]>([]);

  // ── Filter state ──────────────────────────────────────────────────────────
  const [fltDays,    setFltDays]    = useState<TimeRange>("7");
  const [fltCountry, setFltCountry] = useState<string>("all");   // "all" or ISO-2
  const [fltDevice,  setFltDevice]  = useState<DeviceType>("all");

  const timeLabel = useMemo(() => ({
    "1":  "Last 24 hours",
    "7":  "Last 7 days",
    "30": "Last 30 days",
    "90": "Last 90 days",
  }[fltDays]), [fltDays]);

  // Country dropdown options: union of common ISO-2 codes + whatever the API
  // has actually seen on this zone. Dedupe by code.
  const countryOptions = useMemo(() => {
    const map = new Map<string, string>();
    COMMON_COUNTRIES.forEach(c => map.set(c.code, c.name));
    availableCountries.forEach(c => { if (c.code) map.set(c.code, c.name); });
    return Array.from(map.entries())
      .map(([code, name]) => ({ code, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [availableCountries]);

  const loadCF = useCallback(() => {
    // Wrapped in queueMicrotask so the synchronous setLoad/setErr calls don't
    // fire inside the useEffect body — React 19's strict-effect rule flags
    // synchronous setState from an effect as "cascading renders".
    queueMicrotask(() => {
      setCfLoad(true);
      setCfErr("");

      const params = new URLSearchParams({ days: fltDays });
      if (fltCountry !== "all") params.set("country", fltCountry);
      if (fltDevice  !== "all") params.set("device",  fltDevice);

      fetch(`/api/cloudflare?${params.toString()}`, {
        headers: token ? { "x-admin-secret": token } : {},
      })
        .then(r => r.json() as Promise<{
          adaptive?: boolean;
          daily?: { sum?: { visits?: number | null; bytes?: number | null; cachedBytes?: number | null; requests?: number | null } }[];
          totals?: {
            uniqueVisitors: number | null;
            requests:       number | null;
            bytes:          number;
            cachedBytes:    number | null;
            cacheRate:      number | null;
            visits?:        number;
          } | null;
          countries?: { clientCountryName: string; requests: number; bytes: number }[];
          error?: string;
        }>)
        .then(json => {
          if (json.error) throw new Error(json.error);
          const t = json.totals;
          if (!t) {
            setCf(null);
            setCfLoad(false);
            return;
          }
          setCf({
            visitors:  t.uniqueVisitors,
            requests:  t.requests,
            bandwidth: fmtBytes(t.bytes ?? 0),
            cacheRate: t.cacheRate,
            adaptive:  !!json.adaptive,
            visits:    t.visits ?? 0,
          });

          // Capture the country list so future filter dropdowns include what
          // this zone has actually seen, not just the hard-coded common set.
          if (json.countries && json.countries.length > 0) {
            setAvailableCountries(
              json.countries.map(c => ({ code: c.clientCountryName, name: c.clientCountryName }))
            );
          }
          setCfLoad(false);
        })
        .catch((e: Error) => { setCfErr(e.message); setCfLoad(false); });
    });
  }, [token, fltDays, fltCountry, fltDevice]);

  // Refetch when filters change
  useEffect(() => { loadCF(); }, [loadCF]);

  if (loading) return <Spinner />;
  if (!analytics) return <div className="flex-1 flex items-center justify-center text-sm text-gray-400">No data — click Refresh.</div>;

  const provColors = ["#6366F1","#10B981","#F59E0B","#F43F5E","#0EA5E9"];

  return (
    <div className="flex-1 overflow-auto p-4 md:p-7 flex flex-col gap-5">

      {/* User Health */}
      <section>
        <SL>User Health</SL>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-2">
          <MetricCard label="Total Users"    value={analytics.total}               color="#6366F1" />
          <MetricCard label="New This Month" value={analytics.newThisMonth}        color={analytics.growthDelta>=0?"#16A34A":"#DC2626"} sub={`${analytics.growthDelta>=0?"+":""}${analytics.growthDelta}% vs last mo`} />
          <MetricCard label="Pro"            value={analytics.planCounts.pro}      color="#3B82F6" />
          <MetricCard label="Premium"        value={analytics.planCounts.premium}  color="#F59E0B" />
          <MetricCard label="Stripe Active"  value={analytics.stripeCount}         color="#10B981" />
          <MetricCard label="Canceled"       value={analytics.canceledCount}       color="#F43F5E" />
        </div>
      </section>

      {/* Cloudflare traffic strip */}
      <section>
        <div className="flex items-center justify-between mb-2.5 flex-wrap gap-2">
          <div className="flex items-baseline gap-2">
            <SL>Website Traffic · {timeLabel}</SL>
            {(fltCountry !== "all" || fltDevice !== "all") && (
              <span className="text-[10px] text-gray-400">
                · filtered{fltCountry !== "all" ? ` · ${fltCountry}` : ""}{fltDevice !== "all" ? ` · ${fltDevice}` : ""}
              </span>
            )}
          </div>
          {cfErr && (
            <span className="text-[10px] text-amber-500 font-medium" title={cfErr}>
              ⚠ Cloudflare data unavailable
            </span>
          )}
        </div>

        {/* Filter row — three dropdowns above the panel */}
        <div className="flex flex-wrap gap-2 mb-3">
          <FilterSelect
            label="Time"
            value={fltDays}
            onChange={(v) => setFltDays(v as TimeRange)}
            options={[
              { value: "1",  label: "Last 24 hours" },
              { value: "7",  label: "Last 7 days"   },
              { value: "30", label: "Last 30 days"  },
              { value: "90", label: "Last 90 days"  },
            ]}
          />
          <FilterSelect
            label="Country"
            value={fltCountry}
            onChange={setFltCountry}
            options={[
              { value: "all", label: "All countries" },
              ...countryOptions.map(c => ({ value: c.code, label: `${c.code} — ${c.name}` })),
            ]}
          />
          <FilterSelect
            label="Device"
            value={fltDevice}
            onChange={(v) => setFltDevice(v as DeviceType)}
            options={[
              { value: "all",     label: "All devices" },
              { value: "desktop", label: "Desktop"     },
              { value: "mobile",  label: "Mobile"      },
              { value: "tablet",  label: "Tablet"      },
              { value: "other",   label: "Other"       },
            ]}
          />
          {(fltCountry !== "all" || fltDevice !== "all" || fltDays !== "7") && (
            <button
              onClick={() => { setFltDays("7"); setFltCountry("all"); setFltDevice("all"); }}
              className="text-[11px] text-gray-500 hover:text-gray-700 px-2.5 py-1.5 rounded-lg border border-gray-100 bg-white hover:bg-gray-50 transition-colors"
              type="button"
            >
              Reset
            </button>
          )}
        </div>

        {cfLoading ? (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            {[1,2,3,4].map(i => <div key={i} className="bg-white border border-gray-100 rounded-xl p-4 h-20 animate-pulse" />)}
          </div>
        ) : cf ? (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            {cf.adaptive ? (
              // Device filter is active — adaptive dataset, no uniques/cache/requests
              <>
                <MetricCard label="Visits"          value={fmtNum(cf.visits)} color="#F6821F" sub={`Device: ${fltDevice}`} />
                <MetricCard label="Bandwidth"       value={cf.bandwidth}      color="#8B5CF6" sub="Data served" />
                <MetricCard label="Unique Visitors" value="—"                 color="#9CA3AF" sub="N/A with device filter" />
                <MetricCard label="Cache Rate"      value="—"                 color="#9CA3AF" sub="N/A with device filter" />
              </>
            ) : (
              <>
                <MetricCard label="Unique Visitors" value={fmtNum(cf.visitors ?? 0)} color="#F6821F" sub={fltCountry !== "all" ? `Country: ${fltCountry}` : "preciprocal.com"} />
                <MetricCard label="Total Requests"  value={fmtNum(cf.requests ?? 0)} color="#6366F1" sub="HTTP requests" />
                <MetricCard label="Bandwidth"       value={cf.bandwidth}             color="#8B5CF6" sub="Data served" />
                <MetricCard
                  label="Cache Rate"
                  value={cf.cacheRate !== null ? `${cf.cacheRate}%` : "—"}
                  color={(cf.cacheRate ?? 0) > 50 ? "#10B981" : "#F59E0B"}
                  sub={(cf.cacheRate ?? 0) > 50 ? "Good caching" : "Could improve"}
                />
              </>
            )}
          </div>
        ) : !cfErr ? (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            {[1,2,3,4].map(i => <div key={i} className="bg-white border border-gray-100 rounded-xl p-4 h-20 animate-pulse" />)}
          </div>
        ) : (
          <div className="px-4 py-3 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-700">
            <div className="font-semibold mb-1">Cloudflare traffic data unavailable</div>
            <div className="text-[11px] text-amber-700/80 break-words font-mono">{cfErr}</div>
            <div className="text-[11px] text-amber-700/60 mt-2">
              Required in <code className="bg-amber-100 px-1 rounded">.env</code>:{" "}
              <code className="bg-amber-100 px-1 rounded">CLOUDFLARE_API_TOKEN</code> and{" "}
              <code className="bg-amber-100 px-1 rounded">CLOUDFLARE_ZONE_ID</code>. Restart the dev server after editing.
            </div>
          </div>
        )}
      </section>

      {/* Engagement */}
      <section>
        <SL>Engagement</SL>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          <MetricCard label="Active Users"   value={analytics.activeThisMonth}       color="#0EA5E9" sub="Used ≥1 feature" />
          <MetricCard label="Power Users"    value={analytics.powerUsers}            color="#8B5CF6" sub=">10 actions" />
          <MetricCard label="Dormant"        value={analytics.dormant}               color="#F97316" sub="Zero usage" />
          <MetricCard label="Conversion"     value={`${analytics.conversionRate}%`}  color="#10B981" sub="Free → paid" />
        </div>
      </section>

      {/* Trends */}
      <section>
        <SL>Trends & Distribution</SL>
        <div className="flex flex-col gap-3">
          <Card>
            <CardTitle>Monthly Signups</CardTitle>
            <BarChart data={analytics.signupArr.map(m=>({l:m.label,v:m.count}))} color="#6366F1" h={isMobile?65:90} />
          </Card>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Card>
              <CardTitle>Plan Distribution</CardTitle>
              <div className="flex items-center gap-4">
                <Donut segments={analytics.planSegments} size={76} label={String(analytics.total)} />
                <div className="flex-1 min-w-0">
                  {analytics.planSegments.map(s => (
                    <div key={s.label} className="flex items-center gap-2 mb-2">
                      <div className="w-2 h-2 rounded-full shrink-0" style={{ background:s.color }} />
                      <span className="text-xs text-gray-500 flex-1 min-w-0">{s.label}</span>
                      <span className="text-[13px] font-bold text-gray-900 shrink-0">{s.value}</span>
                      <span className="text-[10px] text-gray-400 shrink-0 w-7 text-right">{analytics.total?Math.round(s.value/analytics.total*100):0}%</span>
                    </div>
                  ))}
                </div>
              </div>
            </Card>
            <Card>
              <CardTitle>Sign-in Providers</CardTitle>
              <div className="flex flex-col gap-2.5">
                {Object.entries(analytics.providers).sort((a,b)=>b[1]-a[1]).map(([prov,count],i) => {
                  const pct = analytics.total ? Math.round(count/analytics.total*100) : 0;
                  return (
                    <div key={prov}>
                      <div className="flex justify-between items-center mb-1">
                        <span className="text-xs text-gray-700 font-medium capitalize">{prov}</span>
                        <span className="text-xs font-bold text-gray-900">{count} <span className="text-gray-400 font-normal">({pct}%)</span></span>
                      </div>
                      <HBar pct={pct} color={provColors[i%provColors.length]} />
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
                ["Active Paid",analytics.planCounts.pro+analytics.planCounts.premium,"#16A34A","bg-green-50","border-green-200"],
                ["Free Tier",analytics.planCounts.free,"#6B7280","bg-gray-50","border-gray-200"],
                ["Canceled",analytics.canceledCount,"#F43F5E","bg-rose-50","border-rose-200"],
                ["Has Stripe",analytics.stripeCount,"#6366F1","bg-indigo-50","border-indigo-200"],
              ] as [string,number,string,string,string][]).map(([l,v,c,bg,bo])=>(
                <div key={l} className={`flex items-center gap-3 px-3.5 py-2.5 ${bg} border ${bo} rounded-lg`}>
                  <span className="flex-1 text-[13px] text-gray-700 font-medium">{l}</span>
                  <span className="text-xl font-extrabold tracking-tight" style={{color:c}}>{v}</span>
                </div>
              ))}
            </div>
            <div className="p-4 bg-gradient-to-br from-green-50 to-green-100 border border-green-300 rounded-xl">
              <div className="text-[10px] text-green-700 font-bold uppercase tracking-wider mb-1">Conversion Rate</div>
              <div className="text-4xl font-black text-green-800 tracking-tighter leading-none">{analytics.conversionRate}%</div>
              <div className="text-xs text-green-700 mt-1">Free → Paid · Est. MRR <strong>${analytics.revenue.toFixed(2)}</strong></div>
            </div>
          </Card>
          <Card>
            <div className="flex items-baseline justify-between mb-3 flex-wrap gap-1">
              <CardTitle>Feature Adoption</CardTitle>
              <span className="text-[11px] text-gray-400">{analytics.totalUsage} total actions</span>
            </div>
            <div className="flex flex-col">
              {analytics.featureRank.map(f => {
                const uf=USAGE_FIELDS.find(u=>u.label===f.label);
                const pct=Math.round(f.value/analytics.maxFeature*100);
                const col=uf?.color??"#6366F1";
                return (
                  <div key={f.label} className="flex items-center gap-2 py-1.5 border-b border-gray-50">
                    <span className="text-[11px] text-gray-700 font-medium shrink-0 w-24 truncate">{f.label}</span>
                    <HBar pct={pct} color={col} />
                    <span className="text-xs font-bold text-gray-900 shrink-0 w-7 text-right">{f.value}</span>
                  </div>
                );
              })}
            </div>
          </Card>
        </div>
      </section>

    </div>
  );
}
// ─── FilterSelect ─────────────────────────────────────────────────────────────
// Compact native <select> styled to match the dashboard's neutral palette.
// Native select wins here over a custom dropdown for: (a) free a11y, (b) free
// keyboard behaviour, (c) mobile picker, (d) zero JS for the open/close logic.

function FilterSelect({
  label, value, onChange, options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <label className="flex items-center gap-1.5 bg-white border border-gray-100 rounded-lg pl-2.5 pr-1 py-1 cursor-pointer hover:border-gray-200 transition-colors">
      <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="text-[11px] font-semibold text-gray-700 bg-transparent border-none outline-none cursor-pointer pr-1"
      >
        {options.map(o => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </label>
  );
}