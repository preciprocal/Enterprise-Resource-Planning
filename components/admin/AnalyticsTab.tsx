// components/admin/AnalyticsTab.tsx
"use client";

import { useEffect, useState, useMemo } from "react";
import {
  User, USAGE_FIELDS,
  MetricCard, HBar, BarChart, SL, Card, CardTitle, Spinner, useIsMobile,
} from "./admin-shared";

interface Props { users: User[]; loading: boolean; }

// ─── Raw types from Firestore ─────────────────────────────────────────────────
interface Interview {
  id: string; userId?: string; createdAt?: string;
  type?: string; role?: string; level?: string;
  finalized?: boolean; techstack?: string[];
  [key: string]: unknown;
}
interface Feedback {
  id: string; userId?: string; interviewId?: string; createdAt?: string;
  totalScore?: number; categoryScores?: Record<string, number>;
  [key: string]: unknown;
}
interface Resume {
  id: string; userId?: string; createdAt?: string;
  jobTitle?: string; status?: string;
  [key: string]: unknown;
}
interface Transcript {
  id: string; userId?: string; createdAt?: string;
  [key: string]: unknown;
}

interface AnalyticsPayload {
  interviews:  Interview[];
  feedbacks:   Feedback[];
  resumes:     Resume[];
  transcripts: Transcript[];
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
function bucketByMonth(items: { createdAt?: string }[], months: string[]): number[] {
  const counts: Record<string, number> = {};
  months.forEach(m => { counts[m] = 0; });
  items.forEach(item => {
    if (!item.createdAt) return;
    try {
      const d = new Date(item.createdAt);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      if (key in counts) counts[key]++;
    } catch { /* ignore */ }
  });
  return months.map(m => counts[m]);
}

function last8Months(): { key: string; label: string }[] {
  const now = new Date();
  return Array.from({ length: 8 }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - (7 - i), 1);
    return {
      key:   `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`,
      label: d.toLocaleDateString("en-GB", { month: "short", year: "2-digit" }),
    };
  });
}

function avgScore(feedbacks: Feedback[]): number {
  const valid = feedbacks.filter(f => typeof f.totalScore === "number");
  if (!valid.length) return 0;
  return Math.round(valid.reduce((s, f) => s + (f.totalScore as number), 0) / valid.length);
}

function topN<T>(map: Record<string, T>, n: number): [string, T][] {
  return Object.entries(map).sort((a, b) => (b[1] as number) - (a[1] as number)).slice(0, n);
}

// ─── Stat box ─────────────────────────────────────────────────────────────────
function StatBox({ label, value, sub, color = "#6366F1" }: { label: string; value: string | number; sub?: string; color?: string }) {
  return (
    <div className="bg-white border border-gray-100 rounded-xl p-4 flex flex-col gap-1">
      <div className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">{label}</div>
      <div className="text-2xl font-extrabold leading-none tracking-tight mt-1" style={{ color }}>{value}</div>
      {sub && <div className="text-[11px] text-gray-400 mt-0.5">{sub}</div>}
    </div>
  );
}

// ─── Section divider ─────────────────────────────────────────────────────────
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <SL>{title}</SL>
      {children}
    </section>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────
export default function AnalyticsTab({ users, loading: usersLoading }: Props) {
  const isMobile = useIsMobile();
  const [data,        setData]        = useState<AnalyticsPayload | null>(null);
  const [fetching,    setFetching]    = useState(true);
  const [error,       setError]       = useState("");
  const [activeTab,   setActiveTab]   = useState<"overview" | "interviews" | "resumes" | "users">("overview");

  useEffect(() => {
    async function load() {
      setFetching(true); setError("");
      try {
        const secret = process.env.NEXT_PUBLIC_ADMIN_SECRET ?? "";
        const res = await fetch("/api/admin?action=analytics", {
          headers: secret ? { "x-admin-secret": secret } : {},
          cache: "no-store",
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json() as AnalyticsPayload;
        setData(json);
      } catch (e) {
        setError((e as Error).message);
      }
      setFetching(false);
    }
    void load();
  }, []);

  const months = useMemo(() => last8Months(), []);

  // ── Derived metrics ────────────────────────────────────────────────────────
  const metrics = useMemo(() => {
    if (!data) return null;
    const { interviews, feedbacks, resumes, transcripts } = data;
    const now = new Date(), tm = now.getMonth(), ty = now.getFullYear();

    // Interview metrics
    const finalized   = interviews.filter(i => i.finalized);
    const thisMonthIv = interviews.filter(i => { try { const d = new Date(i.createdAt ?? ""); return d.getMonth() === tm && d.getFullYear() === ty; } catch { return false; } });
    const ivByType:  Record<string, number> = {};
    const ivByRole:  Record<string, number> = {};
    const ivByLevel: Record<string, number> = {};
    const techCounts: Record<string, number> = {};
    interviews.forEach(i => {
      if (i.type)  ivByType[i.type]   = (ivByType[i.type]  ?? 0) + 1;
      if (i.role)  ivByRole[i.role]   = (ivByRole[i.role]  ?? 0) + 1;
      if (i.level) ivByLevel[i.level] = (ivByLevel[i.level]?? 0) + 1;
      (i.techstack ?? []).forEach((t: string) => { techCounts[t] = (techCounts[t] ?? 0) + 1; });
    });

    // Feedback / score metrics
    const avgTotalScore  = avgScore(feedbacks);
    const scoresByMonth  = months.map(m => {
      const inMonth = feedbacks.filter(f => { try { const d = new Date(f.createdAt ?? ""); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}` === m.key; } catch { return false; } });
      return inMonth.length ? avgScore(inMonth) : 0;
    });

    // Category score averages
    const catAccum: Record<string, { sum: number; count: number }> = {};
    feedbacks.forEach(f => {
      if (!f.categoryScores) return;
      Object.entries(f.categoryScores).forEach(([cat, score]) => {
        if (!catAccum[cat]) catAccum[cat] = { sum: 0, count: 0 };
        catAccum[cat].sum   += Number(score);
        catAccum[cat].count += 1;
      });
    });
    const categoryAvgs = Object.entries(catAccum)
      .map(([cat, { sum, count }]) => ({ cat, avg: Math.round(sum / count) }))
      .sort((a, b) => b.avg - a.avg);

    // Unique active users (by collection)
    const ivUsers      = new Set(interviews.map(i => i.userId)).size;
    const resumeUsers  = new Set(resumes.map(r => r.userId)).size;
    const feedbackUsers = new Set(feedbacks.map(f => f.userId)).size;

    // Resume metrics
    const resumesByStatus: Record<string, number> = {};
    resumes.forEach(r => {
      const s = (r.status as string) ?? "unknown";
      resumesByStatus[s] = (resumesByStatus[s] ?? 0) + 1;
    });
    const thisMonthRe = resumes.filter(r => { try { const d = new Date((r.createdAt ?? "") as string); return d.getMonth() === tm && d.getFullYear() === ty; } catch { return false; } });

    // Engagement: users who have done ≥1 interview + ≥1 resume
    const bothSets = new Set([...interviews.map(i => i.userId), ...resumes.map(r => r.userId)]);
    const ivSet    = new Set(interviews.map(i => i.userId));
    const reSet    = new Set(resumes.map(r => r.userId));
    const engagedBoth = [...ivSet].filter(u => reSet.has(u)).length;

    // Monthly volumes
    const monthKeys = months.map(m => m.key);
    const ivMonthly     = bucketByMonth(interviews,  monthKeys);
    const resumeMonthly = bucketByMonth(resumes,     monthKeys);
    const fbMonthly     = bucketByMonth(feedbacks,   monthKeys);

    // User usage stats from users collection
    const planCounts = { free: 0, pro: 0, premium: 0, enterprise: 0 };
    users.forEach(u => {
      const p = (u.subscription?.plan ?? "free") as string;
      if (p in planCounts) planCounts[p as keyof typeof planCounts]++;
    });
    const totalUsage = USAGE_FIELDS.reduce((s, f) => {
      return s + users.reduce((us, u) => us + ((u.usage?.[f.key] as number) ?? 0), 0);
    }, 0);
    const featureAdoption = USAGE_FIELDS.map(f => ({
      label: f.label,
      color: f.color,
      total:    users.reduce((s, u) => s + ((u.usage?.[f.key] as number) ?? 0), 0),
      adopters: users.filter(u => ((u.usage?.[f.key] as number) ?? 0) > 0).length,
    })).sort((a, b) => b.total - a.total);

    return {
      // Interviews
      totalInterviews: interviews.length, finalized: finalized.length,
      thisMonthIv, ivByType, ivByRole, ivByLevel, techCounts,
      ivMonthly, fbMonthly, resumeMonthly,
      // Scores
      avgTotalScore, scoresByMonth, categoryAvgs,
      // Resumes
      totalResumes: resumes.length, resumesByStatus, thisMonthRe,
      // Transcripts
      totalTranscripts: transcripts.length,
      // Users
      ivUsers, resumeUsers, feedbackUsers, engagedBoth,
      bothSets: bothSets.size,
      // Feature usage
      totalUsage, featureAdoption, planCounts,
    };
  }, [data, users, months]);

  if (usersLoading || fetching) return <Spinner />;
  if (error) return (
    <div className="flex-1 flex flex-col items-center justify-center gap-3 text-center p-8">
      <div className="w-10 h-10 rounded-full bg-rose-50 flex items-center justify-center">
        <svg width="18" height="18" fill="none" stroke="#F43F5E" strokeWidth="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
      </div>
      <div className="text-sm font-semibold text-gray-700">Failed to load analytics</div>
      <div className="text-xs text-gray-400 font-mono">{error}</div>
    </div>
  );
  if (!metrics) return <div className="flex-1 flex items-center justify-center text-sm text-gray-400">No data.</div>;

  const m = metrics;
  const completionRate = m.totalInterviews ? Math.round((m.finalized / m.totalInterviews) * 100) : 0;

  return (
    <div className="flex-1 overflow-auto p-4 md:p-7 flex flex-col gap-5">

      {/* ── Sub-nav ── */}
      <div className="flex gap-1 bg-gray-100 rounded-xl p-1 shrink-0">
        {([
          { id: "overview",    label: "Overview"    },
          { id: "interviews",  label: "Interviews"  },
          { id: "resumes",     label: "Resumes"     },
          { id: "users",       label: "User Behaviour" },
        ] as { id: typeof activeTab; label: string }[]).map(t => (
          <button key={t.id} onClick={() => setActiveTab(t.id)}
            className={`flex-1 py-2 rounded-lg text-xs font-semibold border-none cursor-pointer font-[inherit] transition-all ${activeTab === t.id ? "bg-white text-gray-900 shadow-sm" : "bg-transparent text-gray-500 hover:text-gray-700"}`}>
            {isMobile ? t.label.split(" ")[0] : t.label}
          </button>
        ))}
      </div>

      {/* ═══════════ OVERVIEW ═══════════ */}
      {activeTab === "overview" && (
        <>
          <Section title="Platform Activity">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <StatBox label="Total Interviews"  value={m.totalInterviews}   color="#6366F1" sub={`${m.thisMonthIv.length} this month`} />
              <StatBox label="Completed"         value={m.finalized}         color="#10B981" sub={`${completionRate}% completion rate`} />
              <StatBox label="Avg Score"         value={m.avgTotalScore > 0 ? `${m.avgTotalScore}/100` : "—"} color="#F59E0B" sub="Across all feedback" />
              <StatBox label="Total Resumes"     value={m.totalResumes}      color="#8B5CF6" sub={`${m.thisMonthRe.length} this month`} />
            </div>
          </Section>

          <Section title="Monthly Volume">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <Card>
                <CardTitle>Interviews Created</CardTitle>
                <BarChart data={months.map((mo, i) => ({ l: mo.label, v: m.ivMonthly[i] }))} color="#6366F1" h={isMobile ? 60 : 80} />
              </Card>
              <Card>
                <CardTitle>Feedback Submitted</CardTitle>
                <BarChart data={months.map((mo, i) => ({ l: mo.label, v: m.fbMonthly[i] }))} color="#10B981" h={isMobile ? 60 : 80} />
              </Card>
              <Card>
                <CardTitle>Resumes Uploaded</CardTitle>
                <BarChart data={months.map((mo, i) => ({ l: mo.label, v: m.resumeMonthly[i] }))} color="#8B5CF6" h={isMobile ? 60 : 80} />
              </Card>
            </div>
          </Section>

          <Section title="Unique Active Users">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <StatBox label="Used Interviews"  value={m.ivUsers}       color="#6366F1" sub="Unique users" />
              <StatBox label="Uploaded Resumes" value={m.resumeUsers}   color="#8B5CF6" sub="Unique users" />
              <StatBox label="Got Feedback"     value={m.feedbackUsers} color="#10B981" sub="Unique users" />
              <StatBox label="Used Both"        value={m.engagedBoth}   color="#F59E0B" sub="Interview + Resume" />
            </div>
          </Section>
        </>
      )}

      {/* ═══════════ INTERVIEWS ═══════════ */}
      {activeTab === "interviews" && (
        <>
          <Section title="Interview Stats">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <StatBox label="Total"        value={m.totalInterviews}  color="#6366F1" />
              <StatBox label="Finalized"    value={m.finalized}        color="#10B981" sub={`${completionRate}% rate`} />
              <StatBox label="Avg Score"    value={m.avgTotalScore > 0 ? `${m.avgTotalScore}/100` : "—"} color="#F59E0B" />
              <StatBox label="With Transcripts" value={m.totalTranscripts} color="#8B5CF6" />
            </div>
          </Section>

          <Section title="Score Trend (Avg per Month)">
            <Card>
              <CardTitle>Average Score by Month</CardTitle>
              <BarChart data={months.map((mo, i) => ({ l: mo.label, v: m.scoresByMonth[i] }))} color="#F59E0B" h={isMobile ? 65 : 90} />
            </Card>
          </Section>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Section title="By Interview Type">
              <Card>
                <div className="flex flex-col gap-2">
                  {Object.keys(m.ivByType).length === 0
                    ? <p className="text-xs text-gray-400">No data</p>
                    : topN(m.ivByType, 8).map(([type, count]) => {
                        const pct = Math.round((count / m.totalInterviews) * 100);
                        return (
                          <div key={type} className="flex items-center gap-3">
                            <span className="text-xs text-gray-700 font-medium shrink-0 w-28 truncate capitalize">{type}</span>
                            <HBar pct={pct} color="#6366F1" />
                            <span className="text-xs font-bold text-gray-900 shrink-0 w-7 text-right">{count}</span>
                            <span className="text-[10px] text-indigo-500 font-bold shrink-0 w-8 text-right">{pct}%</span>
                          </div>
                        );
                      })}
                </div>
              </Card>
            </Section>

            <Section title="By Level">
              <Card>
                <div className="flex flex-col gap-2">
                  {Object.keys(m.ivByLevel).length === 0
                    ? <p className="text-xs text-gray-400">No data</p>
                    : topN(m.ivByLevel, 8).map(([level, count]) => {
                        const pct = Math.round((count / m.totalInterviews) * 100);
                        return (
                          <div key={level} className="flex items-center gap-3">
                            <span className="text-xs text-gray-700 font-medium shrink-0 w-28 truncate capitalize">{level}</span>
                            <HBar pct={pct} color="#10B981" />
                            <span className="text-xs font-bold text-gray-900 shrink-0 w-7 text-right">{count}</span>
                            <span className="text-[10px] text-emerald-500 font-bold shrink-0 w-8 text-right">{pct}%</span>
                          </div>
                        );
                      })}
                </div>
              </Card>
            </Section>
          </div>

          <Section title="Top Roles Practised">
            <Card>
              <div className="flex flex-col gap-2">
                {Object.keys(m.ivByRole).length === 0
                  ? <p className="text-xs text-gray-400">No role data</p>
                  : topN(m.ivByRole, 10).map(([role, count]) => {
                      const pct = Math.round((count / m.totalInterviews) * 100);
                      return (
                        <div key={role} className="flex items-center gap-3">
                          <span className="text-xs text-gray-700 font-medium shrink-0 w-40 truncate">{role}</span>
                          <HBar pct={pct} color="#8B5CF6" />
                          <span className="text-xs font-bold text-gray-900 shrink-0 w-7 text-right">{count}</span>
                          <span className="text-[10px] text-violet-500 font-bold shrink-0 w-8 text-right">{pct}%</span>
                        </div>
                      );
                    })}
              </div>
            </Card>
          </Section>

          {m.categoryAvgs.length > 0 && (
            <Section title="Average Score by Category">
              <Card>
                <div className="flex flex-col gap-2">
                  {m.categoryAvgs.map(({ cat, avg }) => (
                    <div key={cat} className="flex items-center gap-3">
                      <span className="text-xs text-gray-700 font-medium shrink-0 w-40 truncate">{cat}</span>
                      <HBar pct={avg} color={avg >= 70 ? "#10B981" : avg >= 50 ? "#F59E0B" : "#F43F5E"} />
                      <span className="text-xs font-bold shrink-0 w-10 text-right" style={{ color: avg >= 70 ? "#10B981" : avg >= 50 ? "#F59E0B" : "#F43F5E" }}>{avg}/100</span>
                    </div>
                  ))}
                </div>
              </Card>
            </Section>
          )}

          {Object.keys(m.techCounts).length > 0 && (
            <Section title="Top Tech Stacks Practised">
              <Card>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-2">
                  {topN(m.techCounts, 12).map(([tech, count]) => {
                    const pct = Math.round((count / m.totalInterviews) * 100);
                    return (
                      <div key={tech} className="flex items-center gap-3">
                        <span className="text-xs text-gray-700 font-medium shrink-0 w-24 truncate">{tech}</span>
                        <HBar pct={pct} color="#0EA5E9" />
                        <span className="text-xs font-bold text-gray-900 shrink-0 w-7 text-right">{count}</span>
                      </div>
                    );
                  })}
                </div>
              </Card>
            </Section>
          )}
        </>
      )}

      {/* ═══════════ RESUMES ═══════════ */}
      {activeTab === "resumes" && (
        <>
          <Section title="Resume Stats">
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              <StatBox label="Total Resumes"   value={m.totalResumes}         color="#8B5CF6" />
              <StatBox label="This Month"      value={m.thisMonthRe.length}   color="#6366F1" />
              <StatBox label="Unique Users"    value={m.resumeUsers}          color="#10B981" sub="Uploaded ≥1 resume" />
            </div>
          </Section>

          <Section title="Monthly Uploads">
            <Card>
              <CardTitle>Resumes Uploaded per Month</CardTitle>
              <BarChart data={months.map((mo, i) => ({ l: mo.label, v: m.resumeMonthly[i] }))} color="#8B5CF6" h={isMobile ? 65 : 90} />
            </Card>
          </Section>

          {Object.keys(m.resumesByStatus).length > 0 && (
            <Section title="By Status">
              <Card>
                <div className="flex flex-col gap-2">
                  {topN(m.resumesByStatus, 10).map(([status, count]) => {
                    const pct = m.totalResumes ? Math.round((count / m.totalResumes) * 100) : 0;
                    return (
                      <div key={status} className="flex items-center gap-3">
                        <span className="text-xs text-gray-700 font-medium shrink-0 w-36 truncate capitalize">{status}</span>
                        <HBar pct={pct} color="#8B5CF6" />
                        <span className="text-xs font-bold text-gray-900 shrink-0 w-7 text-right">{count}</span>
                        <span className="text-[10px] text-violet-500 font-bold shrink-0 w-8 text-right">{pct}%</span>
                      </div>
                    );
                  })}
                </div>
              </Card>
            </Section>
          )}
        </>
      )}

      {/* ═══════════ USER BEHAVIOUR ═══════════ */}
      {activeTab === "users" && (
        <>
          <Section title="Plan Distribution">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {Object.entries(m.planCounts).map(([plan, count]) => {
                const colors: Record<string, string> = { free: "#9CA3AF", pro: "#3B82F6", premium: "#F59E0B", enterprise: "#10B981" };
                return <StatBox key={plan} label={plan.charAt(0).toUpperCase() + plan.slice(1)} value={count} color={colors[plan] ?? "#6366F1"} sub={users.length ? `${Math.round((count / users.length) * 100)}% of users` : ""} />;
              })}
            </div>
          </Section>

          <Section title="Feature Usage Breakdown">
            <Card>
              <div className="flex items-baseline justify-between mb-4 flex-wrap gap-1">
                <CardTitle>Actions per Feature</CardTitle>
                <span className="text-[11px] text-gray-400">{m.totalUsage.toLocaleString()} total actions</span>
              </div>
              <div className="flex flex-col gap-0">
                {m.featureAdoption.map(f => {
                  const maxTotal = m.featureAdoption[0]?.total ?? 1;
                  const pct      = Math.round((f.total / maxTotal) * 100);
                  const ar       = users.length ? Math.round((f.adopters / users.length) * 100) : 0;
                  return (
                    <div key={f.label} className="flex items-center gap-3 py-2 border-b border-gray-50">
                      <div className="w-2 h-2 rounded-full shrink-0" style={{ background: f.color }} />
                      <span className="text-xs text-gray-700 font-medium shrink-0 w-28 truncate">{f.label}</span>
                      <HBar pct={pct} color={f.color} />
                      <span className="text-xs font-bold text-gray-900 shrink-0 w-10 text-right">{f.total.toLocaleString()}</span>
                      {!isMobile && <span className="text-[10px] font-bold shrink-0 w-10 text-right" style={{ color: f.color }}>{ar}% users</span>}
                    </div>
                  );
                })}
              </div>
            </Card>
          </Section>

          <Section title="Engagement Depth">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {([
                ["Interview-only Users",  m.ivUsers - m.engagedBoth,     "#6366F1", "Used interviews, not resumes"],
                ["Resume-only Users",     m.resumeUsers - m.engagedBoth, "#8B5CF6", "Used resumes, not interviews"],
                ["Fully Engaged",         m.engagedBoth,                 "#10B981", "Used both interviews + resumes"],
              ] as [string, number, string, string][]).map(([label, value, color, sub]) => {
                const pct = users.length ? Math.round((value / users.length) * 100) : 0;
                return (
                  <div key={label} className="bg-white border border-gray-100 rounded-xl p-4">
                    <div className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">{label}</div>
                    <div className="text-2xl font-extrabold leading-none tracking-tight mt-1" style={{ color }}>{value}</div>
                    <div className="text-[11px] text-gray-400 mt-1 mb-3">{sub}</div>
                    <HBar pct={pct} color={color} height={5} />
                    <div className="text-[11px] font-bold mt-1.5" style={{ color }}>{pct}% of users</div>
                  </div>
                );
              })}
            </div>
          </Section>
        </>
      )}

    </div>
  );
}