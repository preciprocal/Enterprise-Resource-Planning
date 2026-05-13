// components/admin/analytics/OverviewSub.tsx
// ─────────────────────────────────────────────────────────────────────────────
// Decision-first overview. The anomaly digest is the hero — it tells the
// admin what to look at first instead of forcing them to hunt.
// ─────────────────────────────────────────────────────────────────────────────

"use client";

import { useMemo } from "react";
import { SL, Card, CardTitle, MetricCard } from "../admin/admin-shared";
import { SubProps } from "./analytics-types";
import {
  computeAnomalies, computeSignupVelocity, computeMRRMovement,
  computeChurnRisk, computeActivationFunnel,
} from "./analytics-helpers";
import { LineChart, Sparkline } from "./analytics-charts";

export default function OverviewSub({ users, data, isMobile }: SubProps) {
  // ── Anomaly digest ──────────────────────────────────────────────────────────
  const anomalies = useMemo(() => computeAnomalies(users, data), [users, data]);

  // ── Top-line KPIs ───────────────────────────────────────────────────────────
  const mrr = useMemo(() => computeMRRMovement(users), [users]);
  const risk = useMemo(() => computeChurnRisk(users, data), [users, data]);
  const funnel = useMemo(() => computeActivationFunnel(users, data), [users, data]);
  const velocity = useMemo(() => computeSignupVelocity(users, 60), [users]);

  const highRisk = risk.filter(r => r.band === "high").length;
  const activationRate = funnel[1]?.pctOfStart ?? 0;
  const conversionRate = funnel.length > 0 ? (funnel[funnel.length - 1]?.count / Math.max(funnel[0]?.count, 1)) * 100 : 0;

  const fmtMoney = (v: number) => `$${v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  return (
    <div className="flex flex-col gap-5">

      {/* ═══ Anomaly digest — the most important panel on the dashboard ═══ */}
      <section>
        <SL>What changed this week</SL>
        <Card>
          <div className="flex items-baseline justify-between mb-3">
            <CardTitle>This week vs last week</CardTitle>
            <span className="text-[10px] text-gray-400">Top 5 movers by % change</span>
          </div>
          <div className="flex flex-col">
            {anomalies.length === 0 && (
              <div className="text-xs text-gray-400 py-6 text-center">Not enough data yet for week-over-week comparison.</div>
            )}
            {anomalies.map(a => (
              <div key={a.metric} className="flex items-center gap-3 py-2.5 border-b border-gray-50 last:border-0">
                <div className={`w-1 h-8 rounded shrink-0`} style={{ background: a.good ? "#10B981" : "#EF4444" }} />
                <div className="flex-1 min-w-0">
                  <div className="text-[13px] font-semibold text-gray-900 truncate">{a.metric}</div>
                  <div className="text-[10px] text-gray-400 mt-0.5">
                    <span className="font-semibold text-gray-700">{a.current.toLocaleString()}</span>
                    <span className="mx-1.5">vs</span>
                    {a.prior.toLocaleString()} last week
                  </div>
                </div>
                {a.sparkline.length > 0 && (
                  <div className="shrink-0 hidden sm:block">
                    <Sparkline data={a.sparkline} color={a.good ? "#10B981" : "#EF4444"} />
                  </div>
                )}
                <div className="shrink-0 text-right">
                  <div className="text-base font-extrabold leading-none" style={{ color: a.good ? "#10B981" : "#EF4444" }}>
                    {a.deltaPct > 0 ? "+" : ""}{a.deltaPct}%
                  </div>
                </div>
              </div>
            ))}
          </div>
        </Card>
      </section>

      {/* ═══ Headline KPIs ═══ */}
      <section>
        <SL>Decision: which area needs attention right now</SL>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <MetricCard
            label="Current MRR"
            value={fmtMoney(mrr.endMRR)}
            color="#10B981"
            sub={`Net ${mrr.netChange >= 0 ? "+" : ""}${fmtMoney(mrr.netChange)} this month`}
          />
          <MetricCard
            label="Activation rate"
            value={`${activationRate.toFixed(1)}%`}
            color={activationRate >= 40 ? "#10B981" : activationRate >= 25 ? "#F59E0B" : "#EF4444"}
            sub="Signup → first session in 24h"
          />
          <MetricCard
            label="Free → paid"
            value={`${conversionRate.toFixed(1)}%`}
            color={conversionRate >= 5 ? "#10B981" : conversionRate >= 2 ? "#F59E0B" : "#EF4444"}
            sub="Signup → paid within window"
          />
          <MetricCard
            label="High-risk users"
            value={highRisk}
            color={highRisk > 5 ? "#EF4444" : highRisk > 0 ? "#F59E0B" : "#10B981"}
            sub="Score ≥ 60 — contact this week"
          />
        </div>
      </section>

      {/* ═══ Signup velocity ═══ */}
      <section>
        <SL>Decision: is acquisition accelerating or stalling</SL>
        <Card>
          <div className="flex items-baseline justify-between mb-3 flex-wrap gap-1">
            <CardTitle>Signups over time</CardTitle>
            <span className="text-[10px] text-gray-400">Daily + 7-day & 28-day moving averages</span>
          </div>
          <LineChart
            labels={velocity.map(v => v.date.slice(5))}
            height={isMobile ? 200 : 260}
            showLegend
            series={[
              { label: "Daily",   data: velocity.map(v => v.signups), color: "#E5E7EB" },
              { label: "7-day MA", data: velocity.map(v => v.ma7),     color: "#6366F1" },
              { label: "28-day MA", data: velocity.map(v => v.ma28),   color: "#8B5CF6", dashed: true },
            ]}
          />
        </Card>
      </section>

      {/* ═══ Activation funnel snapshot ═══ */}
      <section>
        <SL>Decision: where to focus onboarding work</SL>
        <Card>
          <CardTitle>Activation funnel</CardTitle>
          <div className="flex flex-col gap-2">
            {funnel.map((s, i) => {
              const widthPct = s.pctOfStart;
              const dropPct = i > 0 ? 100 - (funnel[i].count / funnel[i - 1].count) * 100 : 0;
              const isBigDrop = dropPct > 60;
              return (
                <div key={s.label}>
                  <div className="flex items-center gap-3">
                    <div className="text-[11px] text-gray-500 font-medium w-44 truncate shrink-0">{s.label}</div>
                    <div className="flex-1 bg-gray-50 rounded h-7 relative overflow-hidden">
                      <div
                        className="h-full rounded transition-all flex items-center pl-3"
                        style={{ width: `${Math.max(widthPct, 3)}%`, background: i === 0 ? "#6366F1" : "#A5B4FC" }}
                      >
                        <span className="text-[10px] font-bold text-white">{s.count.toLocaleString()}</span>
                      </div>
                    </div>
                    <div className="w-12 text-right text-[11px] font-bold text-gray-700 shrink-0">{s.pctOfStart.toFixed(0)}%</div>
                  </div>
                  {i < funnel.length - 1 && (
                    <div className="ml-44 pl-3 mt-0.5 text-[10px] flex items-center gap-2 text-gray-400">
                      <span>↓</span>
                      <span className={isBigDrop ? "text-rose-500 font-semibold" : ""}>
                        {dropPct.toFixed(0)}% drop
                        {isBigDrop && " ⚠ biggest leak"}
                      </span>
                      {funnel[i + 1].medianHoursFromPrev > 0 && (
                        <span className="text-gray-400">· median {funnel[i + 1].medianHoursFromPrev.toFixed(1)}h</span>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </Card>
      </section>

    </div>
  );
}