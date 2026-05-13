// components/admin/AnalyticsTab.tsx
// ─────────────────────────────────────────────────────────────────────────────
// Orchestrator. Fetches data once, dispatches to the relevant sub-tab.
// All the heavy computation lives in /analytics/analytics-helpers.ts and is
// memoised inside each sub-tab.
//
// Sub-tab navigation:
//   overview   — anomaly digest + headline KPIs
//   revenue    — MRR waterfall, NRR/GRR, ARPU, plan mix
//   retention  — cohort triangle, activation funnel, time-to-value
//   product    — feature ROI, score progression, weaknesses, popularity
//   churn      — risk leaderboard with outreach, engagement decay
//   segments   — RFM, power users, channel quality
// ─────────────────────────────────────────────────────────────────────────────

"use client";

import { useEffect, useState } from "react";
import { User, SL, Spinner, useIsMobile } from "./admin-shared";
import { AnalyticsTab as TabId, AppPayload } from "../analytics/analytics-types";
import OverviewSub  from "../analytics/OverviewSub";
import RevenueSub   from "../analytics/RevenueSub";
import RetentionSub from "../analytics/RetentionSub";
import ProductSub   from "../analytics/ProductSub";
import ChurnSub     from "../analytics/ChurnSub";
import SegmentsSub  from "../analytics/SegmentsSub";

// ─── Props ───────────────────────────────────────────────────────────────────

interface Props {
  users: User[];
  loading: boolean;
  token?: string;
}

// ─── Tab definitions ─────────────────────────────────────────────────────────

const TABS: { id: TabId; label: string; emoji: string; hint: string }[] = [
  { id: "overview",   label: "Overview",  emoji: "📊", hint: "What changed this week" },
  { id: "revenue",    label: "Revenue",   emoji: "💰", hint: "MRR movement, NRR, ARPU" },
  { id: "retention",  label: "Retention", emoji: "📈", hint: "Cohorts, activation, TTV" },
  { id: "product",    label: "Product",   emoji: "🎯", hint: "Feature ROI, score lift" },
  { id: "churn",      label: "Churn",     emoji: "⚠️", hint: "Who to contact, decay" },
  { id: "segments",   label: "Segments",  emoji: "👥", hint: "RFM, power users, channels" },
];

// ─── Component ───────────────────────────────────────────────────────────────

export default function AnalyticsTab({ users, loading, token = "" }: Props) {
  const isMobile = useIsMobile();
  const [tab, setTab] = useState<TabId>("overview");
  const [data, setData] = useState<AppPayload | null>(null);
  const [fetching, setFetching] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Fetch behavioural data once
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setFetching(true);
      setError(null);
      try {
        const res = await fetch("/api/admin?action=analytics", {
          headers: token ? { "x-admin-secret": token } : undefined,
        });
        if (!res.ok) throw new Error(`API error: ${res.status}`);
        const json = await res.json();
        if (!cancelled) {
          setData({
            interviews: json.interviews ?? [],
            feedbacks:  json.feedbacks  ?? [],
            resumes:    json.resumes    ?? [],
            plans:      json.plans      ?? [],
          });
        }
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      } finally {
        if (!cancelled) setFetching(false);
      }
    })();
    return () => { cancelled = true; };
  }, [token]);

  // ── Loading ────────────────────────────────────────────────────────────────
  if (loading || fetching) {
    return (
      <div className="flex-1 overflow-auto p-4 md:p-7 flex flex-col min-w-0">
        <Spinner />
      </div>
    );
  }

  // ── Error ──────────────────────────────────────────────────────────────────
  if (error) {
    return (
      <div className="flex-1 overflow-auto p-4 md:p-7 flex flex-col min-w-0">
        <div className="p-5 bg-rose-50 border border-rose-200 rounded-lg">
          <div className="text-sm font-bold text-rose-900 mb-1">Couldn&apos;t load analytics</div>
          <div className="text-xs text-rose-700">{error}</div>
        </div>
      </div>
    );
  }

  if (!data) return null;

  // ── Sub-tab dispatch ───────────────────────────────────────────────────────
  const subProps = { users, data, token, isMobile };

  const renderTab = () => {
    switch (tab) {
      case "overview":  return <OverviewSub  {...subProps} />;
      case "revenue":   return <RevenueSub   {...subProps} />;
      case "retention": return <RetentionSub {...subProps} />;
      case "product":   return <ProductSub   {...subProps} />;
      case "churn":     return <ChurnSub     {...subProps} />;
      case "segments":  return <SegmentsSub  {...subProps} />;
    }
  };

  return (
    <div className="flex-1 overflow-auto p-4 md:p-7 flex flex-col gap-5 min-w-0">

      {/* ═══ Sub-tab nav ═══ */}
      <div>
        <SL>Analytics</SL>

        {/* Desktop: pills with hints — full width, evenly distributed.
            Uses inline styles to bypass any Tailwind content-scanning issues
            and guarantee the layout regardless of cached CSS. */}
        {!isMobile && (
          <div
            className="bg-white border border-gray-100 rounded-xl p-1 gap-1"
            style={{
              display: "grid",
              gridTemplateColumns: `repeat(${TABS.length}, 1fr)`,
              width: "100%",
            }}
          >
            {TABS.map(t => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`px-3 py-2 rounded-lg text-xs font-bold transition-all border-none cursor-pointer flex items-center justify-center gap-1.5 ${tab === t.id ? "bg-indigo-50 text-indigo-700" : "bg-transparent text-gray-500 hover:bg-gray-50"}`}
                style={{ width: "100%", minWidth: 0 }}
                title={t.hint}
              >
                <span>{t.emoji}</span>
                <span>{t.label}</span>
              </button>
            ))}
          </div>
        )}

        {/* Mobile: scrollable horizontal pills */}
        {isMobile && (
          <div className="overflow-x-auto -mx-1 px-1">
            <div className="flex gap-1.5 pb-1">
              {TABS.map(t => (
                <button
                  key={t.id}
                  onClick={() => setTab(t.id)}
                  className={`shrink-0 px-3 py-2 rounded-lg text-xs font-bold transition-all border cursor-pointer flex items-center gap-1.5 ${tab === t.id ? "bg-indigo-50 text-indigo-700 border-indigo-200" : "bg-white text-gray-500 border-gray-100"}`}
                >
                  <span>{t.emoji}</span>
                  <span>{t.label}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Active tab hint */}
        <div className="text-[11px] text-gray-400 mt-2">
          {TABS.find(t => t.id === tab)?.hint}
        </div>
      </div>

      {/* ═══ Rendered sub-tab ═══ */}
      {renderTab()}

    </div>
  );
}