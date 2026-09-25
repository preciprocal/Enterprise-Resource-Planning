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

export default function AnalyticsTab({ users, loading, token = "", theme = "dark" }: Props) {
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
      <div className="flex-1 overflow-auto p-4 md:p-7 flex flex-col min-w-0">
        <Spinner />
      </div>
    );
  }

  // ── Error ──────────────────────────────────────────────────────────────────
  if (error) {
    return (
      <div className={`${theme !== "light" ? "analytics-dark" : ""} flex-1 overflow-auto p-4 md:p-7 flex flex-col min-w-0`}>
        <div className="px-4 py-3 bg-[rgba(255,68,68,0.06)] border border-[rgba(255,68,68,0.2)] rounded-lg">
          <div className="text-[14px] font-semibold text-[#f44] mb-1">Could not load analytics</div>
          <div className="text-[13px] text-[#f44]/70">{error}</div>
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
    <div className={`${theme !== "light" ? "analytics-dark" : ""} flex-1 overflow-auto p-4 md:p-6 flex flex-col gap-5 min-w-0 bg-black`}>

      {/* Sub-tab nav */}
      <div>
        <SL>Analytics</SL>

        {!isMobile && (
          <div
            className="bg-[#0a0a0a] border border-[#1a1a1a] rounded-xl p-1"
            style={{
              display: "grid",
              gridTemplateColumns: `repeat(${TABS.length}, 1fr)`,
              gap: "2px",
              width: "100%",
            }}
          >
            {TABS.map(t => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`px-1.5 lg:px-3 py-2 rounded-lg text-[13px] font-semibold transition-all border-none cursor-pointer flex items-center justify-center gap-1.5 ${
                  tab === t.id
                    ? "bg-[#ededed] text-black"
                    : "bg-transparent text-[#555] hover:text-[#ededed] hover:bg-[#111]"
                }`}
                style={{ width: "100%", minWidth: 0 }}
                title={t.hint}
              >
                {/* Emoji only when there's room — 6 equal columns get tight on tablets */}
                <span className="hidden lg:inline">{t.emoji}</span>
                <span className="truncate">{t.label}</span>
              </button>
            ))}
          </div>
        )}

        {isMobile && (
          <div className="overflow-x-auto -mx-1 px-1">
            <div className="flex gap-1.5 pb-1">
              {TABS.map(t => (
                <button
                  key={t.id}
                  onClick={() => setTab(t.id)}
                  className={`shrink-0 px-3 py-2 rounded-lg text-[13px] font-semibold transition-all border cursor-pointer flex items-center gap-1.5 ${
                    tab === t.id
                      ? "bg-[#ededed] text-black border-transparent"
                      : "bg-[#0a0a0a] text-[#555] border-[#1a1a1a] hover:text-[#ededed]"
                  }`}
                >
                  <span>{t.emoji}</span>
                  <span>{t.label}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="text-[12px] text-[#555] mt-2">
          {TABS.find(t => t.id === tab)?.hint}
        </div>
      </div>

      {renderTab()}

    </div>
  );
}