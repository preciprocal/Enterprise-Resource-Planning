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
import { User, Spinner, useIsMobile } from "./admin-shared";
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
  theme?: "dark" | "light";
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
          headers: token ? { "x-admin-token": token } : undefined,
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
      <div className="flex-1 overflow-auto p-4 md:p-6 flex flex-col min-w-0 bg-canvas">
        <Spinner />
      </div>
    );
  }

  // ── Error ──────────────────────────────────────────────────────────────────
  if (error) {
    return (
      <div className="flex-1 overflow-auto p-4 md:p-6 flex flex-col min-w-0 bg-canvas">
        <div className="px-4 py-3 bg-danger-soft border border-danger-line rounded-xl">
          <div className="text-[14px] font-semibold text-danger-fg mb-1">Could not load analytics</div>
          <div className="text-[13px] text-danger-fg/70">{error}</div>
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
    <div className="flex-1 overflow-auto p-4 md:p-6 flex flex-col gap-5 min-w-0 bg-canvas">

      {/* Sub-tab nav */}
      <div>
        <div className="tabs">
          {TABS.map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`tab shrink-0 ${tab === t.id ? "tab-active" : ""}`}
              title={t.hint}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="text-caption mt-2">
          {TABS.find(t => t.id === tab)?.hint}
        </div>
      </div>

      {renderTab()}

    </div>
  );
}