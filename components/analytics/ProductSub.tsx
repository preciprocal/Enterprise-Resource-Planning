// components/admin/analytics/ProductSub.tsx
// ─────────────────────────────────────────────────────────────────────────────
// Product analytics — feature ROI, score progression, weaknesses.
// Answers: does this product actually make users better?
// ─────────────────────────────────────────────────────────────────────────────

"use client";

import { useMemo, useState } from "react";
import { SL, Card, CardTitle, MetricCard } from "../admin/admin-shared";
import { SubProps } from "./analytics-types";
import {
  computeFeatureROI, computeScoreProgression, computeCategoryStrength,
  computeTypeDistribution, computeAbandonment, computePopularityDrift,
} from "./analytics-helpers";
import { BubbleChart, LineChart, Bars, BoxPlot, Sparkline } from "./analytics-charts";

export default function ProductSub({ users, data, isMobile }: SubProps) {
  const featureROI = useMemo(() => computeFeatureROI(users, data), [users, data]);
  const scoreProg = useMemo(() => computeScoreProgression(data), [data]);
  const catStrength = useMemo(() => computeCategoryStrength(data), [data]);
  const typeDist = useMemo(() => computeTypeDistribution(data), [data]);
  const [popDim, setPopDim] = useState<"role" | "techstack" | "company">("role");
  const popDrift = useMemo(() => computePopularityDrift(data, popDim, 10), [data, popDim]);
  const [abandonDim, setAbandonDim] = useState<"type" | "role" | "level">("type");
  const abandonment = useMemo(() => computeAbandonment(data, abandonDim), [data, abandonDim]);

  // Quadrant assignment for feature ROI matrix
  const bubblePoints = featureROI.map(f => {
    // Avoid log(0) — clamp at 1
    const radius = Math.max(6, Math.min(28, Math.log10(Math.max(f.totalActions, 1)) * 6));
    const isStar = f.adoptionPct >= 50 && f.retentionLift >= 5;
    const isHidden = f.adoptionPct < 50 && f.retentionLift >= 5;
    const isHygiene = f.adoptionPct >= 50 && f.retentionLift < 5;
    const color = isStar ? "#10B981" : isHidden ? "#8B5CF6" : isHygiene ? "#6B7280" : "#EF4444";
    return { x: f.adoptionPct, y: f.retentionLift, r: radius, label: f.feature, color };
  });

  // Score progression: did users improve?
  const firstAttempt = scoreProg[0]?.avgScore ?? 0;
  const lastValidAttempt = [...scoreProg].reverse().find(s => s.sampleSize >= 5);
  const lift = lastValidAttempt ? lastValidAttempt.avgScore - firstAttempt : 0;
  const productWorks = lift >= 5;

  return (
    <div className="flex flex-col gap-5">

      {/* ═══ Score lift KPI — the existential metric ═══ */}
      <section>
        <SL>Decision: does this product actually do its job</SL>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <MetricCard
            label="Score lift, attempt 1→N"
            value={lift > 0 ? `+${lift}` : `${lift}`}
            sub={lastValidAttempt ? `Attempt ${lastValidAttempt.attempt} avg ${lastValidAttempt.avgScore}` : "Insufficient data"}
            color={productWorks ? "#10B981" : lift > 0 ? "#F59E0B" : "#EF4444"}
          />
          <MetricCard
            label="Active features"
            value={featureROI.filter(f => f.adoptionPct > 10).length}
            sub={`Out of ${featureROI.length} total`}
            color="#3B82F6"
          />
          <MetricCard
            label="Avg interview score"
            value={firstAttempt > 0 ? firstAttempt : "—"}
            sub="Across all attempts"
            color="#F59E0B"
          />
          <MetricCard
            label="Categories tracked"
            value={catStrength.length}
            sub={catStrength[0]?.category ? `Weakest: ${catStrength[0].category}` : ""}
            color="#8B5CF6"
          />
        </div>
        {!productWorks && lastValidAttempt && (
          <div className="mt-3 px-3 py-2.5 bg-rose-50 border border-rose-200 rounded-lg flex items-start gap-2.5">
            <svg width="14" height="14" fill="none" stroke="#DC2626" strokeWidth="2" viewBox="0 0 24 24" className="shrink-0 mt-0.5">
              <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
            </svg>
            <div className="flex-1 text-[11px] text-rose-900">
              <strong>Product impact alert:</strong> users aren&apos;t improving meaningfully across attempts.
              The core value proposition needs to show measurable skill development.
            </div>
          </div>
        )}
      </section>

      {/* ═══ Feature ROI matrix ═══ */}
      <section>
        <SL>Decision: which features to invest in, promote, maintain, or kill</SL>
        <Card>
          <div className="flex items-baseline justify-between mb-3 flex-wrap gap-1">
            <CardTitle>Feature ROI matrix</CardTitle>
            <span className="text-[10px] text-gray-400">Adoption × retention impact · bubble size = total usage</span>
          </div>
          <BubbleChart
            points={bubblePoints}
            height={isMobile ? 280 : 360}
            xLabel="Adoption rate (% of users)"
            yLabel="Retention lift (pp)"
            xMax={Math.max(100, ...bubblePoints.map(p => p.x + 10))}
            yMin={Math.min(-15, ...bubblePoints.map(p => p.y - 5))}
            yMax={Math.max(30, ...bubblePoints.map(p => p.y + 5))}
          />
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mt-4">
            {[
              { label: "Star — invest more",       color: "#10B981", desc: "High adoption, helps retention" },
              { label: "Hidden gem — promote",     color: "#8B5CF6", desc: "Low adoption, high impact" },
              { label: "Hygiene — maintain",       color: "#6B7280", desc: "Used a lot, doesn't lift retention" },
              { label: "Cut candidate",            color: "#EF4444", desc: "Low both — kill or rework" },
            ].map(q => (
              <div key={q.label} className="px-2.5 py-2 rounded-lg bg-gray-50 border border-gray-100">
                <div className="flex items-center gap-1.5 mb-1">
                  <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: q.color }} />
                  <span className="text-[11px] font-bold text-gray-700">{q.label}</span>
                </div>
                <div className="text-[10px] text-gray-500">{q.desc}</div>
              </div>
            ))}
          </div>
          <p className="text-[10px] text-gray-400 mt-3">
            Correlation, not causation. Features with sample size &lt; 50 users are unreliable — interpret cautiously.
          </p>
        </Card>
      </section>

      {/* ═══ Interview score progression ═══ */}
      <section>
        <SL>Decision: validate that practice on this platform actually improves users</SL>
        <Card>
          <div className="flex items-baseline justify-between mb-3 flex-wrap gap-1">
            <CardTitle>Score progression by attempt</CardTitle>
            <span className="text-[10px] text-gray-400">A flat or declining line means the product isn&apos;t teaching</span>
          </div>
          <LineChart
            labels={scoreProg.map(s => `#${s.attempt}${s.attempt === 8 ? "+" : ""}`)}
            height={isMobile ? 220 : 280}
            yMin={0}
            yMax={100}
            showLegend
            series={[
              { label: "Avg score", data: scoreProg.map(s => s.sampleSize >= 3 ? s.avgScore : null), color: "#6366F1", fill: true },
              { label: "+1 SD", data: scoreProg.map(s => s.sampleSize >= 3 ? Math.min(100, s.avgScore + s.stdDev) : null), color: "#C4B5FD", dashed: true },
              { label: "−1 SD", data: scoreProg.map(s => s.sampleSize >= 3 ? Math.max(0, s.avgScore - s.stdDev) : null), color: "#C4B5FD", dashed: true },
            ]}
          />
          <div className="grid grid-cols-4 md:grid-cols-8 gap-2 mt-3">
            {scoreProg.map(s => (
              <div key={s.attempt} className="text-center px-1">
                <div className="text-[10px] text-gray-400">#{s.attempt}{s.attempt === 8 ? "+" : ""}</div>
                <div className="text-[11px] font-bold text-gray-700">n={s.sampleSize}</div>
              </div>
            ))}
          </div>
        </Card>
      </section>

      {/* ═══ Category strength heatmap ═══ */}
      {catStrength.length > 0 && (
        <section>
          <SL>Decision: what content/coaching to build next based on user weaknesses</SL>
          <Card>
            <div className="flex items-baseline justify-between mb-3 flex-wrap gap-1">
              <CardTitle>Skill categories — weakest first</CardTitle>
              <span className="text-[10px] text-gray-400">Average feedback score per category</span>
            </div>
            <Bars
              labels={catStrength.map(c => c.category)}
              horizontal
              height={isMobile ? 200 : 40 + catStrength.length * 32}
              yFormat={(v) => `${v}/100`}
              series={[{
                label: "Avg score",
                data: catStrength.map(c => c.avgScore),
                color: "#F59E0B",
              }]}
            />
          </Card>
        </section>
      )}

      {/* ═══ Score distribution by interview type (box plot) ═══ */}
      {typeDist.length > 0 && (
        <section>
          <SL>Decision: are interview types calibrated correctly</SL>
          <Card>
            <div className="flex items-baseline justify-between mb-3 flex-wrap gap-1">
              <CardTitle>Score distribution by interview type</CardTitle>
              <span className="text-[10px] text-gray-400">Box = IQR · line = median · whiskers = min/max</span>
            </div>
            <BoxPlot rows={typeDist.map(t => ({
              label: t.type,
              min: t.min,
              q1: t.q1,
              median: t.median,
              q3: t.q3,
              max: t.max,
              sample: t.count,
            }))} />
          </Card>
        </section>
      )}

      {/* ═══ Popularity drift ═══ */}
      <section>
        <SL>Decision: what content to build, what to feature</SL>
        <Card>
          <div className="flex items-baseline justify-between mb-3 flex-wrap gap-1">
            <CardTitle>Trending {popDim}</CardTitle>
            <div className="flex gap-1 bg-gray-100 rounded-lg p-0.5">
              {(["role", "techstack", "company"] as const).map(d => (
                <button key={d} onClick={() => setPopDim(d)}
                  className={`px-2.5 py-1 rounded-md text-[10px] font-bold uppercase tracking-wider transition-all border-none cursor-pointer ${popDim === d ? "bg-white text-gray-900 shadow-sm" : "bg-transparent text-gray-500"}`}>
                  {d}
                </button>
              ))}
            </div>
          </div>
          {popDrift.length === 0 ? (
            <div className="text-xs text-gray-400 py-8 text-center">Not enough recent interviews to detect trends in this dimension.</div>
          ) : (
            <div className="flex flex-col">
              {popDrift.map(p => (
                <div key={p.item} className="flex items-center gap-3 py-2 border-b border-gray-50 last:border-0">
                  <span className="text-xs text-gray-700 font-medium flex-1 truncate min-w-0">{p.item}</span>
                  <Sparkline data={p.trend} color={p.growthPct >= 0 ? "#10B981" : "#EF4444"} width={60} height={20} />
                  <span className="text-[10px] text-gray-400 w-16 text-right shrink-0">{p.recent} recent</span>
                  <span className={`text-xs font-bold w-14 text-right shrink-0 ${p.growthPct > 0 ? "text-emerald-600" : p.growthPct < 0 ? "text-rose-500" : "text-gray-400"}`}>
                    {p.growthPct > 0 ? "+" : ""}{p.growthPct}%
                  </span>
                </div>
              ))}
            </div>
          )}
        </Card>
      </section>

      {/* ═══ Abandonment analysis ═══ */}
      <section>
        <SL>Decision: what&apos;s making users quit interviews before finishing</SL>
        <Card>
          <div className="flex items-baseline justify-between mb-3 flex-wrap gap-1">
            <CardTitle>Abandonment by {abandonDim}</CardTitle>
            <div className="flex gap-1 bg-gray-100 rounded-lg p-0.5">
              {(["type", "role", "level"] as const).map(d => (
                <button key={d} onClick={() => setAbandonDim(d)}
                  className={`px-2.5 py-1 rounded-md text-[10px] font-bold uppercase tracking-wider transition-all border-none cursor-pointer ${abandonDim === d ? "bg-white text-gray-900 shadow-sm" : "bg-transparent text-gray-500"}`}>
                  {d}
                </button>
              ))}
            </div>
          </div>
          {abandonment.length === 0 ? (
            <div className="text-xs text-gray-400 py-8 text-center">Not enough data yet.</div>
          ) : (
            <div className="flex flex-col">
              {abandonment.slice(0, 10).map(a => (
                <div key={a.slice} className="flex items-center gap-3 py-2 border-b border-gray-50 last:border-0">
                  <span className="text-xs text-gray-700 font-medium w-32 truncate shrink-0">{a.slice}</span>
                  <div className="flex-1 bg-gray-100 rounded-full overflow-hidden h-2">
                    <div className="h-full rounded-full" style={{ width: `${a.rate}%`, background: a.rate > 50 ? "#EF4444" : a.rate > 25 ? "#F59E0B" : "#10B981" }} />
                  </div>
                  <span className="text-[10px] text-gray-400 w-20 text-right shrink-0">{a.abandoned}/{a.total}</span>
                  <span className={`text-xs font-bold w-12 text-right shrink-0`} style={{ color: a.rate > 50 ? "#EF4444" : a.rate > 25 ? "#F59E0B" : "#10B981" }}>
                    {a.rate.toFixed(0)}%
                  </span>
                </div>
              ))}
            </div>
          )}
        </Card>
      </section>

    </div>
  );
}