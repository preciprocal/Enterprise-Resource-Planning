// components/admin/analytics/RetentionSub.tsx
// ─────────────────────────────────────────────────────────────────────────────
// Retention — the truth-teller. Cohort triangle is the chart that exposes
// whether the product is actually working.
// ─────────────────────────────────────────────────────────────────────────────

"use client";

import { useMemo } from "react";
import { SL, Card, CardTitle, MetricCard } from "../admin/admin-shared";
import { SubProps } from "./analytics-types";
import {
  computeCohortRetention, computeActivationFunnel, computeTimeToValueHistogram,
} from "./analytics-helpers";
import { Bars, HeatCell } from "./analytics-charts";

export default function RetentionSub({ users, data, isMobile }: SubProps) {
  const cohorts = useMemo(() => computeCohortRetention(users, data, 8), [users, data]);
  const funnel = useMemo(() => computeActivationFunnel(users, data), [users, data]);
  const ttvHist = useMemo(() => computeTimeToValueHistogram(users, data), [users, data]);

  const maxMonths = Math.max(...cohorts.map(c => c.retention.length), 0);

  // Activation drop signals
  const biggestDropIdx = funnel.reduce((maxIdx, _, i) => {
    if (i === 0) return 0;
    const dropHere = funnel[i - 1].count - funnel[i].count;
    const dropMax = maxIdx === 0 ? 0 : funnel[maxIdx - 1].count - funnel[maxIdx].count;
    return dropHere > dropMax ? i : maxIdx;
  }, 0);

  // Time-to-value insights
  const ttvWithValue = ttvHist.reduce((s, b) => s + b.count, 0);
  const ttvFast = ttvHist.slice(0, 2).reduce((s, b) => s + b.count, 0); // <6h
  const ttvFastPct = ttvWithValue > 0 ? (ttvFast / ttvWithValue) * 100 : 0;

  // Latest cohort month-1 retention as headline number
  const latestCohort = cohorts[cohorts.length - 1];
  const m1Retention = latestCohort?.retention[1] ?? null;

  return (
    <div className="flex flex-col gap-5">

      {/* ═══ KPI strip ═══ */}
      <section>
        <SL>Decision: is the product retaining users at all</SL>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <MetricCard
            label="Latest cohort"
            value={latestCohort?.size ?? 0}
            sub={latestCohort?.cohortLabel ?? "—"}
            color="#6366F1"
          />
          <MetricCard
            label="Month-1 retention"
            value={m1Retention !== null ? `${m1Retention}%` : "—"}
            sub="Most recent fully-elapsed cohort"
            color={m1Retention !== null ? (m1Retention >= 30 ? "#10B981" : m1Retention >= 15 ? "#F59E0B" : "#EF4444") : "#9CA3AF"}
          />
          <MetricCard
            label="Activation rate"
            value={`${funnel[1]?.pctOfStart.toFixed(0) ?? 0}%`}
            sub="First session within 24h"
            color="#3B82F6"
          />
          <MetricCard
            label="Fast TTV (<6h)"
            value={`${ttvFastPct.toFixed(0)}%`}
            sub="Of users who hit value, how fast"
            color="#10B981"
          />
        </div>
      </section>

      {/* ═══ Cohort retention triangle ═══ */}
      <section>
        <SL>Decision: is the product getting stickier over time</SL>
        <Card>
          <div className="flex items-baseline justify-between mb-3 flex-wrap gap-1">
            <CardTitle>Cohort retention triangle</CardTitle>
            <span className="text-[10px] text-gray-400">% of cohort active in each subsequent month</span>
          </div>
          {cohorts.length === 0 ? (
            <div className="text-xs text-gray-400 py-8 text-center">No cohort data — need at least one full month of users.</div>
          ) : (
            <div className="overflow-x-auto">
              <div className="min-w-fit">
                {/* Header row */}
                <div className="grid gap-1 mb-1" style={{ gridTemplateColumns: `120px 50px repeat(${maxMonths}, minmax(50px, 1fr))` }}>
                  <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Cohort</div>
                  <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wider text-center">Size</div>
                  {Array.from({ length: maxMonths }, (_, i) => (
                    <div key={i} className="text-[10px] font-bold text-gray-400 uppercase tracking-wider text-center">M{i}</div>
                  ))}
                </div>
                {/* Data rows */}
                {cohorts.map(c => (
                  <div key={c.cohort} className="grid gap-1 mb-1" style={{ gridTemplateColumns: `120px 50px repeat(${maxMonths}, minmax(50px, 1fr))` }}>
                    <div className="text-[11px] font-semibold text-gray-700 flex items-center">{c.cohortLabel}</div>
                    <div className="text-[11px] font-bold text-gray-900 flex items-center justify-center">{c.size}</div>
                    {Array.from({ length: maxMonths }, (_, i) => (
                      <div key={i}>
                        <HeatCell value={i < c.retention.length ? c.retention[i] : null} />
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </div>
          )}
          <div className="mt-4 flex items-center gap-3 text-[10px] text-gray-500">
            <span>0%</span>
            <div className="flex gap-0.5 flex-1 max-w-xs">
              {["#FEF2F2", "#FEE2E2", "#FEF3C7", "#FDE68A", "#A7F3D0", "#6EE7B7", "#10B981"].map(c =>
                <div key={c} className="flex-1 h-2.5 rounded-sm" style={{ background: c }} />
              )}
            </div>
            <span>70%+</span>
          </div>
        </Card>
      </section>

      {/* ═══ Activation funnel detailed ═══ */}
      <section>
        <SL>Decision: which onboarding step to redesign first</SL>
        <Card>
          <CardTitle>Signup → activated user funnel</CardTitle>
          <Bars
            labels={funnel.map(s => s.label)}
            horizontal
            height={isMobile ? 200 : 280}
            yFormat={(v) => v.toLocaleString()}
            series={[{
              label: "Users",
              data: funnel.map(s => s.count),
              color: "#6366F1",
            }]}
          />
          <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3">
            {funnel.slice(1).map((s, i) => {
              const dropPct = 100 - (s.count / Math.max(funnel[i].count, 1)) * 100;
              const isBigDrop = i + 1 === biggestDropIdx && biggestDropIdx > 0;
              return (
                <div key={s.label}
                     className={`px-3 py-2.5 rounded-lg border ${isBigDrop ? "bg-rose-50 border-rose-200" : "bg-gray-50 border-gray-100"}`}>
                  <div className="text-[10px] text-gray-500 font-semibold uppercase tracking-wider mb-1">
                    {funnel[i].label.slice(0, 24)} → {s.label.slice(0, 24)}
                  </div>
                  <div className="flex items-baseline gap-2">
                    <span className={`text-xl font-extrabold ${isBigDrop ? "text-rose-600" : "text-gray-900"}`}>
                      {dropPct.toFixed(0)}%
                    </span>
                    <span className="text-[10px] text-gray-500">drop-off</span>
                    {s.medianHoursFromPrev > 0 && (
                      <span className="text-[10px] text-gray-400 ml-auto">median {s.medianHoursFromPrev.toFixed(1)}h</span>
                    )}
                  </div>
                  {isBigDrop && <div className="text-[10px] text-rose-600 font-semibold mt-1">⚠ biggest single leak — fix this first</div>}
                </div>
              );
            })}
          </div>
        </Card>
      </section>

      {/* ═══ Time-to-value distribution ═══ */}
      <section>
        <SL>Decision: how fast does the product prove its worth</SL>
        <Card>
          <div className="flex items-baseline justify-between mb-3 flex-wrap gap-1">
            <CardTitle>Time from signup to first completed interview</CardTitle>
            <span className="text-[10px] text-gray-400">{ttvWithValue} users · &quot;aha moment&quot; = first finalised interview with a score</span>
          </div>
          <Bars
            labels={ttvHist.map(b => b.bucket)}
            height={isMobile ? 180 : 220}
            yFormat={(v) => v.toLocaleString()}
            series={[{ label: "Users", data: ttvHist.map(b => b.count), color: "#8B5CF6" }]}
          />
          <p className="text-[11px] text-gray-500 mt-3">
            Most products succeed when users reach value in under a day. If your distribution skews to &quot;1-3d&quot; or longer,
            that&apos;s the strongest signal that onboarding needs to surface the core value faster.
          </p>
        </Card>
      </section>

    </div>
  );
}