// components/admin/analytics/SegmentsSub.tsx
// ─────────────────────────────────────────────────────────────────────────────
// User segmentation — RFM grid, power users, acquisition channel quality.
// Stop showing "1,247 users." Show segments that map to actions.
// ─────────────────────────────────────────────────────────────────────────────

"use client";

import { useMemo, useState } from "react";
import { SL, Card, CardTitle, MetricCard, Avatar, planColor, tint } from "../admin/admin-shared";
import { SubProps } from "./analytics-types";
import {
  computeRFM, computePowerUsers, computeChannelQuality, RFM_SEGMENTS, RFMSegment,
} from "./analytics-helpers";
import { Bars } from "./analytics-charts";

export default function SegmentsSub({ users, data, isMobile }: SubProps) {
  const rfm = useMemo(() => computeRFM(users, data), [users, data]);
  const powerUsers = useMemo(() => computePowerUsers(users, data, 15), [users, data]);
  const channels = useMemo(() => computeChannelQuality(users, data), [users, data]);

  // Group by segment
  const segmentCounts = useMemo(() => {
    const m: Record<RFMSegment, number> = {
      champion: 0, loyal: 0, promising: 0, new: 0, atRisk: 0, hibernating: 0, lost: 0,
    };
    rfm.forEach(u => { m[u.segment]++; });
    return m;
  }, [rfm]);

  const [selectedSegment, setSelectedSegment] = useState<RFMSegment | null>(null);
  const segmentUsers = useMemo(() => {
    if (!selectedSegment) return [];
    return rfm.filter(u => u.segment === selectedSegment).slice(0, 20);
  }, [rfm, selectedSegment]);

  return (
    <div className="flex flex-col gap-5">

      {/* ═══ Segment grid ═══ */}
      <section>
        <SL>Decision: which segment to target with the next campaign</SL>
        <Card>
          <div className="flex items-baseline justify-between mb-3 flex-wrap gap-1">
            <CardTitle>User segments (RFM)</CardTitle>
            <span className="text-[11px] text-fg-4">Recency × Frequency × Monetary — click any segment</span>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {RFM_SEGMENTS.map(seg => {
              const count = segmentCounts[seg.id];
              const pct = users.length > 0 ? (count / users.length) * 100 : 0;
              const isSelected = selectedSegment === seg.id;
              return (
                <button
                  key={seg.id}
                  onClick={() => setSelectedSegment(isSelected ? null : seg.id)}
                  className={`text-left p-3 rounded-xl border transition-colors ${isSelected ? "" : "hover:bg-hover"}`}
                  style={{
                    borderColor: isSelected ? seg.color : "var(--line)",
                    background: isSelected ? tint(seg.color, "15") : "var(--subtle)",
                  }}
                >
                  <div className="flex items-center gap-1.5 mb-1.5">
                    <span className="w-2 h-2 rounded-full" style={{ background: seg.color }} />
                    <span className="label">{seg.label}</span>
                  </div>
                  <div className="text-2xl font-semibold leading-none" style={{ color: seg.color }}>{count}</div>
                  <div className="text-[11px] text-fg-4 mt-1">{pct.toFixed(0)}% of base</div>
                </button>
              );
            })}
          </div>

          {/* Segment-specific user list */}
          {selectedSegment && (
            <div className="mt-4 pt-4 border-t border-line-soft">
              <div className="label mb-2">
                Users in {RFM_SEGMENTS.find(s => s.id === selectedSegment)?.label}
              </div>
              {segmentUsers.length === 0 ? (
                <div className="text-xs text-fg-4 py-4 text-center">No users in this segment.</div>
              ) : (
                <div className="flex flex-col">
                  {segmentUsers.map(u => (
                    <div key={u.user.id} className="flex items-center gap-3 py-2 border-b border-line-soft last:border-0">
                      <Avatar name={u.user.name} size={28} />
                      <div className="flex-1 min-w-0">
                        <div className="text-[12px] font-semibold text-fg truncate">{u.user.name ?? "Unknown"}</div>
                        <div className="text-[11px] text-fg-4 truncate">{u.user.email}</div>
                      </div>
                      <div className="flex gap-1 shrink-0">
                        {["R", "F", "M"].map((k, i) => (
                          <span key={k} className="badge badge-neutral font-mono">
                            {k}{[u.r, u.f, u.m][i]}
                          </span>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </Card>
      </section>

      {/* ═══ Power users ═══ */}
      <section>
        <SL>Decision: who to interview for product research, beta features, testimonials</SL>
        <Card>
          <div className="flex items-baseline justify-between mb-3 flex-wrap gap-1">
            <CardTitle>Top {powerUsers.length} power users</CardTitle>
            <span className="text-[11px] text-fg-4">Composite score: interviews × 3 + resumes × 2 + active days</span>
          </div>
          {powerUsers.length === 0 ? (
            <div className="text-xs text-fg-4 py-8 text-center">No active users yet.</div>
          ) : (
            <div className="flex flex-col">
              {powerUsers.map((p, i) => {
                const pc = planColor(p.user.subscription?.plan);
                return (
                  <div key={p.user.id} className="flex items-center gap-3 py-2.5 border-b border-line-soft last:border-0">
                    <span className="text-[11px] font-bold text-fg-4 w-6 text-center shrink-0">#{i + 1}</span>
                    <Avatar name={p.user.name} size={32} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-[13px] font-semibold text-fg truncate">{p.user.name ?? "Unknown"}</span>
                        <span className={`badge uppercase ${pc.tw}`}>
                          {p.user.subscription?.plan ?? "free"}
                        </span>
                      </div>
                      <div className="text-[11px] text-fg-4 mt-0.5">
                        {p.interviews} interviews · {p.resumes} resumes · {p.sessions} active days
                        {p.lastActiveDays !== null && ` · last seen ${p.lastActiveDays}d ago`}
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-base font-semibold text-brand-fg">{p.score}</div>
                      <div className="text-[11px] text-fg-4">score</div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      </section>

      {/* ═══ Acquisition channel quality ═══ */}
      <section>
        <SL>Decision: which signup channels to invest in</SL>
        <Card>
          <div className="flex items-baseline justify-between mb-3 flex-wrap gap-1">
            <CardTitle>Channel quality matrix</CardTitle>
            <span className="text-[11px] text-fg-4">Where good customers come from</span>
          </div>
          {channels.length === 0 ? (
            <div className="text-xs text-fg-4 py-8 text-center">No provider data yet.</div>
          ) : isMobile ? (
            // Mobile: card list
            <div className="flex flex-col gap-2">
              {channels.map(c => (
                <div key={c.provider} className="p-3 bg-subtle rounded-xl border border-line-soft">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-bold text-fg capitalize">{c.provider}</span>
                    <span className="text-[11px] text-fg-3">{c.signups} signups</span>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <div>
                      <div className="label">Activated</div>
                      <div className="text-sm font-bold text-info-fg">{c.activationPct.toFixed(0)}%</div>
                    </div>
                    <div>
                      <div className="label">Paid</div>
                      <div className="text-sm font-bold text-success-fg">{c.conversionPct.toFixed(0)}%</div>
                    </div>
                    <div>
                      <div className="label">30d ret</div>
                      <div className="text-sm font-bold text-violet-fg">{c.retention30Pct.toFixed(0)}%</div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            // Desktop: table
            <table className="w-full border-collapse">
              <thead>
                <tr className="border-b border-line-soft">
                  {["Provider", "Signups", "Activated", "Paid", "30d retention"].map(h => (
                    <th key={h} className="px-3 py-2.5 text-left label">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {channels.map(c => (
                  <tr key={c.provider} className="border-b border-line-soft last:border-0 hover:bg-hover">
                    <td className="px-3 py-3 text-sm font-semibold text-fg capitalize">{c.provider}</td>
                    <td className="px-3 py-3 text-sm text-fg-2">{c.signups}</td>
                    <td className="px-3 py-3">
                      <div className="flex items-center gap-2">
                        <div className="flex-1 max-w-[100px] bg-raised-2 rounded-full overflow-hidden h-1.5">
                          <div className="h-full bg-info" style={{ width: `${c.activationPct}%` }} />
                        </div>
                        <span className="text-xs font-bold text-info-fg w-10">{c.activationPct.toFixed(0)}%</span>
                      </div>
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex items-center gap-2">
                        <div className="flex-1 max-w-[100px] bg-raised-2 rounded-full overflow-hidden h-1.5">
                          <div className="h-full bg-success" style={{ width: `${c.conversionPct}%` }} />
                        </div>
                        <span className="text-xs font-bold text-success-fg w-10">{c.conversionPct.toFixed(0)}%</span>
                      </div>
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex items-center gap-2">
                        <div className="flex-1 max-w-[100px] bg-raised-2 rounded-full overflow-hidden h-1.5">
                          <div className="h-full bg-violet" style={{ width: `${c.retention30Pct}%` }} />
                        </div>
                        <span className="text-xs font-bold text-violet-fg w-10">{c.retention30Pct.toFixed(0)}%</span>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="text-[11px] text-fg-4 mt-3">
            High signups + low conversion = channel is bringing in unqualified users.
            Low signups + high conversion = channel under-invested in.
          </p>
        </Card>
      </section>

      {/* ═══ Plan distribution ═══ */}
      <section>
        <SL>Plan distribution</SL>
        <Card>
          <CardTitle>Users by plan</CardTitle>
          {(() => {
            const planMap: Record<string, number> = {};
            users.forEach(u => {
              const p = (u.subscription?.plan ?? "free") as string;
              planMap[p] = (planMap[p] ?? 0) + 1;
            });
            const planEntries = Object.entries(planMap).sort((a, b) => b[1] - a[1]);
            return (
              <Bars
                labels={planEntries.map(([p]) => p)}
                height={isMobile ? 180 : 220}
                yFormat={(v) => v.toLocaleString()}
                series={[{
                  label: "Users",
                  data: planEntries.map(([, n]) => n),
                  color: "#5b6cff",
                }]}
              />
            );
          })()}
        </Card>
      </section>

    </div>
  );
}