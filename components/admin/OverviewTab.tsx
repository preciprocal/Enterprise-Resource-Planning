// components/admin/OverviewTab.tsx
"use client";
import {
  AnalyticsData, User, USAGE_FIELDS,
  MetricCard, HBar, Donut, BarChart, SL, Card, CardTitle, Spinner, useIsMobile,
} from "./admin-shared";
interface Props { analytics: AnalyticsData | null; users: User[]; loading: boolean; }
export default function OverviewTab({ analytics, users, loading }: Props) {
  const isMobile = useIsMobile();
  if (loading) return <Spinner />;
  if (!analytics) return <div className="flex-1 flex items-center justify-center text-sm text-gray-400">No data — click Refresh.</div>;
  const provColors = ["#6366F1","#10B981","#F59E0B","#F43F5E","#0EA5E9"];
  return (
    <div className="flex-1 overflow-auto p-4 md:p-7 flex flex-col gap-5">
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
      <section>
        <SL>Engagement</SL>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          <MetricCard label="Active Users"   value={analytics.activeThisMonth}       color="#0EA5E9" sub="Used ≥1 feature" />
          <MetricCard label="Power Users"    value={analytics.powerUsers}            color="#8B5CF6" sub=">10 actions" />
          <MetricCard label="Dormant"        value={analytics.dormant}               color="#F97316" sub="Zero usage" />
          <MetricCard label="Conversion"     value={`${analytics.conversionRate}%`}  color="#10B981" sub="Free → paid" />
        </div>
      </section>
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
      <section>
        <SL>Feature Adoption & Revenue</SL>
        <div className="flex flex-col gap-3">
          <Card>
            <div className="flex items-baseline justify-between mb-3 flex-wrap gap-1">
              <CardTitle>Feature Adoption</CardTitle>
              <span className="text-[11px] text-gray-400">{analytics.totalUsage} total actions</span>
            </div>
            <div className="flex flex-col">
              {analytics.featureRank.map(f => {
                const uf=USAGE_FIELDS.find(u=>u.label===f.label);
                const pct=Math.round(f.value/analytics.maxFeature*100);
                const adopters=uf?users.filter(u=>((u.usage?.[uf.key] as number)??0)>0).length:0;
                const ar=analytics.total?Math.round(adopters/analytics.total*100):0;
                const col=uf?.color??"#6366F1";
                return (
                  <div key={f.label} className="flex items-center gap-2 py-2 border-b border-gray-50">
                    <span className="text-[11px] md:text-xs text-gray-700 font-medium shrink-0 w-20 md:w-24 truncate">{f.label}</span>
                    <HBar pct={pct} color={col} />
                    <span className="text-xs font-bold text-gray-900 shrink-0 w-7 text-right">{f.value}</span>
                    {!isMobile && <span className="text-[11px] font-bold shrink-0 w-9 text-right" style={{color:col}}>{ar}%</span>}
                  </div>
                );
              })}
            </div>
          </Card>
          <Card>
            <CardTitle>Revenue Overview</CardTitle>
            <div className="flex flex-col gap-2 mb-3">
              {([["Active Paid",analytics.planCounts.pro+analytics.planCounts.premium,"#16A34A","bg-green-50","border-green-200"],["Free Tier",analytics.planCounts.free,"#6B7280","bg-gray-50","border-gray-200"],["Canceled",analytics.canceledCount,"#F43F5E","bg-rose-50","border-rose-200"],["Has Stripe",analytics.stripeCount,"#6366F1","bg-indigo-50","border-indigo-200"]] as [string,number,string,string,string][]).map(([l,v,c,bg,bo])=>(
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
        </div>
      </section>
    </div>
  );
}