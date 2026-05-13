// components/admin/analytics/RevenueSub.tsx
// ─────────────────────────────────────────────────────────────────────────────
// Revenue health — the only tab investors actually care about.
// ─────────────────────────────────────────────────────────────────────────────

"use client";

import { useMemo } from "react";
import { SL, Card, CardTitle, MetricCard, planColor } from "../admin/admin-shared";
import { SubProps } from "./analytics-types";
import {
  computeMRRMovement, computeRevenueRetention, computeARPU,
} from "./analytics-helpers";
import { Waterfall, LineChart } from "./analytics-charts";

export default function RevenueSub({ users, isMobile }: SubProps) {
  const mrr = useMemo(() => computeMRRMovement(users), [users]);
  const retention = useMemo(() => computeRevenueRetention(users), [users]);
  const arpu = useMemo(() => computeARPU(users), [users]);

  const fmtMoney = (v: number) =>
    `$${v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  // Build waterfall steps
  const waterfallSteps = [
    { label: "Start MRR",   value: mrr.startMRR, type: "start" as const },
    { label: "+ New",       value: mrr.newMRR,             type: "delta" as const },
    { label: "+ Expansion", value: mrr.expansionMRR,       type: "delta" as const },
    { label: "− Contract",  value: -mrr.contractionMRR,    type: "delta" as const },
    { label: "− Churn",     value: -mrr.churnedMRR,        type: "delta" as const },
    { label: "+ Reactiv.",  value: mrr.reactivationMRR,    type: "delta" as const },
    { label: "End MRR",     value: mrr.endMRR,             type: "end" as const },
  ];

  const treadmilling = mrr.churnPctOfNew > 50;

  return (
    <div className="flex flex-col gap-5">

      {/* ═══ KPI strip ═══ */}
      <section>
        <SL>Decision: where to invest next month — acquisition vs retention vs pricing</SL>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <MetricCard label="MRR" value={fmtMoney(mrr.endMRR)} color="#10B981"
            sub={`${mrr.netChange >= 0 ? "+" : ""}${fmtMoney(mrr.netChange)} MoM`} />
          <MetricCard label="New MRR" value={fmtMoney(mrr.newMRR)} color="#3B82F6"
            sub="From new paying users" />
          <MetricCard label="Churned MRR" value={fmtMoney(mrr.churnedMRR)} color="#EF4444"
            sub={`${mrr.churnPctOfNew}% of new MRR`} />
          <MetricCard label="ARR (run rate)" value={fmtMoney(mrr.endMRR * 12)} color="#8B5CF6"
            sub="MRR × 12" />
        </div>
        {treadmilling && (
          <div className="mt-3 px-3 py-2.5 bg-amber-50 border border-amber-200 rounded-lg flex items-start gap-2.5">
            <svg width="14" height="14" fill="none" stroke="#D97706" strokeWidth="2" viewBox="0 0 24 24" className="shrink-0 mt-0.5">
              <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
              <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
            </svg>
            <div className="flex-1 text-[11px] text-amber-900">
              <strong>Treadmill alert:</strong> churned MRR is over 50% of new MRR. You&apos;re running to stand still. Prioritise retention work over acquisition.
            </div>
          </div>
        )}
      </section>

      {/* ═══ MRR waterfall ═══ */}
      <section>
        <SL>Decision: which lever is moving the business this month</SL>
        <Card>
          <div className="flex items-baseline justify-between mb-3 flex-wrap gap-1">
            <CardTitle>MRR movement this month</CardTitle>
            <span className="text-[10px] text-gray-400">Green: growth · Red: loss · Gray: totals</span>
          </div>
          <Waterfall steps={waterfallSteps} height={isMobile ? 220 : 280} format={fmtMoney} />
          {(mrr.expansionMRR === 0 && mrr.contractionMRR === 0) && (
            <p className="text-[10px] text-gray-400 mt-3">
              <span className="font-semibold">Note:</span> expansion and contraction are 0 because plan-change events aren&apos;t logged separately yet.
              Wire up a Stripe webhook to record plan transitions for full movement attribution.
            </p>
          )}
        </Card>
      </section>

      {/* ═══ Cohort revenue retention ═══ */}
      <section>
        <SL>Decision: is the product getting stickier — or is this month&apos;s churn the new normal</SL>
        <Card>
          <div className="flex items-baseline justify-between mb-3 flex-wrap gap-1">
            <CardTitle>Net & gross revenue retention by cohort</CardTitle>
            <span className="text-[10px] text-gray-400">NRR &gt; 100% = expansion outpaces churn (investor metric)</span>
          </div>
          {retention.length === 0 ? (
            <div className="text-xs text-gray-400 py-8 text-center">
              No paying cohorts yet — chart will populate as your subscription history grows.
            </div>
          ) : (
            <LineChart
              labels={retention.map(r => r.cohortLabel)}
              height={isMobile ? 220 : 280}
              showLegend
              yFormat={(v) => `${v}%`}
              referenceLine={{ y: 100, label: "100% (break-even)", color: "#9CA3AF" }}
              series={[
                { label: "GRR (gross)", data: retention.map(r => r.grr), color: "#F59E0B" },
                { label: "NRR (net)",   data: retention.map(r => r.nrr), color: "#10B981" },
              ]}
            />
          )}
        </Card>
      </section>

      {/* ═══ ARPU by plan ═══ */}
      <section>
        <SL>Decision: are coupons eroding revenue or pulling in customers who&apos;d otherwise leave</SL>
        <Card>
          <CardTitle>ARPU by plan</CardTitle>
          <div className="flex flex-col gap-2">
            {arpu.filter(a => a.plan !== "free").map(a => {
              const erosion = a.listPrice > 0 ? ((a.listPrice - a.estimatedARPU) / a.listPrice) * 100 : 0;
              const pc = planColor(a.plan);
              return (
                <div key={a.plan} className="flex items-center gap-3 py-2.5 border-b border-gray-50 last:border-0">
                  <div className={`text-xs font-bold capitalize w-20 shrink-0 px-2 py-0.5 rounded text-center border ${pc.tw}`}>{a.plan}</div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline gap-2">
                      <span className="text-base font-extrabold text-gray-900">{fmtMoney(a.estimatedARPU)}</span>
                      <span className="text-[10px] text-gray-400">list {fmtMoney(a.listPrice)}</span>
                    </div>
                    <div className="text-[10px] text-gray-400 mt-0.5">
                      {a.count} users · {a.couponedCount} on coupon ({a.couponPct.toFixed(0)}%)
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className={`text-xs font-bold ${erosion > 10 ? "text-rose-500" : "text-gray-600"}`}>
                      −{erosion.toFixed(1)}%
                    </div>
                    <div className="text-[10px] text-gray-400">vs list price</div>
                  </div>
                </div>
              );
            })}
          </div>
          <p className="text-[10px] text-gray-400 mt-3">
            <span className="font-semibold">Note:</span> ARPU assumes a flat 20% off for couponed users.
            Log actual discount amounts from Stripe to refine.
          </p>
        </Card>
      </section>

      {/* ═══ Plan mix ═══ */}
      <section>
        <SL>Plan mix</SL>
        <Card>
          <CardTitle>Where the revenue comes from</CardTitle>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            {arpu.filter(a => a.listPrice > 0).map(a => {
              const planRev = a.estimatedARPU * a.count;
              const totalRev = arpu.reduce((s, x) => s + x.estimatedARPU * x.count, 0);
              const sharePct = totalRev > 0 ? (planRev / totalRev) * 100 : 0;
              const pc = planColor(a.plan);
              return (
                <div key={a.plan} className="bg-gray-50 rounded-lg p-3 border border-gray-100">
                  <div className={`inline-block text-[10px] font-bold uppercase px-2 py-0.5 rounded border ${pc.tw} mb-2`}>{a.plan}</div>
                  <div className="text-xl font-extrabold text-gray-900">{fmtMoney(planRev)}</div>
                  <div className="text-[11px] text-gray-500 mt-0.5">{sharePct.toFixed(0)}% of revenue · {a.count} users</div>
                </div>
              );
            })}
          </div>
        </Card>
      </section>

    </div>
  );
}