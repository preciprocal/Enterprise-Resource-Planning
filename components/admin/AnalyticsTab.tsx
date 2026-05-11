// components/admin/AnalyticsTab.tsx
"use client";
import {
  AnalyticsData, User, USAGE_FIELDS,
  MetricCard, HBar, Donut, BarChart, SL, Card, CardTitle, Spinner, useIsMobile,
} from "./admin-shared";
interface Props { analytics: AnalyticsData | null; users: User[]; loading: boolean; }
export default function AnalyticsTab({ analytics, users, loading }: Props) {
  const isMobile = useIsMobile();
  if (loading) return <Spinner />;
  if (!analytics) return <div className="flex-1 flex items-center justify-center text-sm text-gray-400">No data — click Refresh.</div>;
  const provColors = ["#6366F1","#10B981","#F59E0B","#F43F5E","#0EA5E9"];
  return (
    <div className="flex-1 overflow-auto p-4 md:p-7 flex flex-col gap-5">
      <section>
        <SL>Key Metrics</SL>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          <MetricCard label="Total Users"    value={analytics.total}                                        color="#6366F1" sub={`+${analytics.newThisMonth} this month`} />
          <MetricCard label="Paying Users"   value={analytics.planCounts.pro+analytics.planCounts.premium}  color="#F59E0B" sub={`${analytics.conversionRate}% conversion`} />
          <MetricCard label="Est. MRR"       value={`$${analytics.revenue.toFixed(0)}`}                    color="#10B981" sub={`${analytics.growthDelta>=0?"+":""}${analytics.growthDelta}% growth`} />
          <MetricCard label="Avg Usage/User" value={analytics.avgUsage}                                     color="#8B5CF6" sub="Actions per account" />
        </div>
      </section>
      <section>
        <SL>User Growth</SL>
        <Card>
          <CardTitle>Monthly Signups</CardTitle>
          <BarChart data={analytics.signupArr.map(m=>({l:m.label,v:m.count}))} color="#6366F1" h={isMobile?65:100} />
        </Card>
      </section>
      <section>
        <SL>Distribution</SL>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Card>
            <CardTitle>Plan Split</CardTitle>
            <div className="flex items-center gap-4">
              <Donut segments={analytics.planSegments} size={76} label={String(analytics.total)} />
              <div className="flex-1 min-w-0">
                {analytics.planSegments.map(s=>(
                  <div key={s.label} className="flex items-center gap-2 mb-2">
                    <div className="w-2 h-2 rounded-full shrink-0" style={{background:s.color}} />
                    <span className="text-xs text-gray-500 flex-1">{s.label}</span>
                    <span className="text-[13px] font-bold text-gray-900 shrink-0">{s.value}</span>
                    <span className="text-[10px] text-gray-400 shrink-0 w-7 text-right">{analytics.total?Math.round(s.value/analytics.total*100):0}%</span>
                  </div>
                ))}
              </div>
            </div>
          </Card>
          <Card>
            <CardTitle>Auth Providers</CardTitle>
            <div className="flex flex-col gap-2.5">
              {Object.entries(analytics.providers).sort((a,b)=>b[1]-a[1]).map(([prov,count],i)=>{
                const pct=analytics.total?Math.round(count/analytics.total*100):0;
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
      </section>
      <section>
        <SL>Feature Adoption</SL>
        <Card>
          <div className="flex items-baseline justify-between mb-4 flex-wrap gap-1">
            <CardTitle>Usage by Feature</CardTitle>
            <span className="text-[11px] text-gray-400">{analytics.totalUsage} total actions</span>
          </div>
          <div className="flex flex-col">
            {analytics.featureRank.map(f=>{
              const uf=USAGE_FIELDS.find(u=>u.label===f.label);
              const pct=Math.round(f.value/analytics.maxFeature*100);
              const adopters=uf?users.filter(u=>((u.usage?.[uf.key] as number)??0)>0).length:0;
              const ar=analytics.total?Math.round(adopters/analytics.total*100):0;
              const col=uf?.color??"#6366F1";
              return (
                <div key={f.label} className="flex items-center gap-2 md:gap-3 py-2 border-b border-gray-50">
                  <span className="text-[11px] md:text-xs text-gray-700 font-medium shrink-0 w-20 md:w-24 truncate">{f.label}</span>
                  <HBar pct={pct} color={col} />
                  <span className="text-xs font-bold text-gray-900 shrink-0 w-7 text-right">{f.value}</span>
                  {!isMobile&&<span className="text-[11px] font-bold shrink-0 w-9 text-right" style={{color:col}}>{ar}%</span>}
                </div>
              );
            })}
          </div>
        </Card>
      </section>
      <section>
        <SL>Engagement Segments</SL>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {([["Power Users",analytics.powerUsers,"#8B5CF6","More than 10 feature actions"],["Active Users",analytics.activeThisMonth-analytics.powerUsers,"#0EA5E9","At least 1 feature action"],["Dormant",analytics.dormant,"#F97316","Never used any feature"]] as [string,number,string,string][]).map(([l,v,c,sub])=>{
            const pct=analytics.total?Math.round(v/analytics.total*100):0;
            return (
              <div key={l} className="bg-white border border-gray-100 rounded-xl p-4">
                <div className="flex items-center justify-between mb-2">
                  <div>
                    <div className="text-xs font-bold text-gray-700">{l}</div>
                    <div className="text-[10px] text-gray-400 mt-0.5">{sub}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-2xl font-black tracking-tight leading-none" style={{color:c}}>{v}</div>
                    <div className="text-[11px] font-bold mt-0.5" style={{color:c}}>{pct}%</div>
                  </div>
                </div>
                <HBar pct={pct} color={c} height={4} />
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}