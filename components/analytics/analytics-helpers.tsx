// components/admin/analytics/analytics-helpers.ts
// ─────────────────────────────────────────────────────────────────────────────
// All the actual analytics math lives here.
// Pure functions only — no React, no fetch, no side effects. Easy to test.
// ─────────────────────────────────────────────────────────────────────────────

import { User } from "../admin/admin-shared";
import {
  AppPayload, Interview, Feedback,
  PLAN_MRR, activityDates, lastActivity,
} from "./analytics-types";

// ─── Generic helpers ─────────────────────────────────────────────────────────

export const safeDate = (iso?: string): Date | null => {
  if (!iso) return null;
  const d = new Date(iso);
  return isNaN(d.getTime()) ? null : d;
};

export const monthKey = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;

export const monthLabel = (key: string): string => {
  const [y, m] = key.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("en-GB", { month: "short", year: "2-digit" });
};

export const daysBetween = (a: Date, b: Date): number =>
  Math.floor((b.getTime() - a.getTime()) / 86_400_000);

export const avg = (xs: number[]): number =>
  xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0;

export const median = (xs: number[]): number => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

export const pct = (n: number, d: number): number =>
  d > 0 ? Math.round((n / d) * 1000) / 10 : 0;

// ─── 1.1 MRR waterfall ──────────────────────────────────────────────────────
// Classifies each paying user against the prior month into one of 5 buckets.
// We can't fully reconstruct historical plan changes from a single snapshot —
// so this is a current-month vs prior-month approximation. For accurate
// historical movement, log subscription change events to a separate collection.

export interface MRRMovement {
  startMRR: number;
  newMRR: number;
  expansionMRR: number;
  contractionMRR: number;
  churnedMRR: number;
  reactivationMRR: number;
  endMRR: number;
  netChange: number;
  churnPctOfNew: number; // alert: > 50% = treadmilling
}

export function computeMRRMovement(users: User[]): MRRMovement {
  const now = new Date();
  const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);

  let newMRR = 0, churnedMRR = 0, reactivationMRR = 0;
  let startMRR = 0, endMRR = 0;
  // Expansion/contraction need plan-change history we don't have in this
  // snapshot — set to 0 until you start logging plan transitions.
  const expansionMRR = 0, contractionMRR = 0;

  users.forEach(u => {
    const sub = u.subscription;
    if (!sub) return;
    const plan = (sub.plan ?? "free") as string;
    const planMRR = PLAN_MRR[plan] ?? 0;
    const status = sub.status as string | undefined;
    const periodStart = safeDate(sub.currentPeriodStart);
    const canceledAt = safeDate(sub.canceledAt);

    const isActiveNow = planMRR > 0 && (status === "active" || status === "trialing");

    if (isActiveNow) endMRR += planMRR;

    // New this month: period started in current month
    if (isActiveNow && periodStart && periodStart >= thisMonthStart) {
      newMRR += planMRR;
    } else if (isActiveNow) {
      // Was active before this month → contributed to startMRR
      startMRR += planMRR;
    }

    // Churned this month
    if (canceledAt && canceledAt >= thisMonthStart && canceledAt < now) {
      churnedMRR += planMRR > 0 ? planMRR : (PLAN_MRR["pro"] ?? 9.99);
      // Add their MRR back to start (they were paying at start of month)
      if (!isActiveNow) startMRR += PLAN_MRR["pro"] ?? 9.99;
    }
  });

  const netChange = newMRR + expansionMRR - contractionMRR - churnedMRR + reactivationMRR;
  const churnPctOfNew = newMRR > 0 ? Math.round((churnedMRR / newMRR) * 100) : 0;

  return {
    startMRR: Math.round(startMRR * 100) / 100,
    newMRR: Math.round(newMRR * 100) / 100,
    expansionMRR,
    contractionMRR,
    churnedMRR: Math.round(churnedMRR * 100) / 100,
    reactivationMRR,
    endMRR: Math.round(endMRR * 100) / 100,
    netChange: Math.round(netChange * 100) / 100,
    churnPctOfNew,
  };
}

// ─── 1.2 Cohort retention triangle + NRR/GRR ─────────────────────────────────

export interface CohortRow {
  cohort: string;             // "2025-03"
  cohortLabel: string;        // "Mar 25"
  size: number;               // users in cohort
  retention: (number | null)[]; // [month0, month1, ..., monthN] as %
}

export function computeCohortRetention(
  users: User[],
  data: AppPayload,
  monthsBack = 8
): CohortRow[] {
  const now = new Date();
  const cohorts: Record<string, User[]> = {};

  // Build cohorts: group users by signup month
  users.forEach(u => {
    const created = safeDate(u.createdAt);
    if (!created) return;
    const monthsAgo = (now.getFullYear() - created.getFullYear()) * 12 + (now.getMonth() - created.getMonth());
    if (monthsAgo > monthsBack || monthsAgo < 0) return;
    const k = monthKey(created);
    (cohorts[k] ??= []).push(u);
  });

  // For each cohort, compute % active in each subsequent month
  const rows: CohortRow[] = Object.keys(cohorts).sort().map(k => {
    const members = cohorts[k];
    const [y, m] = k.split("-").map(Number);
    const cohortStart = new Date(y, m - 1, 1);
    const monthsSinceCohort = (now.getFullYear() - y) * 12 + (now.getMonth() - (m - 1));

    const retention: (number | null)[] = [];
    for (let i = 0; i <= monthsSinceCohort; i++) {
      const winStart = new Date(y, m - 1 + i, 1);
      const winEnd = new Date(y, m - 1 + i + 1, 1);
      if (winStart > now) { retention.push(null); continue; }
      const activeCount = members.filter(u => {
        const acts = activityDates(u.id, data, u);
        return acts.some(a => a >= winStart && a < winEnd);
      }).length;
      retention.push(members.length ? Math.round((activeCount / members.length) * 100) : 0);
    }

    return {
      cohort: k,
      cohortLabel: monthLabel(k),
      size: members.length,
      retention,
    };
  });

  return rows;
}

// NRR/GRR by cohort
export interface RevenueRetention {
  cohort: string;
  cohortLabel: string;
  startingMRR: number;
  currentMRR: number;
  grr: number;
  nrr: number;
}

export function computeRevenueRetention(users: User[]): RevenueRetention[] {
  const now = new Date();
  const cohorts: Record<string, User[]> = {};

  users.forEach(u => {
    const periodStart = safeDate(u.subscription?.currentPeriodStart);
    if (!periodStart) return;
    const monthsAgo = (now.getFullYear() - periodStart.getFullYear()) * 12 + (now.getMonth() - periodStart.getMonth());
    if (monthsAgo > 12 || monthsAgo < 0) return;
    const k = monthKey(periodStart);
    (cohorts[k] ??= []).push(u);
  });

  return Object.keys(cohorts).sort().map(k => {
    const members = cohorts[k];
    let startingMRR = 0, currentMRR = 0;

    members.forEach(u => {
      const plan = (u.subscription?.plan ?? "free") as string;
      const planMRR = PLAN_MRR[plan] ?? 0;
      startingMRR += planMRR; // approximation: assume they started at current plan

      const status = u.subscription?.status as string | undefined;
      const canceledAt = safeDate(u.subscription?.canceledAt);
      const isActive = status === "active" || status === "trialing";
      if (isActive && !canceledAt) currentMRR += planMRR;
    });

    const grr = startingMRR > 0 ? Math.round((Math.min(currentMRR, startingMRR) / startingMRR) * 100) : 0;
    const nrr = startingMRR > 0 ? Math.round((currentMRR / startingMRR) * 100) : 0;

    return {
      cohort: k,
      cohortLabel: monthLabel(k),
      startingMRR: Math.round(startingMRR * 100) / 100,
      currentMRR: Math.round(currentMRR * 100) / 100,
      grr,
      nrr,
    };
  });
}

// ─── 1.5 ARPU by plan ────────────────────────────────────────────────────────

export interface ARPUStats {
  plan: string;
  count: number;
  listPrice: number;
  estimatedARPU: number; // before coupons we approximate as listPrice
  couponedCount: number;
  couponPct: number;
}

export function computeARPU(users: User[]): ARPUStats[] {
  const buckets: Record<string, User[]> = {};
  users.forEach(u => {
    const plan = (u.subscription?.plan ?? "free") as string;
    (buckets[plan] ??= []).push(u);
  });

  return Object.keys(buckets).map(plan => {
    const members = buckets[plan];
    const listPrice = PLAN_MRR[plan] ?? 0;
    const couponedCount = members.filter(u => !!u.subscription?.lastAppliedCoupon).length;
    // Coarse estimate: 20% off applied to all couponed users — refine when you log discount amounts
    const couponDiscount = 0.2;
    const estimatedARPU = listPrice * (1 - (couponedCount / Math.max(members.length, 1)) * couponDiscount);

    return {
      plan,
      count: members.length,
      listPrice,
      estimatedARPU: Math.round(estimatedARPU * 100) / 100,
      couponedCount,
      couponPct: pct(couponedCount, members.length),
    };
  }).sort((a, b) => b.listPrice - a.listPrice);
}

// ─── 2.2 Activation funnel ───────────────────────────────────────────────────

export interface FunnelStep {
  label: string;
  count: number;
  pctOfStart: number;
  pctOfPrev: number;
  medianHoursFromPrev: number;
}

export function computeActivationFunnel(users: User[], data: AppPayload): FunnelStep[] {
  const step1Users = new Set<string>();
  const step2Users = new Set<string>();
  const step3Users = new Set<string>();
  const step4Users = new Set<string>();
  const step5Users = new Set<string>();

  const timeToStep2: number[] = [];
  const timeToStep3: number[] = [];
  const timeToStep5: number[] = [];

  users.forEach(u => {
    const created = safeDate(u.createdAt);
    if (!created) return;
    step1Users.add(u.id);

    // Step 2: did first interview OR resume within 24h
    const userInterviews = data.interviews
      .filter(i => i.userId === u.id)
      .map(i => safeDate(i.createdAt))
      .filter((d): d is Date => d !== null)
      .sort((a, b) => a.getTime() - b.getTime());
    const userResumes = data.resumes
      .filter(r => r.userId === u.id)
      .map(r => safeDate(r.createdAt))
      .filter((d): d is Date => d !== null)
      .sort((a, b) => a.getTime() - b.getTime());

    const firstActivity = [userInterviews[0], userResumes[0]].filter(Boolean).sort((a, b) => a!.getTime() - b!.getTime())[0];
    if (firstActivity) {
      const hoursFromSignup = (firstActivity.getTime() - created.getTime()) / 3_600_000;
      if (hoursFromSignup <= 24) {
        step2Users.add(u.id);
        timeToStep2.push(hoursFromSignup);
      }
    }

    // Step 3: completed first interview (finalized)
    const finalizedInterview = data.interviews.find(i => i.userId === u.id && i.finalized);
    if (finalizedInterview && step2Users.has(u.id)) {
      step3Users.add(u.id);
      const fd = safeDate(finalizedInterview.createdAt);
      if (fd && firstActivity) timeToStep3.push((fd.getTime() - firstActivity.getTime()) / 3_600_000);
    }

    // Step 4: got feedback
    const hasFeedback = data.feedbacks.some(f => f.userId === u.id);
    if (hasFeedback && step3Users.has(u.id)) step4Users.add(u.id);

    // Step 5: returned within 7 days for a second session
    if (userInterviews.length >= 2) {
      const gap = (userInterviews[1].getTime() - userInterviews[0].getTime()) / 86_400_000;
      if (gap <= 7 && step4Users.has(u.id)) {
        step5Users.add(u.id);
        timeToStep5.push(gap * 24);
      }
    }
  });

  const start = step1Users.size;
  const mk = (label: string, count: number, prev: number, times: number[]): FunnelStep => ({
    label,
    count,
    pctOfStart: pct(count, start),
    pctOfPrev: pct(count, prev),
    medianHoursFromPrev: Math.round(median(times) * 10) / 10,
  });

  return [
    { label: "Signed up", count: step1Users.size, pctOfStart: 100, pctOfPrev: 100, medianHoursFromPrev: 0 },
    mk("Started first session (24h)", step2Users.size, step1Users.size, timeToStep2),
    mk("Completed first interview", step3Users.size, step2Users.size, timeToStep3),
    mk("Received feedback", step4Users.size, step3Users.size, []),
    mk("Returned within 7 days", step5Users.size, step4Users.size, timeToStep5),
  ];
}

// ─── 2.3 Time-to-value distribution ──────────────────────────────────────────

export function computeTimeToValueHistogram(users: User[], data: AppPayload): { bucket: string; count: number }[] {
  // Buckets in hours: <1h, 1-6h, 6-24h, 1-3d, 3-7d, >7d, never
  const buckets = { "<1h": 0, "1-6h": 0, "6-24h": 0, "1-3d": 0, "3-7d": 0, ">7d": 0 };
  users.forEach(u => {
    const created = safeDate(u.createdAt);
    if (!created) return;
    const firstFinalized = data.interviews
      .filter(i => i.userId === u.id && i.finalized && typeof i.score === "number")
      .map(i => safeDate(i.createdAt))
      .filter((d): d is Date => d !== null)
      .sort((a, b) => a.getTime() - b.getTime())[0];
    if (!firstFinalized) return;
    const h = (firstFinalized.getTime() - created.getTime()) / 3_600_000;
    if (h < 1) buckets["<1h"]++;
    else if (h < 6) buckets["1-6h"]++;
    else if (h < 24) buckets["6-24h"]++;
    else if (h < 72) buckets["1-3d"]++;
    else if (h < 168) buckets["3-7d"]++;
    else buckets[">7d"]++;
  });
  return Object.entries(buckets).map(([bucket, count]) => ({ bucket, count }));
}

// ─── 2.4 Power users ─────────────────────────────────────────────────────────

export interface PowerUser {
  user: User;
  score: number;
  interviews: number;
  resumes: number;
  sessions: number;
  lastActiveDays: number | null;
}

export function computePowerUsers(users: User[], data: AppPayload, limit = 20): PowerUser[] {
  const now = new Date();
  const scored: PowerUser[] = users.map(u => {
    const interviews = data.interviews.filter(i => i.userId === u.id).length;
    const resumes = data.resumes.filter(r => r.userId === u.id).length;
    const acts = activityDates(u.id, data, u);
    const lastA = lastActivity(u.id, data, u);
    // Count distinct active days as a proxy for sessions
    const distinctDays = new Set(acts.map(d => d.toISOString().slice(0, 10))).size;
    const score = Math.round(Math.min(100, interviews * 3 + resumes * 2 + distinctDays * 1));
    return {
      user: u,
      score,
      interviews,
      resumes,
      sessions: distinctDays,
      lastActiveDays: lastA ? daysBetween(lastA, now) : null,
    };
  });
  return scored.sort((a, b) => b.score - a.score).slice(0, limit);
}

// ─── 3.1 Feature ROI matrix ──────────────────────────────────────────────────

export interface FeatureROI {
  feature: string;
  adoptionPct: number;     // % of users who used it
  totalActions: number;
  retentionLift: number;   // % point delta in 30d retention vs non-users
  sample: number;          // number of users used to compute the lift
}

const USAGE_FEATURE_LIST: { key: keyof NonNullable<User["usage"]>; label: string }[] = [
  { key: "resumesUsed",                label: "Resume analyses" },
  { key: "coverLettersUsed",           label: "Cover letters" },
  { key: "studyPlansUsed",             label: "Study plans" },
  { key: "interviewsUsed",             label: "Mock interviews" },
  { key: "interviewDebriefsUsed",      label: "Interview debriefs" },
  { key: "linkedinOptimisationsUsed",  label: "LinkedIn optim." },
  { key: "coldOutreachUsed",           label: "Cold outreach" },
  { key: "findContactsUsed",           label: "Find contacts" },
  { key: "jobTrackerUsed",             label: "Job tracker" },
];

export function computeFeatureROI(users: User[], data: AppPayload): FeatureROI[] {
  const now = new Date();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 86_400_000);

  // For each feature, find users who used it. Compute their 30-day retention vs non-users.
  return USAGE_FEATURE_LIST.map(({ key, label }) => {
    const userSplit = users.reduce(
      (acc, u) => {
        const v = (u.usage?.[key] as number | undefined) ?? 0;
        if (v > 0) acc.used.push(u);
        else acc.notUsed.push(u);
        acc.total += v;
        return acc;
      },
      { used: [] as User[], notUsed: [] as User[], total: 0 }
    );

    const retentionRate = (group: User[]): number => {
      if (group.length === 0) return 0;
      const active = group.filter(u => {
        const la = lastActivity(u.id, data, u);
        return la && la >= thirtyDaysAgo;
      }).length;
      return (active / group.length) * 100;
    };

    const usedRet = retentionRate(userSplit.used);
    const nonRet = retentionRate(userSplit.notUsed);

    return {
      feature: label,
      adoptionPct: pct(userSplit.used.length, users.length),
      totalActions: userSplit.total,
      retentionLift: Math.round((usedRet - nonRet) * 10) / 10,
      sample: userSplit.used.length,
    };
  });
}

// ─── 3.2 Interview score progression ─────────────────────────────────────────

export interface ScoreProgression {
  attempt: number;
  avgScore: number;
  sampleSize: number;
  stdDev: number;
}

export function computeScoreProgression(data: AppPayload, maxAttempts = 8): ScoreProgression[] {
  // Group scored interviews by user, sort by date, index = attempt number
  const byUser: Record<string, Interview[]> = {};
  data.interviews.forEach(i => {
    if (typeof i.score !== "number" || !i.userId || !i.createdAt) return;
    (byUser[i.userId] ??= []).push(i);
  });

  const attemptScores: Record<number, number[]> = {};
  Object.values(byUser).forEach(list => {
    const sorted = list.sort((a, b) => new Date(a.createdAt!).getTime() - new Date(b.createdAt!).getTime());
    sorted.forEach((iv, idx) => {
      const attempt = Math.min(idx + 1, maxAttempts);
      (attemptScores[attempt] ??= []).push(iv.score!);
    });
  });

  return Array.from({ length: maxAttempts }, (_, i) => {
    const n = i + 1;
    const scores = attemptScores[n] ?? [];
    const m = avg(scores);
    const variance = scores.length ? avg(scores.map(s => (s - m) ** 2)) : 0;
    return {
      attempt: n,
      avgScore: Math.round(m),
      sampleSize: scores.length,
      stdDev: Math.round(Math.sqrt(variance)),
    };
  });
}

// ─── 3.3 Category strength ───────────────────────────────────────────────────

export interface CategoryStrength {
  category: string;
  avgScore: number;
  sampleSize: number;
}

function normalizeCategoryScores(f: Feedback): Record<string, number> {
  const raw = f.categoryScores;
  if (!raw) return {};
  if (Array.isArray(raw)) {
    const out: Record<string, number> = {};
    raw.forEach(c => { if (c?.name) out[c.name] = Number(c.score); });
    return out;
  }
  return raw as Record<string, number>;
}

export function computeCategoryStrength(data: AppPayload): CategoryStrength[] {
  const accum: Record<string, { sum: number; n: number }> = {};
  data.feedbacks.forEach(f => {
    Object.entries(normalizeCategoryScores(f)).forEach(([cat, sc]) => {
      const n = Number(sc);
      if (!isFinite(n)) return;
      (accum[cat] ??= { sum: 0, n: 0 });
      accum[cat].sum += n;
      accum[cat].n += 1;
    });
  });
  return Object.entries(accum)
    .map(([category, { sum, n }]) => ({ category, avgScore: Math.round(sum / n), sampleSize: n }))
    .sort((a, b) => a.avgScore - b.avgScore); // weakest first
}

// ─── 3.4 Score distribution by interview type ────────────────────────────────

export interface TypeDistribution {
  type: string;
  count: number;
  min: number;
  q1: number;
  median: number;
  q3: number;
  max: number;
  avg: number;
}

const quantile = (xs: number[], q: number): number => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const pos = (s.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  return s[base + 1] !== undefined ? s[base] + rest * (s[base + 1] - s[base]) : s[base];
};

export function computeTypeDistribution(data: AppPayload, minSample = 5): TypeDistribution[] {
  const byType: Record<string, number[]> = {};
  data.interviews.forEach(i => {
    if (typeof i.score !== "number" || !i.type) return;
    (byType[i.type] ??= []).push(i.score);
  });
  return Object.entries(byType)
    .filter(([, scores]) => scores.length >= minSample)
    .map(([type, scores]) => ({
      type,
      count: scores.length,
      min: Math.round(Math.min(...scores)),
      q1: Math.round(quantile(scores, 0.25)),
      median: Math.round(quantile(scores, 0.5)),
      q3: Math.round(quantile(scores, 0.75)),
      max: Math.round(Math.max(...scores)),
      avg: Math.round(avg(scores)),
    }))
    .sort((a, b) => b.avg - a.avg);
}

// ─── 3.5 Abandonment by slice ────────────────────────────────────────────────

export interface Abandonment {
  slice: string;
  total: number;
  abandoned: number;
  rate: number;
}

export function computeAbandonment(data: AppPayload, dim: "type" | "role" | "level"): Abandonment[] {
  const buckets: Record<string, { total: number; abandoned: number }> = {};
  data.interviews.forEach(i => {
    const key = (i[dim] as string | undefined) ?? "unknown";
    (buckets[key] ??= { total: 0, abandoned: 0 });
    buckets[key].total++;
    if (!i.finalized && i.status !== "completed") buckets[key].abandoned++;
  });
  return Object.entries(buckets)
    .filter(([, v]) => v.total >= 3)
    .map(([slice, { total, abandoned }]) => ({
      slice,
      total,
      abandoned,
      rate: pct(abandoned, total),
    }))
    .sort((a, b) => b.rate - a.rate);
}

// ─── 4.1 Churn risk leaderboard ─────────────────────────────────────────────

export interface ChurnRisk {
  user: User;
  score: number;
  band: "low" | "med" | "high";
  factors: string[];
  lastActivity: Date | null;
  daysSinceActivity: number | null;
}

export function computeChurnRisk(users: User[], data: AppPayload): ChurnRisk[] {
  const now = new Date();

  return users
    .filter(u => {
      const plan = u.subscription?.plan;
      const status = u.subscription?.status;
      // Score only paying / trialing users — free users can't "churn" in the revenue sense
      return (plan === "pro" || plan === "premium" || plan === "enterprise") &&
             (status === "active" || status === "trialing" || status === "past_due");
    })
    .map(u => {
      let score = 0;
      const factors: string[] = [];

      const la = lastActivity(u.id, data, u);
      const dsa = la ? daysBetween(la, now) : null;

      // Inactivity
      if (dsa !== null) {
        if (dsa > 30)      { score += 50; factors.push(`${dsa}d since last activity`); }
        else if (dsa > 14) { score += 30; factors.push(`${dsa}d since last activity`); }
        else if (dsa > 7)  { score += 15; factors.push(`${dsa}d since last activity`); }
      } else {
        score += 40;
        factors.push("Never active");
      }

      // Activity decline: compare last 14d to prior 14d
      const allActs = activityDates(u.id, data, u);
      const last14 = allActs.filter(a => daysBetween(a, now) <= 14).length;
      const prior14 = allActs.filter(a => {
        const d = daysBetween(a, now);
        return d > 14 && d <= 28;
      }).length;
      if (prior14 > 3 && last14 < prior14 * 0.5) {
        score += 20;
        factors.push(`Activity halved (${prior14}→${last14})`);
      }

      // Failed payment
      if (u.subscription?.status === "past_due") {
        score += 25;
        factors.push("Failed payment");
      }

      // Trial approaching end without conversion
      const trialEnd = safeDate(u.subscription?.trialEndsAt);
      const isTrialing = u.subscription?.status === "trialing";
      if (isTrialing && trialEnd) {
        const daysToEnd = daysBetween(now, trialEnd);
        if (daysToEnd >= 0 && daysToEnd <= 3) {
          score += 30;
          factors.push("Trial ends in ≤3 days");
        }
      }

      // Cancel-at-period-end set
      if (u.subscription?.cancelAtPeriodEnd) {
        score += 35;
        factors.push("Cancel scheduled");
      }

      score = Math.min(100, score);
      const band: ChurnRisk["band"] = score >= 60 ? "high" : score >= 30 ? "med" : "low";

      return { user: u, score, band, factors, lastActivity: la, daysSinceActivity: dsa };
    })
    .sort((a, b) => b.score - a.score);
}

// ─── 4.3 Engagement decay (pre-churn pattern) ────────────────────────────────

export interface DecayPoint {
  daysBefore: number; // days before churn (or "now" for retained)
  churnedAvg: number;
  retainedAvg: number;
}

export function computeEngagementDecay(users: User[], data: AppPayload, windowDays = 60): DecayPoint[] {
  const now = new Date();
  const churnedUsers = users.filter(u => safeDate(u.subscription?.canceledAt));
  const retainedUsers = users.filter(u => {
    const status = u.subscription?.status;
    return (status === "active" || status === "trialing") &&
           ["pro", "premium", "enterprise"].includes((u.subscription?.plan ?? "") as string);
  });

  // For each user, build daily activity counts for the last 60 days before reference point
  const buildSeries = (group: User[], refPicker: (u: User) => Date | null): number[] => {
    const series = new Array(windowDays).fill(0);
    let users = 0;
    group.forEach(u => {
      const ref = refPicker(u);
      if (!ref) return;
      users++;
      const acts = activityDates(u.id, data, u);
      acts.forEach(a => {
        const dBefore = daysBetween(a, ref);
        if (dBefore >= 0 && dBefore < windowDays) series[dBefore]++;
      });
    });
    return users > 0 ? series.map(v => v / users) : series;
  };

  const churnedSeries = buildSeries(churnedUsers, u => safeDate(u.subscription?.canceledAt));
  const retainedSeries = buildSeries(retainedUsers, () => now);

  // Bucket into weeks for readability
  const result: DecayPoint[] = [];
  for (let weekBefore = Math.floor(windowDays / 7) - 1; weekBefore >= 0; weekBefore--) {
    const startDay = weekBefore * 7;
    const endDay = Math.min(startDay + 7, windowDays);
    const churnedAvg = avg(churnedSeries.slice(startDay, endDay));
    const retainedAvg = avg(retainedSeries.slice(startDay, endDay));
    result.push({
      daysBefore: startDay + 3, // mid-week label
      churnedAvg: Math.round(churnedAvg * 100) / 100,
      retainedAvg: Math.round(retainedAvg * 100) / 100,
    });
  }
  return result;
}

// ─── 5.1 RFM segmentation ────────────────────────────────────────────────────

export type RFMSegment = "champion" | "loyal" | "promising" | "new" | "atRisk" | "hibernating" | "lost";

export interface RFMUser {
  user: User;
  r: number;     // 1-3
  f: number;     // 1-3
  m: number;     // 1-3
  segment: RFMSegment;
  recencyDays: number;
  frequency: number;
  monetary: number;
}

export const RFM_SEGMENTS: { id: RFMSegment; label: string; color: string }[] = [
  { id: "champion",    label: "Champions",   color: "#10B981" },
  { id: "loyal",       label: "Loyal",       color: "#3B82F6" },
  { id: "promising",   label: "Promising",   color: "#8B5CF6" },
  { id: "new",         label: "New",         color: "#06B6D4" },
  { id: "atRisk",      label: "At-risk",     color: "#F59E0B" },
  { id: "hibernating", label: "Hibernating", color: "#9CA3AF" },
  { id: "lost",        label: "Lost",        color: "#EF4444" },
];

const tercile = (v: number, sorted: number[]): number => {
  if (!sorted.length) return 1;
  const a = sorted[Math.floor(sorted.length * 0.33)];
  const b = sorted[Math.floor(sorted.length * 0.67)];
  if (v <= a) return 1;
  if (v <= b) return 2;
  return 3;
};

export function computeRFM(users: User[], data: AppPayload): RFMUser[] {
  const now = new Date();
  const raw = users.map(u => {
    const la = lastActivity(u.id, data, u);
    const recencyDays = la ? daysBetween(la, now) : 999;
    const acts = activityDates(u.id, data, u);
    const last90 = acts.filter(a => daysBetween(a, now) <= 90).length;
    const plan = (u.subscription?.plan ?? "free") as string;
    const monetary = PLAN_MRR[plan] ?? 0;
    return { u, recencyDays, frequency: last90, monetary };
  });

  // Sort each dimension to compute terciles. Recency is inverted (lower = better).
  const recSorted = [...raw.map(x => -x.recencyDays)].sort((a, b) => a - b);
  const freqSorted = [...raw.map(x => x.frequency)].sort((a, b) => a - b);
  const monSorted = [...raw.map(x => x.monetary)].sort((a, b) => a - b);

  return raw.map(({ u, recencyDays, frequency, monetary }) => {
    const r = tercile(-recencyDays, recSorted);
    const f = tercile(frequency, freqSorted);
    const m = tercile(monetary, monSorted);

    let segment: RFMSegment;
    if (r === 3 && f === 3 && m === 3) segment = "champion";
    else if (r >= 2 && f >= 2 && m >= 2) segment = "loyal";
    else if (r === 3 && (f === 1 || m === 1)) segment = "new";
    else if (r === 3) segment = "promising";
    else if (r === 1 && m === 1 && f === 1) segment = "lost";
    else if (r === 1 && m >= 2) segment = "atRisk";
    else segment = "hibernating";

    return { user: u, r, f, m, segment, recencyDays, frequency, monetary };
  });
}

// ─── 6.1 Acquisition channel quality ─────────────────────────────────────────

export interface ChannelQuality {
  provider: string;
  signups: number;
  activated: number;
  activationPct: number;
  converted: number;
  conversionPct: number;
  retained30: number;
  retention30Pct: number;
}

export function computeChannelQuality(users: User[], data: AppPayload): ChannelQuality[] {
  const now = new Date();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 86_400_000);

  const groups: Record<string, User[]> = {};
  users.forEach(u => {
    const p = u.provider ?? "unknown";
    (groups[p] ??= []).push(u);
  });

  return Object.entries(groups).map(([provider, members]) => {
    const activated = members.filter(u =>
      data.interviews.some(i => i.userId === u.id && i.finalized)
    ).length;
    const converted = members.filter(u => {
      const plan = u.subscription?.plan;
      return plan === "pro" || plan === "premium" || plan === "enterprise";
    }).length;
    const retained30 = members.filter(u => {
      const la = lastActivity(u.id, data, u);
      return la && la >= thirtyDaysAgo;
    }).length;
    return {
      provider,
      signups: members.length,
      activated,
      activationPct: pct(activated, members.length),
      converted,
      conversionPct: pct(converted, members.length),
      retained30,
      retention30Pct: pct(retained30, members.length),
    };
  }).sort((a, b) => b.signups - a.signups);
}

// ─── 6.2 Signup velocity ─────────────────────────────────────────────────────

export interface SignupVelocity {
  date: string;       // ISO date
  signups: number;
  ma7: number;
  ma28: number;
}

export function computeSignupVelocity(users: User[], days = 90): SignupVelocity[] {
  const now = new Date();
  const byDay: Record<string, number> = {};
  users.forEach(u => {
    const c = safeDate(u.createdAt);
    if (!c) return;
    const key = c.toISOString().slice(0, 10);
    byDay[key] = (byDay[key] ?? 0) + 1;
  });

  const out: SignupVelocity[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now.getTime() - i * 86_400_000);
    const key = d.toISOString().slice(0, 10);
    const signups = byDay[key] ?? 0;
    const ma7 = avg(
      Array.from({ length: 7 }, (_, k) => byDay[new Date(d.getTime() - k * 86_400_000).toISOString().slice(0, 10)] ?? 0)
    );
    const ma28 = avg(
      Array.from({ length: 28 }, (_, k) => byDay[new Date(d.getTime() - k * 86_400_000).toISOString().slice(0, 10)] ?? 0)
    );
    out.push({ date: key, signups, ma7: Math.round(ma7 * 10) / 10, ma28: Math.round(ma28 * 10) / 10 });
  }
  return out;
}

// ─── 7.1 Anomaly digest ──────────────────────────────────────────────────────

export interface AnomalyMetric {
  metric: string;
  current: number;
  prior: number;
  deltaPct: number;
  good: boolean;          // is the direction good?
  format: "number" | "pct" | "money" | "score";
  sparkline: number[];
}

export function computeAnomalies(users: User[], data: AppPayload): AnomalyMetric[] {
  const now = new Date();
  const thisWeekStart = new Date(now.getTime() - 7 * 86_400_000);
  const lastWeekStart = new Date(now.getTime() - 14 * 86_400_000);

  // Helper to build 8-week sparkline for a counter
  const sparkline = (predicate: (d: Date) => boolean, sourceDates: Date[]): number[] => {
    return Array.from({ length: 8 }, (_, i) => {
      const weekEnd = new Date(now.getTime() - (7 - i) * 7 * 86_400_000);
      const weekStart = new Date(weekEnd.getTime() - 7 * 86_400_000);
      return sourceDates.filter(d => d >= weekStart && d < weekEnd && predicate(d)).length;
    });
  };

  // Signups
  const signupDates = users.map(u => safeDate(u.createdAt)).filter((d): d is Date => !!d);
  const signupsThisWeek = signupDates.filter(d => d >= thisWeekStart).length;
  const signupsLastWeek = signupDates.filter(d => d >= lastWeekStart && d < thisWeekStart).length;

  // Interviews completed
  const finalizedDates = data.interviews
    .filter(i => i.finalized)
    .map(i => safeDate(i.createdAt))
    .filter((d): d is Date => !!d);
  const finThisWeek = finalizedDates.filter(d => d >= thisWeekStart).length;
  const finLastWeek = finalizedDates.filter(d => d >= lastWeekStart && d < thisWeekStart).length;

  // Resumes uploaded
  const resumeDates = data.resumes.map(r => safeDate(r.createdAt)).filter((d): d is Date => !!d);
  const resThisWeek = resumeDates.filter(d => d >= thisWeekStart).length;
  const resLastWeek = resumeDates.filter(d => d >= lastWeekStart && d < thisWeekStart).length;

  // Paid conversions (period started within window)
  const paidPeriodStarts = users
    .map(u => safeDate(u.subscription?.currentPeriodStart))
    .filter((d): d is Date => !!d);
  const paidThisWeek = paidPeriodStarts.filter(d => d >= thisWeekStart).length;
  const paidLastWeek = paidPeriodStarts.filter(d => d >= lastWeekStart && d < thisWeekStart).length;

  // Cancellations
  const cancelDates = users
    .map(u => safeDate(u.subscription?.canceledAt))
    .filter((d): d is Date => !!d);
  const canThisWeek = cancelDates.filter(d => d >= thisWeekStart).length;
  const canLastWeek = cancelDates.filter(d => d >= lastWeekStart && d < thisWeekStart).length;

  // Avg interview score
  const scoresThisWeek = data.interviews
    .filter(i => typeof i.score === "number" && safeDate(i.createdAt) && safeDate(i.createdAt)! >= thisWeekStart)
    .map(i => i.score!);
  const scoresLastWeek = data.interviews
    .filter(i => {
      const d = safeDate(i.createdAt);
      return typeof i.score === "number" && d && d >= lastWeekStart && d < thisWeekStart;
    })
    .map(i => i.score!);
  const avgScoreThis = scoresThisWeek.length ? Math.round(avg(scoresThisWeek)) : 0;
  const avgScoreLast = scoresLastWeek.length ? Math.round(avg(scoresLastWeek)) : 0;

  const all = (): AnomalyMetric[] => {
    const mk = (
      metric: string,
      current: number,
      prior: number,
      goodDirection: "up" | "down",
      format: AnomalyMetric["format"],
      spark: number[]
    ): AnomalyMetric => {
      const deltaPct = prior > 0 ? Math.round(((current - prior) / prior) * 100) : current > 0 ? 100 : 0;
      const goingUp = current > prior;
      const good = (goodDirection === "up" && goingUp) || (goodDirection === "down" && !goingUp && current !== prior);
      return { metric, current, prior, deltaPct, good, format, sparkline: spark };
    };
    return [
      mk("Signups",        signupsThisWeek, signupsLastWeek, "up",   "number", sparkline(() => true, signupDates)),
      mk("Interviews done", finThisWeek,     finLastWeek,     "up",   "number", sparkline(() => true, finalizedDates)),
      mk("Resumes uploaded", resThisWeek,    resLastWeek,     "up",   "number", sparkline(() => true, resumeDates)),
      mk("New paid",       paidThisWeek,    paidLastWeek,    "up",   "number", sparkline(() => true, paidPeriodStarts)),
      mk("Cancellations",  canThisWeek,     canLastWeek,     "down", "number", sparkline(() => true, cancelDates)),
      mk("Avg score",      avgScoreThis,    avgScoreLast,    "up",   "score", []),
    ];
  };

  // Rank by absolute % change, return top 5
  return all()
    .filter(m => m.current > 0 || m.prior > 0)
    .sort((a, b) => Math.abs(b.deltaPct) - Math.abs(a.deltaPct))
    .slice(0, 5);
}

// ─── 8.1 Role/tech popularity drift ──────────────────────────────────────────

export interface PopularityDrift {
  item: string;
  recent: number;     // last 30d
  prior: number;      // 30-60d ago
  growthPct: number;
  trend: number[];    // 8-week sparkline
}

export function computePopularityDrift(
  data: AppPayload,
  dim: "role" | "type" | "techstack" | "company",
  topN = 15
): PopularityDrift[] {
  const now = new Date();
  const recentStart = new Date(now.getTime() - 30 * 86_400_000);
  const priorStart = new Date(now.getTime() - 60 * 86_400_000);

  const counts: Record<string, { recent: number; prior: number; all: Date[] }> = {};

  data.interviews.forEach(i => {
    const d = safeDate(i.createdAt);
    if (!d) return;

    const values: (string | undefined)[] = dim === "techstack" ? (i.techstack ?? []) : [i[dim] as string | undefined];
    values.forEach(v => {
      if (!v) return;
      (counts[v] ??= { recent: 0, prior: 0, all: [] });
      counts[v].all.push(d);
      if (d >= recentStart) counts[v].recent++;
      else if (d >= priorStart) counts[v].prior++;
    });
  });

  return Object.entries(counts)
    .map(([item, { recent, prior, all }]) => {
      const sparkline = Array.from({ length: 8 }, (_, i) => {
        const weekEnd = new Date(now.getTime() - (7 - i) * 7 * 86_400_000);
        const weekStart = new Date(weekEnd.getTime() - 7 * 86_400_000);
        return all.filter(d => d >= weekStart && d < weekEnd).length;
      });
      return {
        item,
        recent,
        prior,
        growthPct: prior > 0 ? Math.round(((recent - prior) / prior) * 100) : recent > 0 ? 100 : 0,
        trend: sparkline,
      };
    })
    .filter(x => x.recent + x.prior >= 3)
    .sort((a, b) => b.growthPct - a.growthPct)
    .slice(0, topN);
}