// components/admin/analytics/analytics-types.ts
// ─────────────────────────────────────────────────────────────────────────────
// Shared types & constants for the analytics layer.
// Everything else in /analytics imports from this file.
// ─────────────────────────────────────────────────────────────────────────────

import { User } from "../admin/admin-shared";

// ─── Raw entities from Firestore ─────────────────────────────────────────────

export interface Interview {
  id: string;
  userId?: string;
  createdAt?: string;
  role?: string;
  type?: string;
  techstack?: string[];
  company?: string;
  status?: string;
  finalized?: boolean;
  score?: number;
  level?: string;
  duration?: number;
}

export interface Feedback {
  id: string;
  userId?: string;
  interviewId?: string;
  createdAt?: string;
  totalScore?: number;
  categoryScores?: Record<string, number> | { name: string; score: number }[];
}

export interface Resume {
  id: string;
  userId?: string;
  createdAt?: string;
  jobTitle?: string;
  companyName?: string;
  status?: string;
  score?: number;
}

export interface Plan {
  id: string;
  userId?: string;
  createdAt?: string;
  status?: string;
}

export interface AppPayload {
  interviews: Interview[];
  feedbacks: Feedback[];
  resumes: Resume[];
  plans: Plan[];
}

// ─── Plan pricing (USD per month) ────────────────────────────────────────────
// Source of truth: PRICE_IDS_MAP in admin-shared.tsx
// Annual plans normalised to monthly equivalent for MRR math.

export const PLAN_MRR: Record<string, number> = {
  free: 0,
  pro: 9.99,
  premium: 24.99,
  enterprise: 99, // placeholder — adjust to your real enterprise ARPU
};

// ─── Sub-tab routing ─────────────────────────────────────────────────────────

export type AnalyticsTab =
  | "overview"   // anomaly digest + headline KPIs
  | "revenue"    // MRR waterfall, NRR/GRR, trial funnel, ARPU
  | "retention"  // cohort triangle, activation funnel, time-to-value
  | "product"    // feature ROI, score progression, category strength
  | "churn"      // risk leaderboard, engagement decay
  | "segments";  // RFM, power users

// ─── Public props every sub-tab receives ─────────────────────────────────────

export interface SubProps {
  users: User[];
  data: AppPayload;
  token: string;
  isMobile: boolean;
}

// ─── Helper: shared activity signal ──────────────────────────────────────────
// "Active" means at least one event in the window — interview created,
// resume uploaded, feedback received, or login.

export function activityDates(userId: string, d: AppPayload, u?: User): Date[] {
  const out: Date[] = [];
  const push = (iso?: string) => { if (iso) { const t = new Date(iso); if (!isNaN(t.getTime())) out.push(t); } };
  d.interviews.forEach(i => { if (i.userId === userId) push(i.createdAt); });
  d.resumes.forEach(r => { if (r.userId === userId) push(r.createdAt); });
  d.feedbacks.forEach(f => { if (f.userId === userId) push(f.createdAt); });
  if (u?.lastLogin) push(u.lastLogin);
  return out;
}

export function lastActivity(userId: string, d: AppPayload, u?: User): Date | null {
  const dates = activityDates(userId, d, u);
  if (!dates.length) return null;
  return new Date(Math.max(...dates.map(x => x.getTime())));
}