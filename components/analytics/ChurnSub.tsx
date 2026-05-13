// components/admin/analytics/ChurnSub.tsx
// ─────────────────────────────────────────────────────────────────────────────
// Churn risk — generates an actionable to-do list, not insights.
// This is the single most actionable analytics output.
// ─────────────────────────────────────────────────────────────────────────────

"use client";

import { useMemo, useState } from "react";
import { SL, Card, CardTitle, MetricCard, Avatar, daysAgo, planColor } from "../admin/admin-shared";
import { SubProps } from "./analytics-types";
import { computeChurnRisk, computeEngagementDecay, ChurnRisk } from "./analytics-helpers";
import { LineChart } from "./analytics-charts";

export default function ChurnSub({ users, data, token, isMobile }: SubProps) {
  const risk = useMemo(() => computeChurnRisk(users, data), [users, data]);
  const decay = useMemo(() => computeEngagementDecay(users, data, 60), [users, data]);

  const [bandFilter, setBandFilter] = useState<"all" | "high" | "med" | "low">("high");
  const filtered = risk.filter(r => bandFilter === "all" || r.band === bandFilter);

  const highCount = risk.filter(r => r.band === "high").length;
  const medCount = risk.filter(r => r.band === "med").length;
  const lowCount = risk.filter(r => r.band === "low").length;

  // ── Contact action ──
  const [contacting, setContacting] = useState<string | null>(null);
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null);

  const flashToast = (msg: string, ok = true) => {
    setToast({ msg, ok });
    setTimeout(() => setToast(null), 3500);
  };

  const contactUser = async (r: ChurnRisk) => {
    if (!r.user.email) {
      flashToast("No email on file", false);
      return;
    }
    setContacting(r.user.id);
    try {
      const subject = "We noticed you haven't been around — anything we can do?";
      const body =
        `Hi ${r.user.name ?? "there"},\n\n` +
        `I wanted to check in personally. We noticed you haven't been active recently and ` +
        `wanted to make sure everything's going well with your interview prep.\n\n` +
        `Is there anything specific you're stuck on, or feedback we could act on? Even a ` +
        `one-line reply helps us improve the product for you.\n\n` +
        `Reply directly — this comes to my inbox.`;
      const r2 = await fetch("/api/admin", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(token ? { "x-admin-secret": token } : {}) },
        body: JSON.stringify({
          action: "contact_email",
          id: r.user.id,
          subject,
          body,
          toEmail: r.user.email,
          toName: r.user.name,
        }),
      });
      const j = await r2.json();
      if (j.success) flashToast(j.draft ? "Draft logged (no Resend key)" : `Email sent to ${r.user.email}`, true);
      else flashToast(j.error ?? "Send failed", false);
    } catch (e) {
      flashToast((e as Error).message, false);
    } finally {
      setContacting(null);
    }
  };

  return (
    <div className="flex flex-col gap-5">

      {/* ═══ KPI strip ═══ */}
      <section>
        <SL>Decision: who to contact this week before they cancel</SL>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <MetricCard
            label="High risk"
            value={highCount}
            sub="Score ≥ 60 · contact now"
            color="#EF4444"
          />
          <MetricCard
            label="Medium risk"
            value={medCount}
            sub="Score 30-59 · monitor"
            color="#F59E0B"
          />
          <MetricCard
            label="Low risk"
            value={lowCount}
            sub="Score < 30 · healthy"
            color="#10B981"
          />
          <MetricCard
            label="Total at-risk %"
            value={risk.length > 0 ? `${Math.round((highCount + medCount) / risk.length * 100)}%` : "—"}
            sub={`of ${risk.length} paying users`}
            color="#6366F1"
          />
        </div>
      </section>

      {/* ═══ Risk leaderboard ═══ */}
      <section>
        <SL>This week&apos;s outreach queue</SL>
        <Card>
          <div className="flex items-baseline justify-between mb-3 flex-wrap gap-1">
            <CardTitle>Churn risk leaderboard</CardTitle>
            <div className="flex gap-1 bg-gray-100 rounded-lg p-0.5">
              {(["high", "med", "low", "all"] as const).map(b => (
                <button key={b} onClick={() => setBandFilter(b)}
                  className={`px-2.5 py-1 rounded-md text-[10px] font-bold uppercase tracking-wider transition-all border-none cursor-pointer ${bandFilter === b ? "bg-white text-gray-900 shadow-sm" : "bg-transparent text-gray-500"}`}>
                  {b}
                </button>
              ))}
            </div>
          </div>

          {filtered.length === 0 ? (
            <div className="text-xs text-gray-400 py-12 text-center">
              No users in the <strong>{bandFilter}</strong> band — nice work.
            </div>
          ) : (
            <div className="flex flex-col">
              {filtered.slice(0, 50).map(r => {
                const pc = planColor(r.user.subscription?.plan);
                const bandColor = r.band === "high" ? "#EF4444" : r.band === "med" ? "#F59E0B" : "#10B981";
                const bandBg = r.band === "high" ? "bg-rose-50" : r.band === "med" ? "bg-amber-50" : "bg-emerald-50";
                return (
                  <div key={r.user.id} className="flex items-start gap-3 py-3 border-b border-gray-50 last:border-0">
                    <Avatar name={r.user.name} size={36} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-[13px] font-semibold text-gray-900 truncate">{r.user.name ?? "Unknown"}</span>
                        <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded border ${pc.tw}`}>
                          {r.user.subscription?.plan ?? "free"}
                        </span>
                        {r.user.subscription?.status && (
                          <span className="text-[10px] text-gray-500">· {r.user.subscription.status}</span>
                        )}
                      </div>
                      <div className="text-[11px] text-gray-500 mt-0.5 truncate">{r.user.email}</div>
                      <div className="flex flex-wrap gap-1 mt-1.5">
                        {r.factors.slice(0, 3).map((f, i) => (
                          <span key={i} className={`text-[10px] ${bandBg} text-gray-700 px-1.5 py-0.5 rounded`}>{f}</span>
                        ))}
                      </div>
                      <div className="text-[10px] text-gray-400 mt-1.5">
                        Last activity: {r.lastActivity ? daysAgo(r.lastActivity.toISOString()) : "never"}
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-1.5 shrink-0">
                      <div className="flex items-center gap-1.5">
                        <div className="w-12 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                          <div className="h-full" style={{ width: `${r.score}%`, background: bandColor }} />
                        </div>
                        <span className="text-sm font-extrabold w-7 text-right" style={{ color: bandColor }}>{r.score}</span>
                      </div>
                      {!isMobile && r.user.email && (
                        <button
                          onClick={() => contactUser(r)}
                          disabled={contacting === r.user.id}
                          className="text-[10px] font-bold px-2.5 py-1 rounded-md border border-gray-200 bg-white text-gray-700 cursor-pointer hover:bg-gray-50 disabled:opacity-50 transition-all"
                        >
                          {contacting === r.user.id ? "Sending…" : "Reach out"}
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
              {filtered.length > 50 && (
                <div className="text-[11px] text-gray-400 text-center pt-3">
                  Showing 50 of {filtered.length} users.
                </div>
              )}
            </div>
          )}
        </Card>
      </section>

      {/* ═══ Engagement decay timeline ═══ */}
      <section>
        <SL>Decision: how early do warning signs appear before someone cancels</SL>
        <Card>
          <div className="flex items-baseline justify-between mb-3 flex-wrap gap-1">
            <CardTitle>Pre-churn engagement pattern</CardTitle>
            <span className="text-[10px] text-gray-400">Avg weekly activity in the 60 days before cancellation</span>
          </div>
          {decay.length === 0 ? (
            <div className="text-xs text-gray-400 py-8 text-center">Not enough churn history to compute decay pattern yet.</div>
          ) : (
            <>
              <LineChart
                labels={decay.map(p => `${p.daysBefore}d`)}
                height={isMobile ? 220 : 280}
                showLegend
                series={[
                  { label: "Will churn",     data: decay.map(p => p.churnedAvg),  color: "#EF4444", fill: true },
                  { label: "Retained users", data: decay.map(p => p.retainedAvg), color: "#10B981", dashed: true },
                ]}
              />
              <p className="text-[11px] text-gray-500 mt-3">
                The further the red line drops below the green line — and the earlier — the earlier you should intervene.
                Use the gap as a leading indicator: when an active user&apos;s weekly activity drops below the retained-user average,
                add them to the contact queue regardless of their current risk score.
              </p>
            </>
          )}
        </Card>
      </section>

      {/* Toast */}
      {toast && (
        <div className={`fixed bottom-4 left-1/2 -translate-x-1/2 px-4 py-2.5 rounded-lg shadow-lg z-50 ${toast.ok ? "bg-emerald-600" : "bg-rose-600"} text-white text-xs font-semibold`}>
          {toast.msg}
        </div>
      )}

    </div>
  );
}