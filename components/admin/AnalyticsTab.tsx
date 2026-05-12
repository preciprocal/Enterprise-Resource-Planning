// components/admin/AnalyticsTab.tsx
"use client";

import { useEffect, useState, useMemo } from "react";
import {
  User, USAGE_FIELDS,
  MetricCard, HBar, BarChart, SL, Card, CardTitle, Spinner, useIsMobile,
} from "./admin-shared";

interface Props { users: User[]; loading: boolean; token?: string; }

// ─── Real Firestore types (from general_action.ts / resume_action.ts) ─────────
interface Interview {
  id: string; userId?: string; createdAt?: string;
  role?: string; type?: string; techstack?: string[];
  company?: string; status?: string; finalized?: boolean;
  score?: number; level?: string; duration?: number;
}
interface Feedback {
  id: string; userId?: string; interviewId?: string; createdAt?: string;
  totalScore?: number;
  // categoryScores can be Record<string,number> OR array of {name,score}
  categoryScores?: Record<string, number> | { name: string; score: number }[];
}
interface Resume {
  id: string; userId?: string; createdAt?: string;
  jobTitle?: string; companyName?: string;
  status?: string; score?: number;
}
interface Plan {
  id: string; userId?: string; createdAt?: string; status?: string;
}

interface Payload { interviews: Interview[]; feedbacks: Feedback[]; resumes: Resume[]; plans: Plan[]; }

// ─── Helpers ──────────────────────────────────────────────────────────────────
function last8Months() {
  const now = new Date();
  return Array.from({ length: 8 }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - (7 - i), 1);
    return {
      key:   `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`,
      label: d.toLocaleDateString("en-GB", { month: "short", year: "2-digit" }),
    };
  });
}

function monthKey(iso?: string) {
  if (!iso) return "";
  try { const d = new Date(iso); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`; }
  catch { return ""; }
}

function bucketBy(items: { createdAt?: string }[], keys: string[]) {
  const m: Record<string, number> = Object.fromEntries(keys.map(k => [k, 0]));
  items.forEach(i => { const k = monthKey(i.createdAt); if (k in m) m[k]++; });
  return keys.map(k => m[k]);
}

function normScores(fb: Feedback): Record<string, number> {
  if (!fb.categoryScores) return {};
  if (Array.isArray(fb.categoryScores)) {
    return Object.fromEntries(fb.categoryScores.map(c => [c.name, c.score]));
  }
  return fb.categoryScores as Record<string, number>;
}

function topN(map: Record<string, number>, n = 8): [string, number][] {
  return Object.entries(map).sort((a, b) => b[1] - a[1]).slice(0, n);
}

function avg(nums: number[]) {
  return nums.length ? Math.round(nums.reduce((a, b) => a + b, 0) / nums.length) : 0;
}

// ─── Tiny components ─────────────────────────────────────────────────────────
function Stat({ label, value, color = "#6366F1", sub }: { label: string; value: string | number; color?: string; sub?: string }) {
  return (
    <div className="bg-white border border-gray-100 rounded-xl p-4">
      <div className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">{label}</div>
      <div className="text-2xl font-extrabold leading-none tracking-tight mt-1.5" style={{ color }}>{value}</div>
      {sub && <div className="text-[11px] text-gray-400 mt-1">{sub}</div>}
    </div>
  );
}

type Tab = "overview" | "interviews" | "resumes" | "users";

// ─── Main ─────────────────────────────────────────────────────────────────────
export default function AnalyticsTab({ users, loading: usersLoading, token = "" }: Props) {
  const isMobile = useIsMobile();
  const [data,     setData]    = useState<Payload | null>(null);
  const [fetching, setFetching] = useState(true);
  const [error,    setError]   = useState("");
  const [tab,      setTab]     = useState<Tab>("overview");

  useEffect(() => {
    async function load() {
      setFetching(true); setError("");
      try {
        const res  = await fetch("/api/admin?action=analytics", {
          headers: token ? { "x-admin-secret": token } : {},
          cache: "no-store",
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        setData(await res.json() as Payload);
      } catch (e) { setError((e as Error).message); }
      setFetching(false);
    }
    void load();
  }, [token]);

  const months = useMemo(() => last8Months(), []);
  const mKeys  = useMemo(() => months.map(m => m.key), [months]);

  const m = useMemo(() => {
    if (!data) return null;
    const { interviews, feedbacks, resumes, plans } = data;
    const now = new Date(), tm = now.getMonth(), ty = now.getFullYear();

    // ── Interview metrics ────────────────────────────────────────────────────
    const finalized   = interviews.filter(i => i.finalized || i.status === "completed");
    const completionRate = interviews.length ? Math.round(finalized.length / interviews.length * 100) : 0;
    const thisMonthIv = interviews.filter(i => { try { const d = new Date(i.createdAt ?? ""); return d.getMonth()===tm && d.getFullYear()===ty; } catch { return false; } });

    // Breakdowns
    const byType:    Record<string,number> = {};
    const byRole:    Record<string,number> = {};
    const byLevel:   Record<string,number> = {};
    const byCompany: Record<string,number> = {};
    const byTech:    Record<string,number> = {};
    interviews.forEach(i => {
      if (i.type)    { byType[i.type]       = (byType[i.type]       ?? 0) + 1; }
      if (i.role)    { byRole[i.role]       = (byRole[i.role]       ?? 0) + 1; }
      if (i.level)   { byLevel[i.level]     = (byLevel[i.level]     ?? 0) + 1; }
      if (i.company) { byCompany[i.company] = (byCompany[i.company] ?? 0) + 1; }
      (i.techstack ?? []).forEach(t => { byTech[t] = (byTech[t] ?? 0) + 1; });
    });

    // Avg interview score (from interview.score field)
    const scoredIv   = interviews.filter(i => typeof i.score === "number");
    const avgIvScore = avg(scoredIv.map(i => i.score as number));

    // Avg duration in minutes
    const durIv      = interviews.filter(i => typeof i.duration === "number" && (i.duration as number) > 0);
    const avgDur     = durIv.length ? Math.round(avg(durIv.map(i => i.duration as number)) / 60) : 0;

    // ── Feedback metrics ─────────────────────────────────────────────────────
    const scoredFb   = feedbacks.filter(f => typeof f.totalScore === "number");
    const avgFbScore = avg(scoredFb.map(f => f.totalScore as number));

    // Score trend by month
    const fbByMonth  = months.map(mo => {
      const inMonth = scoredFb.filter(f => monthKey(f.createdAt) === mo.key);
      return inMonth.length ? avg(inMonth.map(f => f.totalScore as number)) : 0;
    });

    // Category averages
    const catAccum: Record<string, { sum: number; n: number }> = {};
    feedbacks.forEach(f => {
      const scores = normScores(f);
      Object.entries(scores).forEach(([cat, sc]) => {
        if (!catAccum[cat]) catAccum[cat] = { sum: 0, n: 0 };
        catAccum[cat].sum += Number(sc);
        catAccum[cat].n   += 1;
      });
    });
    const catAvgs = Object.entries(catAccum)
      .map(([cat, { sum, n }]) => ({ cat, avg: Math.round(sum / n) }))
      .sort((a, b) => b.avg - a.avg);

    // ── Resume metrics ───────────────────────────────────────────────────────
    const scoredRe   = resumes.filter(r => typeof r.score === "number");
    const avgReScore = avg(scoredRe.map(r => r.score as number));
    const thisMonthRe = resumes.filter(r => { try { const d=new Date(r.createdAt??""); return d.getMonth()===tm&&d.getFullYear()===ty; } catch { return false; } });

    const byReStatus: Record<string,number> = {};
    const byJobTitle: Record<string,number> = {};
    const byCompanyRe: Record<string,number> = {};
    resumes.forEach(r => {
      if (r.status)      { byReStatus[r.status]       = (byReStatus[r.status]       ?? 0) + 1; }
      if (r.jobTitle)    { byJobTitle[r.jobTitle]      = (byJobTitle[r.jobTitle]     ?? 0) + 1; }
      if (r.companyName) { byCompanyRe[r.companyName] = (byCompanyRe[r.companyName] ?? 0) + 1; }
    });

    // ── Monthly volumes ──────────────────────────────────────────────────────
    const ivMonthly = bucketBy(interviews, mKeys);
    const fbMonthly = bucketBy(feedbacks,  mKeys);
    const reMonthly = bucketBy(resumes,    mKeys);

    // ── Unique active users ──────────────────────────────────────────────────
    const ivUsers = new Set(interviews.map(i => i.userId).filter(Boolean)).size;
    const reUsers = new Set(resumes.map(r => r.userId).filter(Boolean)).size;
    const fbUsers = new Set(feedbacks.map(f => f.userId).filter(Boolean)).size;
    const ivSet   = new Set(interviews.map(i => i.userId));
    const reSet   = new Set(resumes.map(r => r.userId));
    const bothUsers = [...ivSet].filter(u => u && reSet.has(u)).length;

    // ── Plan usage ───────────────────────────────────────────────────────────
    const plansThisMonth = plans.filter(p => { try { const d=new Date(p.createdAt??""); return d.getMonth()===tm&&d.getFullYear()===ty; } catch { return false; } });

    // ── User / subscription metrics ──────────────────────────────────────────
    const planCounts: Record<string,number> = { free:0, pro:0, premium:0, enterprise:0 };
    users.forEach(u => { const p = (u.subscription?.plan ?? "free") as string; if (p in planCounts) planCounts[p as keyof typeof planCounts]++; });
    const totalUsageActions = USAGE_FIELDS.reduce((s, f) => s + users.reduce((us, u) => us + ((u.usage?.[f.key] as number) ?? 0), 0), 0);
    const featureBreakdown = USAGE_FIELDS.map(f => ({
      label:    f.label,
      color:    f.color,
      total:    users.reduce((s, u) => s + ((u.usage?.[f.key] as number) ?? 0), 0),
      adopters: users.filter(u => ((u.usage?.[f.key] as number) ?? 0) > 0).length,
    })).sort((a, b) => b.total - a.total);

    return {
      // Interview
      totalIv: interviews.length, finalized: finalized.length, completionRate,
      thisMonthIv, avgIvScore, avgDur,
      byType, byRole, byLevel, byCompany, byTech, catAvgs,
      avgFbScore, fbByMonth, totalFb: feedbacks.length,
      // Resume
      totalRe: resumes.length, avgReScore, thisMonthRe,
      byReStatus, byJobTitle, byCompanyRe, scoredRe,
      // Plans
      totalPlans: plans.length, plansThisMonth,
      // Monthly
      ivMonthly, fbMonthly, reMonthly,
      // Unique users
      ivUsers, reUsers, fbUsers, bothUsers,
      // User behaviour
      planCounts, totalUsageActions, featureBreakdown,
    };
  }, [data, users, months, mKeys]);

  if (usersLoading || fetching) return <Spinner />;
  if (error) return (
    <div className="flex-1 flex flex-col items-center justify-center gap-3 text-center p-8">
      <div className="w-10 h-10 rounded-full bg-rose-50 flex items-center justify-center">
        <svg width="18" height="18" fill="none" stroke="#F43F5E" strokeWidth="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
      </div>
      <div className="text-sm font-semibold text-gray-700">Failed to load analytics</div>
      <div className="text-xs text-gray-400 font-mono bg-gray-50 px-3 py-1.5 rounded-lg">{error}</div>
    </div>
  );
  if (!m) return null;

  return (
    <div className="flex-1 overflow-auto p-4 md:p-7 flex flex-col gap-5">

      {/* Sub-nav */}
      <div className="flex gap-1 bg-gray-100 rounded-xl p-1 shrink-0">
        {(["overview","interviews","resumes","users"] as Tab[]).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`flex-1 py-2 rounded-lg text-xs font-semibold border-none cursor-pointer font-[inherit] transition-all capitalize ${tab===t ? "bg-white text-gray-900 shadow-sm" : "bg-transparent text-gray-500 hover:text-gray-700"}`}>
            {isMobile ? t.slice(0,4) : t.charAt(0).toUpperCase()+t.slice(1)}
          </button>
        ))}
      </div>

      {/* ═══ OVERVIEW ═══ */}
      {tab === "overview" && (
        <>
          <section>
            <SL>Platform Activity</SL>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <Stat label="Total Interviews"  value={m.totalIv}        color="#6366F1" sub={`${m.thisMonthIv.length} this month`} />
              <Stat label="Completed"         value={m.finalized}      color="#10B981" sub={`${m.completionRate}% completion`} />
              <Stat label="Avg Feedback Score" value={m.avgFbScore > 0 ? `${m.avgFbScore}/100` : "—"} color="#F59E0B" sub="Across all feedback" />
              <Stat label="Resumes Analysed"  value={m.totalRe}        color="#8B5CF6" sub={`${m.thisMonthRe.length} this month`} />
            </div>
          </section>

          <section>
            <SL>Monthly Volumes</SL>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <Card><CardTitle>Interviews</CardTitle><BarChart data={months.map((mo,i)=>({l:mo.label,v:m.ivMonthly[i]}))} color="#6366F1" h={isMobile?55:75} /></Card>
              <Card><CardTitle>Feedback Submitted</CardTitle><BarChart data={months.map((mo,i)=>({l:mo.label,v:m.fbMonthly[i]}))} color="#F59E0B" h={isMobile?55:75} /></Card>
              <Card><CardTitle>Resumes Uploaded</CardTitle><BarChart data={months.map((mo,i)=>({l:mo.label,v:m.reMonthly[i]}))} color="#8B5CF6" h={isMobile?55:75} /></Card>
            </div>
          </section>

          <section>
            <SL>Unique Active Users</SL>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <Stat label="Did Interviews"   value={m.ivUsers}    color="#6366F1" sub="Unique users" />
              <Stat label="Got Feedback"     value={m.fbUsers}    color="#F59E0B" sub="Unique users" />
              <Stat label="Uploaded Resumes" value={m.reUsers}    color="#8B5CF6" sub="Unique users" />
              <Stat label="Used Both"        value={m.bothUsers}  color="#10B981" sub="Interview + Resume" />
            </div>
          </section>
        </>
      )}

      {/* ═══ INTERVIEWS ═══ */}
      {tab === "interviews" && (
        <>
          <section>
            <SL>Interview Stats</SL>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <Stat label="Total"          value={m.totalIv}          color="#6366F1" />
              <Stat label="Completed"      value={m.finalized}        color="#10B981" sub={`${m.completionRate}% rate`} />
              <Stat label="Avg Score"      value={m.avgIvScore > 0 ? `${m.avgIvScore}/100` : "—"} color="#F59E0B" />
              <Stat label="Avg Duration"   value={m.avgDur > 0 ? `${m.avgDur} min` : "—"} color="#8B5CF6" />
            </div>
          </section>

          <section>
            <SL>AI Feedback Score Trend</SL>
            <Card>
              <CardTitle>Average Feedback Score by Month</CardTitle>
              <BarChart data={months.map((mo,i)=>({l:mo.label,v:m.fbByMonth[i]}))} color="#F59E0B" h={isMobile?60:85} />
            </Card>
          </section>

          {m.catAvgs.length > 0 && (
            <section>
              <SL>Average Score by Category</SL>
              <Card>
                <div className="flex flex-col gap-2">
                  {m.catAvgs.map(({ cat, avg: a }) => (
                    <div key={cat} className="flex items-center gap-3">
                      <span className="text-xs text-gray-700 font-medium shrink-0 w-44 truncate">{cat}</span>
                      <HBar pct={a} color={a>=70?"#10B981":a>=50?"#F59E0B":"#F43F5E"} />
                      <span className="text-xs font-bold shrink-0 w-12 text-right" style={{ color: a>=70?"#10B981":a>=50?"#F59E0B":"#F43F5E" }}>{a}/100</span>
                    </div>
                  ))}
                </div>
              </Card>
            </section>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {Object.keys(m.byType).length > 0 && (
              <section>
                <SL>By Interview Type</SL>
                <Card>
                  {topN(m.byType).map(([type, count]) => {
                    const pct = Math.round(count/m.totalIv*100);
                    return (
                      <div key={type} className="flex items-center gap-3 py-1.5">
                        <span className="text-xs text-gray-700 font-medium shrink-0 w-28 truncate capitalize">{type}</span>
                        <HBar pct={pct} color="#6366F1" />
                        <span className="text-xs font-bold text-gray-900 shrink-0 w-7 text-right">{count}</span>
                        <span className="text-[10px] text-indigo-500 font-bold shrink-0 w-8 text-right">{pct}%</span>
                      </div>
                    );
                  })}
                </Card>
              </section>
            )}

            {Object.keys(m.byLevel).length > 0 && (
              <section>
                <SL>By Seniority Level</SL>
                <Card>
                  {topN(m.byLevel).map(([level, count]) => {
                    const pct = Math.round(count/m.totalIv*100);
                    return (
                      <div key={level} className="flex items-center gap-3 py-1.5">
                        <span className="text-xs text-gray-700 font-medium shrink-0 w-28 truncate capitalize">{level}</span>
                        <HBar pct={pct} color="#10B981" />
                        <span className="text-xs font-bold text-gray-900 shrink-0 w-7 text-right">{count}</span>
                        <span className="text-[10px] text-emerald-500 font-bold shrink-0 w-8 text-right">{pct}%</span>
                      </div>
                    );
                  })}
                </Card>
              </section>
            )}
          </div>

          {Object.keys(m.byRole).length > 0 && (
            <section>
              <SL>Top Roles Practised</SL>
              <Card>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-x-10 gap-y-0">
                  {topN(m.byRole, 12).map(([role, count]) => {
                    const pct = Math.round(count/m.totalIv*100);
                    return (
                      <div key={role} className="flex items-center gap-3 py-1.5 border-b border-gray-50">
                        <span className="text-xs text-gray-700 font-medium shrink-0 w-36 truncate">{role}</span>
                        <HBar pct={pct} color="#8B5CF6" />
                        <span className="text-xs font-bold text-gray-900 shrink-0 w-7 text-right">{count}</span>
                      </div>
                    );
                  })}
                </div>
              </Card>
            </section>
          )}

          {Object.keys(m.byTech).length > 0 && (
            <section>
              <SL>Top Tech Stacks</SL>
              <Card>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-x-10 gap-y-0">
                  {topN(m.byTech, 12).map(([tech, count]) => {
                    const pct = Math.round(count/m.totalIv*100);
                    return (
                      <div key={tech} className="flex items-center gap-3 py-1.5 border-b border-gray-50">
                        <span className="text-xs text-gray-700 font-medium shrink-0 w-28 truncate">{tech}</span>
                        <HBar pct={pct} color="#0EA5E9" />
                        <span className="text-xs font-bold text-gray-900 shrink-0 w-7 text-right">{count}</span>
                        <span className="text-[10px] text-sky-500 font-bold shrink-0 w-8 text-right">{pct}%</span>
                      </div>
                    );
                  })}
                </div>
              </Card>
            </section>
          )}

          {Object.keys(m.byCompany).length > 0 && (
            <section>
              <SL>Top Companies Targeted</SL>
              <Card>
                {topN(m.byCompany, 10).map(([co, count]) => {
                  const pct = Math.round(count/m.totalIv*100);
                  return (
                    <div key={co} className="flex items-center gap-3 py-1.5 border-b border-gray-50">
                      <span className="text-xs text-gray-700 font-medium shrink-0 w-40 truncate">{co}</span>
                      <HBar pct={pct} color="#EC4899" />
                      <span className="text-xs font-bold text-gray-900 shrink-0 w-7 text-right">{count}</span>
                    </div>
                  );
                })}
              </Card>
            </section>
          )}
        </>
      )}

      {/* ═══ RESUMES ═══ */}
      {tab === "resumes" && (
        <>
          <section>
            <SL>Resume Stats</SL>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <Stat label="Total Resumes"   value={m.totalRe}                                             color="#8B5CF6" />
              <Stat label="This Month"      value={m.thisMonthRe.length}                                  color="#6366F1" />
              <Stat label="Avg ATS Score"   value={m.avgReScore > 0 ? `${m.avgReScore}/100` : "—"}        color="#F59E0B" sub="From AI analysis" />
              <Stat label="Unique Users"    value={m.reUsers}                                             color="#10B981" sub="Uploaded ≥1 resume" />
            </div>
          </section>

          <section>
            <SL>Monthly Uploads</SL>
            <Card>
              <CardTitle>Resumes Uploaded per Month</CardTitle>
              <BarChart data={months.map((mo,i)=>({l:mo.label,v:m.reMonthly[i]}))} color="#8B5CF6" h={isMobile?60:85} />
            </Card>
          </section>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {Object.keys(m.byReStatus).length > 0 && (
              <section>
                <SL>By Analysis Status</SL>
                <Card>
                  {topN(m.byReStatus).map(([status, count]) => {
                    const pct = m.totalRe ? Math.round(count/m.totalRe*100) : 0;
                    return (
                      <div key={status} className="flex items-center gap-3 py-1.5">
                        <span className="text-xs text-gray-700 font-medium shrink-0 w-28 truncate capitalize">{status}</span>
                        <HBar pct={pct} color="#8B5CF6" />
                        <span className="text-xs font-bold text-gray-900 shrink-0 w-7 text-right">{count}</span>
                        <span className="text-[10px] text-violet-500 font-bold shrink-0 w-8 text-right">{pct}%</span>
                      </div>
                    );
                  })}
                </Card>
              </section>
            )}

            {Object.keys(m.byJobTitle).length > 0 && (
              <section>
                <SL>Top Target Job Titles</SL>
                <Card>
                  {topN(m.byJobTitle, 8).map(([title, count]) => {
                    const pct = m.totalRe ? Math.round(count/m.totalRe*100) : 0;
                    return (
                      <div key={title} className="flex items-center gap-3 py-1.5">
                        <span className="text-xs text-gray-700 font-medium shrink-0 w-36 truncate">{title}</span>
                        <HBar pct={pct} color="#6366F1" />
                        <span className="text-xs font-bold text-gray-900 shrink-0 w-7 text-right">{count}</span>
                      </div>
                    );
                  })}
                </Card>
              </section>
            )}
          </div>

          {Object.keys(m.byCompanyRe).length > 0 && (
            <section>
              <SL>Top Target Companies</SL>
              <Card>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-x-10">
                  {topN(m.byCompanyRe, 10).map(([co, count]) => {
                    const pct = m.totalRe ? Math.round(count/m.totalRe*100) : 0;
                    return (
                      <div key={co} className="flex items-center gap-3 py-1.5 border-b border-gray-50">
                        <span className="text-xs text-gray-700 font-medium shrink-0 w-36 truncate">{co}</span>
                        <HBar pct={pct} color="#EC4899" />
                        <span className="text-xs font-bold text-gray-900 shrink-0 w-7 text-right">{count}</span>
                      </div>
                    );
                  })}
                </div>
              </Card>
            </section>
          )}
        </>
      )}

      {/* ═══ USER BEHAVIOUR ═══ */}
      {tab === "users" && (
        <>
          <section>
            <SL>Subscription Distribution</SL>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {Object.entries(m.planCounts).map(([plan, count]) => {
                const colors: Record<string,string> = { free:"#9CA3AF", pro:"#3B82F6", premium:"#F59E0B", enterprise:"#10B981" };
                return (
                  <Stat key={plan}
                    label={plan.charAt(0).toUpperCase()+plan.slice(1)}
                    value={count}
                    color={colors[plan]??"#6366F1"}
                    sub={users.length ? `${Math.round(count/users.length*100)}% of users` : ""} />
                );
              })}
            </div>
          </section>

          <section>
            <SL>Feature Usage · {m.totalUsageActions.toLocaleString()} total actions</SL>
            <Card>
              <CardTitle>Actions per Feature</CardTitle>
              <div className="flex flex-col">
                {m.featureBreakdown.map(f => {
                  const maxT = m.featureBreakdown[0]?.total ?? 1;
                  const pct  = Math.round(f.total/maxT*100);
                  const ar   = users.length ? Math.round(f.adopters/users.length*100) : 0;
                  return (
                    <div key={f.label} className="flex items-center gap-3 py-2 border-b border-gray-50">
                      <div className="w-2 h-2 rounded-full shrink-0" style={{ background:f.color }} />
                      <span className="text-xs text-gray-700 font-medium shrink-0 w-28 truncate">{f.label}</span>
                      <HBar pct={pct} color={f.color} />
                      <span className="text-xs font-bold text-gray-900 shrink-0 w-12 text-right">{f.total.toLocaleString()}</span>
                      {!isMobile && <span className="text-[10px] font-bold shrink-0 w-12 text-right" style={{ color:f.color }}>{ar}% users</span>}
                    </div>
                  );
                })}
              </div>
            </Card>
          </section>

          <section>
            <SL>Engagement Depth</SL>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {([
                ["Interview only",     m.ivUsers - m.bothUsers,  "#6366F1", "Used interviews, not resumes"],
                ["Resume only",        m.reUsers - m.bothUsers,  "#8B5CF6", "Used resumes, not interviews"],
                ["Fully engaged",      m.bothUsers,              "#10B981", "Used both interviews + resumes"],
              ] as [string, number, string, string][]).map(([label, value, color, sub]) => {
                const pct = users.length ? Math.round(Math.max(0,value)/users.length*100) : 0;
                return (
                  <div key={label} className="bg-white border border-gray-100 rounded-xl p-4">
                    <div className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">{label}</div>
                    <div className="text-2xl font-extrabold leading-none tracking-tight mt-1.5" style={{ color }}>{Math.max(0,value)}</div>
                    <div className="text-[11px] text-gray-400 mt-1 mb-3">{sub}</div>
                    <HBar pct={pct} color={color} height={4} />
                    <div className="text-[11px] font-bold mt-1" style={{ color }}>{pct}% of users</div>
                  </div>
                );
              })}
            </div>
          </section>
        </>
      )}

    </div>
  );
}