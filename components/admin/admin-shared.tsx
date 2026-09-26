// components/admin/admin-shared.tsx
"use client";

import React, { useState, useEffect, ReactNode, createContext, useContext } from "react";
import { BarChart as MuiBarChart }  from "@mui/x-charts/BarChart";
import { PieChart  as MuiPieChart } from "@mui/x-charts/PieChart";
import { LineChart as MuiLineChart } from "@mui/x-charts/LineChart";

// ─── Types ────────────────────────────────────────────────────────────────────

// Mirrors the Supabase schema via lib/erp-data.ts loadUsers():
// profiles → User, subscriptions → Subscription, current usage_counters row →
// Usage, credit_packs → PackSummary.
export interface Subscription {
  plan?: string; status?: string;
  currentPeriodStart?: string; currentPeriodEnd?: string; subscriptionStartedAt?: string; subscriptionEndsAt?: string;
  canceledAt?: string; lastPaymentAt?: string; trialEndsAt?: string;
  studentVerified?: boolean; studentEduEmail?: string;
  stripeCustomerId?: string; stripeSubscriptionId?: string;
  lastAppliedCoupon?: string; lastCouponAppliedAt?: string;
  [key: string]: unknown;
}
export interface Usage {
  resumesUsed?: number; coverLettersUsed?: number; studyPlansUsed?: number;
  interviewsUsed?: number; interviewDebriefsUsed?: number; debriefAnalysesUsed?: number;
  linkedinOptimisationsUsed?: number; coldOutreachUsed?: number; findContactsUsed?: number;
  jobTrackerUsed?: number; jobAnalysesUsed?: number;
  periodStart?: string; periodEnd?: string; lastUpdated?: string; [key: string]: unknown;
}
export interface PackSummary {
  purchases: number; refunded: number; spentCents: number;
  balance: Record<string, number>; totalCredits: number;
  lastPurchasedAt?: string; keys: string[];
}
// .edu student perk (student_verifications) — see StudentInfo in lib/erp-data.ts
export interface StudentInfo {
  status: "pending" | "verified" | "claimed";
  eduEmail?: string; domain?: string; method?: string;
  verifiedAt?: string; claimedAt?: string; startedAt?: string; attempts?: number;
}
export interface User {
  id: string; name?: string; email?: string; provider?: string; isAdmin?: boolean;
  createdAt?: string; updatedAt?: string; lastLogin?: string;
  lastContactedAt?: string; lastContactSubject?: string;
  subscription?: Subscription; usage?: Usage; packs?: PackSummary; student?: StudentInfo; [key: string]: unknown;
}

const STUDENT_META: Record<StudentInfo["status"], { label: string; tw: string; title: string }> = {
  claimed:  { label: "Student · claimed", tw: "bg-[rgba(168,85,247,0.08)] text-[#a855f7] border-[rgba(168,85,247,0.25)]", title: "Verified .edu email and claimed the free student month" },
  verified: { label: "Student",           tw: "bg-[rgba(168,85,247,0.05)] text-[#c084fc] border-[rgba(168,85,247,0.18)]", title: "Verified .edu email — hasn't claimed the free month" },
  pending:  { label: "Student · pending", tw: "bg-[rgba(136,136,136,0.06)] text-[#777] border-[rgba(136,136,136,0.18)]", title: "Started .edu verification but never entered the code" },
};

/** Badge for a user's .edu student status; renders nothing for non-students. */
export function StudentChip({ student, compact = false, className = "" }: { student?: StudentInfo; compact?: boolean; className?: string }) {
  if (!student) return null;
  const m = STUDENT_META[student.status];
  return (
    <span title={m.title} className={`inline-flex items-center gap-1 font-medium rounded-md whitespace-nowrap border ${compact ? "text-[11px] px-1.5 py-0" : "text-[12px] px-2 py-0.5"} ${m.tw} ${className}`}>
      <svg width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M22 10 12 5 2 10l10 5 10-5z"/><path d="M6 12v5c0 1.1 2.7 3 6 3s6-1.9 6-3v-5"/>
      </svg>
      {m.label}
    </span>
  );
}
export interface PlanColor   { bg: string; text: string; border: string; dot: string; accent: string; tw: string }
export interface StatusColor { bg: string; text: string; dot: string }
export interface AnalyticsData {
  total: number; planCounts: { free: number; pro: number; premium: number };
  revenue: number; stripeCount: number; canceledCount: number;
  newThisMonth: number; growthDelta: number;
  signupArr: { label: string; count: number }[]; signupSpark: number[];
  activeThisMonth: number; dormant: number; powerUsers: number; avgUsage: number;
  featureRank: { label: string; value: number }[]; maxFeature: number;
  planSegments: { color: string; value: number; label: string }[];
  providers: Record<string, number>; conversionRate: number; totalUsage: number;
}

// ─── Constants ────────────────────────────────────────────────────────────────

// Keys must match ALLOWED in app/api/admin/route.ts (action=code_ref).
// Paths are in the Dashboard repo unless noted.
export const CODE_REFS: Record<string, { file: string; desc: string }> = {
  stripeWebhook:      { file: "app/api/webhooks/stripe/route.ts",                    desc: "Subscription lifecycle + checkout.session.completed → pack grants" },
  stripeCreateSub:    { file: "app/api/subscription/create-subscription/route.ts",   desc: "Creates Stripe customer + incomplete subscription + SetupIntent" },
  stripeCancelSub:    { file: "app/api/subscription/cancel-subscription/route.ts",   desc: "cancel_at_period_end - keeps access until period end" },
  priceIds:           { file: "lib/config/stripe-prices.ts",                         desc: "Subscription plan price IDs (env with live fallbacks)" },
  packs:              { file: "lib/config/packs.ts",                                 desc: "PACKS catalog + STRIPE_PACK_*_PRICE_ID lookup" },
  packGrant:          { file: "lib/packs/grant.ts",                                  desc: "Writes credit_packs rows on successful checkout" },
  subscriptionFields: { file: "lib/actions/auth.action.ts",                          desc: "Reads profiles + subscriptions + usage_counters" },
  usageLimits:        { file: "lib/config/usage-limits.ts",                          desc: "USAGE_LIMITS per-plan limits" },
  usageGuard:         { file: "lib/ai/usage-guard.ts",                               desc: "Quota check → increment_usage_counter / consume_pack_credit" },
  usagePeriod:        { file: "lib/usage/period.ts",                                 desc: "Rolling 30-day usage window anchor" },
  adminRoute:         { file: "app/api/admin/route.ts",                              desc: "ERP: server-side admin route" },
  erpData:            { file: "lib/erp-data.ts",                                     desc: "ERP: Supabase ↔ ERP User mapping" },
  erpSchema:          { file: "supabase/erp_schema.sql",                             desc: "ERP: erp_* tables + admin read policies" },
};

// Annual plans were removed from the Dashboard (lib/config/stripe-prices.ts).
export const PRICE_IDS_MAP: Record<string, { plan: string; billing: string; price: string; label: string }> = {
  "price_1TFjvAQSkS83MGF9XlLXgu5H": { plan: "free",    billing: "",       price: "$0",           label: "Free"           },
  "price_1TFjwCQSkS83MGF9xH1bdc1o": { plan: "pro",     billing: "Monthly", price: "$9.99/mo",     label: "Pro Monthly"    },
  "price_1TFjzWQSkS83MGF9YCP7CBk3": { plan: "premium", billing: "Monthly", price: "$24.99/mo",    label: "Premium Monthly"},
};

const PLAN_PRICES: Record<string, number> = { free: 0, pro: 9.99, premium: 24.99 };
export function planMonthlyPrice(plan?: string): number { return PLAN_PRICES[plan ?? "free"] ?? 0; }

export const PLAN_FEATURES: Record<string, { features: string[]; price: string; annualPrice: string; tagline: string; cta: string; popular?: boolean; customPricing?: boolean; securityFeatures?: string[] }> = {
  free: {
    tagline: "Get started and feel the value.",
    price: "$0", annualPrice: "$0", cta: "Current plan",
    features: ["3 resume analyses / month","5 cover letters / month","1 mock interview / month","2 study plans / month","2 LinkedIn optimisations / month","2 interview debriefs / month","3 cold outreach messages / month","3 find contacts / month","Job tracker (10 jobs)"],
  },
  pro: {
    tagline: "Everything an active job seeker needs.",
    price: "$9.99/mo", annualPrice: "—", cta: "Start Pro", popular: true,
    features: ["20 resume analyses / month","30 cover letters / month","3 mock interviews / month","10 study plans / month","5 LinkedIn optimisations / month","5 interview debriefs / month","20 cold outreach messages / month","15 find contacts / month","Unlimited job tracker"],
  },
  premium: {
    tagline: "For serious candidates.",
    price: "$24.99/mo", annualPrice: "—", cta: "Start Premium",
    features: ["50 resume analyses / month","80 cover letters / month","5 mock interviews / month","25 study plans / month","15 LinkedIn optimisations / month","10 interview debriefs / month","60 cold outreach messages / month","50 find contacts / month","Unlimited job tracker"],
  },
  enterprise: {
    tagline: "For teams, hiring pipelines & organisations.",
    price: "Custom", annualPrice: "Custom", cta: "Contact us", customPricing: true,
    features: ["Everything in Premium","Unlimited seats across your org","Custom AI interview tracks per role","Dedicated account manager","Flexible invoice billing"],
    securityFeatures: ["End-to-end encryption · Google Cloud secured","No data selling · Your data stays yours","GDPR & CCPA ready · Full privacy compliance","Custom DPA available · On request for universities","Pricing based on team size & needs"],
  },
};

export const WEBHOOK_EVENTS = [
  { event: "customer.subscription.created",         handler: "handleSubscriptionCreated"      },
  { event: "customer.subscription.updated",         handler: "handleSubscriptionUpdated"      },
  { event: "customer.subscription.deleted",         handler: "handleSubscriptionDeleted"      },
  { event: "invoice.payment_succeeded",             handler: "handlePaymentSucceeded"         },
  { event: "invoice.payment_failed",                handler: "handlePaymentFailed"            },
  { event: "checkout.session.completed",            handler: "handleCheckoutSessionCompleted" },
  { event: "checkout.session.async_payment_succeeded", handler: "handleCheckoutSessionCompleted" },
];

export const PLANS = ["free", "pro", "premium", "enterprise"] as const;

export const USAGE_FIELDS: { key: keyof Usage; label: string; color: string }[] = [
  { key: "resumesUsed",               label: "Resumes",       color: "#0070f3" },
  { key: "coverLettersUsed",          label: "Cover Letters", color: "#3ecf8e" },
  { key: "studyPlansUsed",            label: "Study Plans",   color: "#50e3c2" },
  { key: "interviewsUsed",            label: "Interviews",    color: "#f5a623" },
  { key: "interviewDebriefsUsed",     label: "Debriefs",      color: "#a855f7" },
  { key: "debriefAnalysesUsed",       label: "Debrief AI",    color: "#c084fc" },
  { key: "linkedinOptimisationsUsed", label: "LinkedIn",      color: "#38bdf8" },
  { key: "coldOutreachUsed",          label: "Cold Outreach", color: "#f472b6" },
  { key: "findContactsUsed",          label: "Find Contacts", color: "#2dd4bf" },
  { key: "jobTrackerUsed",            label: "Job Tracker",   color: "#fb923c" },
];

// Monthly quotas — mirrors USAGE_LIMITS in the Dashboard's lib/config/usage-limits.ts. -1 = unlimited.
// Pack credits (User.packs.balance) are spent only after these run out.
export const LIMITS: Record<string, Record<string, number>> = {
  free:       { resumesUsed:3,  coverLettersUsed:5,  studyPlansUsed:2,  interviewsUsed:1, interviewDebriefsUsed:2,  debriefAnalysesUsed:1,  linkedinOptimisationsUsed:2,  coldOutreachUsed:3,  findContactsUsed:3,  jobTrackerUsed:10 },
  pro:        { resumesUsed:20, coverLettersUsed:30, studyPlansUsed:10, interviewsUsed:3, interviewDebriefsUsed:5,  debriefAnalysesUsed:4,  linkedinOptimisationsUsed:5,  coldOutreachUsed:20, findContactsUsed:15, jobTrackerUsed:-1 },
  premium:    { resumesUsed:50, coverLettersUsed:80, studyPlansUsed:25, interviewsUsed:5, interviewDebriefsUsed:10, debriefAnalysesUsed:12, linkedinOptimisationsUsed:15, coldOutreachUsed:60, findContactsUsed:50, jobTrackerUsed:-1 },
  enterprise: { resumesUsed:-1, coverLettersUsed:-1, studyPlansUsed:-1, interviewsUsed:-1, interviewDebriefsUsed:-1, debriefAnalysesUsed:-1, linkedinOptimisationsUsed:-1, coldOutreachUsed:-1, findContactsUsed:-1, jobTrackerUsed:-1 },
};

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useIsMobile(bp = 640) {
  const [mobile, setMobile] = useState(false);
  useEffect(() => {
    const check = () => setMobile(window.innerWidth <= bp);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, [bp]);
  return mobile;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function planColor(p?: string): PlanColor {
  if (p === "enterprise") return {
    bg: "rgba(62,207,142,0.08)", text: "#3ecf8e", border: "rgba(62,207,142,0.2)", dot: "#3ecf8e", accent: "#3ecf8e",
    tw: "bg-[rgba(62,207,142,0.08)] text-[#3ecf8e] border-[rgba(62,207,142,0.2)]",
  };
  if (p === "premium") return {
    bg: "rgba(245,166,35,0.08)", text: "#f5a623", border: "rgba(245,166,35,0.2)", dot: "#f5a623", accent: "#f5a623",
    tw: "bg-[rgba(245,166,35,0.08)] text-[#f5a623] border-[rgba(245,166,35,0.2)]",
  };
  if (p === "pro") return {
    bg: "rgba(0,112,243,0.08)", text: "#0070f3", border: "rgba(0,112,243,0.2)", dot: "#0070f3", accent: "#0070f3",
    tw: "bg-[rgba(0,112,243,0.08)] text-[#0070f3] border-[rgba(0,112,243,0.2)]",
  };
  if (p === "starter") return {
    bg: "rgba(168,85,247,0.08)", text: "#a855f7", border: "rgba(168,85,247,0.2)", dot: "#a855f7", accent: "#a855f7",
    tw: "bg-[rgba(168,85,247,0.08)] text-[#a855f7] border-[rgba(168,85,247,0.2)]",
  };
  return {
    bg: "rgba(136,136,136,0.08)", text: "#888", border: "rgba(136,136,136,0.2)", dot: "#555", accent: "#444",
    tw: "bg-[rgba(136,136,136,0.08)] text-[#888] border-[rgba(136,136,136,0.2)]",
  };
}

export function statusColor(s?: string): StatusColor {
  if (s === "active")   return { bg: "rgba(62,207,142,0.08)",  text: "#3ecf8e", dot: "#3ecf8e" };
  if (s === "canceled") return { bg: "rgba(255,68,68,0.08)",   text: "#f44",    dot: "#f44" };
  if (s === "past_due") return { bg: "rgba(245,166,35,0.08)",  text: "#f5a623", dot: "#f5a623" };
  if (s === "trialing") return { bg: "rgba(136,136,136,0.08)", text: "#888",    dot: "#888" };
  return { bg: "rgba(136,136,136,0.06)", text: "#555", dot: "#333" };
}

export function fmt(s?: string) {
  if (!s) return "";
  try { return new Date(s).toLocaleDateString("en-GB", { day:"2-digit", month:"short", year:"numeric" }); }
  catch { return s; }
}
export function fmtFull(s?: string) {
  if (!s) return "";
  try { return new Date(s).toLocaleString("en-GB", { day:"2-digit", month:"short", year:"numeric", hour:"2-digit", minute:"2-digit" }); }
  catch { return s; }
}
export function daysAgo(s?: string) {
  if (!s) return "";
  try {
    const d = Math.floor((Date.now() - new Date(s).getTime()) / 86400000);
    if (d === 0) return "Today"; if (d === 1) return "1d ago";
    if (d < 30) return `${d}d ago`; if (d < 365) return `${Math.floor(d/30)}mo ago`;
    return `${Math.floor(d/365)}y ago`;
  } catch { return ""; }
}

// Vercel dark theme inputs
export const inputCls = "w-full border border-[#2a2a2a] rounded-md px-3 py-2 text-[14px] text-[#ededed] bg-[#0a0a0a] outline-none focus:border-[#555] transition-colors placeholder:text-[#444] font-[inherit]";
export const selectCls = inputCls + " cursor-pointer";

// ─── Select ───────────────────────────────────────────────────────────────────

type SelectProps = React.SelectHTMLAttributes<HTMLSelectElement> & {
  wrapperClassName?: string;
};

export function Select({ wrapperClassName = "w-full", className = "", children, ...props }: SelectProps) {
  return (
    <div className={`relative ${wrapperClassName}`}>
      <select
        className={`appearance-none w-full border border-[#2a2a2a] rounded-md px-3 py-2 pr-8 text-[14px] text-[#ededed] bg-[#0a0a0a] outline-none hover:border-[#333] focus:border-[#555] transition-colors cursor-pointer font-[inherit] ${className}`}
        {...props}
      >
        {children}
      </select>
      <div className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-[#555]">
        <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
          <path d="M6 9l6 6 6-6"/>
        </svg>
      </div>
    </div>
  );
}

// ─── Avatar ───────────────────────────────────────────────────────────────────

const PAL = [
  "bg-[rgba(99,102,241,0.15)] text-[#818cf8]",
  "bg-[rgba(14,165,233,0.15)] text-[#38bdf8]",
  "bg-[rgba(16,185,129,0.15)] text-[#34d399]",
  "bg-[rgba(245,158,11,0.15)] text-[#fbbf24]",
  "bg-[rgba(244,63,94,0.15)] text-[#fb7185]",
  "bg-[rgba(168,85,247,0.15)] text-[#c084fc]",
  "bg-[rgba(20,184,166,0.15)] text-[#2dd4bf]",
  "bg-[rgba(249,115,22,0.15)] text-[#fb923c]",
];

export function Avatar({ name, size = 36 }: { name?: string; size?: number }) {
  const initials = (name ?? "?").split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase();
  const p = PAL[name ? name.charCodeAt(0) % PAL.length : 0];
  return (
    <div
      className={`rounded-full flex items-center justify-center font-medium shrink-0 ${p}`}
      style={{ width: size, height: size, fontSize: size * 0.34 }}
    >
      {initials}
    </div>
  );
}

export function Chip({ label, className = "" }: { label: string; className?: string }) {
  return (
    <span className={`inline-block text-[12px] font-medium px-2 py-0.5 rounded-md whitespace-nowrap ${className}`}>
      {label}
    </span>
  );
}

export function StatusDot({ color }: { color: string }) {
  return <span className="inline-block w-1.5 h-1.5 rounded-full shrink-0" style={{ background: color }} />;
}

// ─── Skeleton ─────────────────────────────────────────────────────────────────

export function Skeleton({ className = "", style }: { className?: string; style?: React.CSSProperties }) {
  return <div className={`skeleton rounded-md ${className}`} style={style} />;
}

export function SkeletonLine({ w, h = 10 }: { w?: string | number; h?: number }) {
  return (
    <div
      className="skeleton rounded-full"
      style={{ height: h, width: w ?? "100%" }}
    />
  );
}

export function SkeletonMetricCard() {
  return (
    <div className="bg-[#0a0a0a] border border-[#1a1a1a] rounded-xl p-4 flex flex-col gap-2 min-w-0">
      <SkeletonLine w="45%" h={9} />
      <SkeletonLine w="55%" h={22} />
      <SkeletonLine w="35%" h={9} />
    </div>
  );
}

export function SkeletonTable({ rows = 6, cols = 4 }: { rows?: number; cols?: number }) {
  return (
    <div className="w-full">
      <div className="flex gap-4 px-4 py-2.5 border-b border-[#111]">
        {Array.from({ length: cols }).map((_, i) => (
          <SkeletonLine key={i} w={i === 0 ? "30%" : "20%"} h={9} />
        ))}
      </div>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex gap-4 px-4 py-3 border-b border-[#0d0d0d]">
          {Array.from({ length: cols }).map((_, j) => (
            <SkeletonLine key={j} w={j === 0 ? "30%" : j === cols - 1 ? "12%" : "20%"} h={10} />
          ))}
        </div>
      ))}
    </div>
  );
}

// ─── MetricCard ───────────────────────────────────────────────────────────────

export function MetricCard({ label, value, color = "#ededed", sub }: { label: string; value: ReactNode; color?: string; sub?: string }) {
  return (
    <div className="bg-[#0a0a0a] border border-[#1a1a1a] rounded-xl p-4 flex flex-col gap-1 min-w-0">
      <div className="text-[11px] font-semibold text-[#444] uppercase tracking-[0.08em]">{label}</div>
      <div className="text-[26px] font-bold leading-none tracking-tight mt-1.5" style={{ color, fontVariantNumeric: "tabular-nums" }}>{value}</div>
      {sub && <div className="text-[12px] text-[#555] mt-1">{sub}</div>}
    </div>
  );
}

// ─── HBar ─────────────────────────────────────────────────────────────────────

export function HBar({ pct, color = "#0070f3", height = 4 }: { pct: number; color?: string; height?: number }) {
  return (
    <div className="rounded-full overflow-hidden flex-1" style={{ height, background: "#1a1a1a" }}>
      <div className="h-full rounded-full transition-all" style={{ width: `${Math.min(pct, 100)}%`, background: color }} />
    </div>
  );
}

// ─── Chart SX overrides ───────────────────────────────────────────────────────

const CHART_SX = {
  fontFamily: "var(--font-geist-sans), -apple-system, sans-serif",
  background: "transparent",
  "& .MuiChartsAxis-line":      { stroke: "#1a1a1a" },
  "& .MuiChartsAxis-tick":      { stroke: "#1a1a1a" },
  "& .MuiChartsGrid-line":      { stroke: "#1a1a1a", strokeDasharray: "4 4" },
  "& .MuiChartsAxis-tickLabel": { fill: "#555" },
  "& .MuiChartsTooltip-root":   { background: "#111 !important", border: "1px solid #333 !important", borderRadius: "8px", boxShadow: "none" },
  "& .MuiChartsTooltip-table":  { fontFamily: "inherit" },
  "& .MuiChartsLegend-label":   { fill: "#888", fontSize: 11, fontFamily: "inherit" },
  "& text":                      { fontFamily: "var(--font-geist-sans), -apple-system, sans-serif !important", fill: "#555 !important" },
} as const;

const TICK_STYLE = { fontSize: 9, fill: "#555", fontFamily: "var(--font-geist-sans), -apple-system, sans-serif" } as const;

// ─── BarChart ─────────────────────────────────────────────────────────────────

export function BarChart({ data, color = "#0070f3", h = 80 }: { data: { l: string; v: number }[]; color?: string; h?: number }) {
  if (!data?.length) return null;
  return (
    <MuiBarChart
      height={h + 40}
      series={[{ data: data.map(d => d.v), color, valueFormatter: (v: number | null) => String(v ?? 0) }]}
      xAxis={[{ data: data.map(d => d.l), scaleType: "band", tickLabelStyle: TICK_STYLE, tickSize: 0 }]}
      yAxis={[{ tickLabelStyle: { ...TICK_STYLE, fill: "#444" }, tickSize: 0 }]}
      margin={{ top: 8, bottom: 28, left: 32, right: 4 }}
      borderRadius={4}
      grid={{ horizontal: true }}
      sx={{ ...CHART_SX, width: "100% !important" }}
      skipAnimation={false}
    />
  );
}

// ─── Donut ────────────────────────────────────────────────────────────────────

export function Donut({ segments, size = 80, label }: { segments: { color: string; value: number; label?: string }[]; size?: number; label?: string }) {
  const validSegments = segments.filter(s => s.value > 0);
  if (!validSegments.length) return null;
  return (
    <div style={{ position: "relative", width: size, height: size, flexShrink: 0 }}>
      <MuiPieChart
        series={[{
          data: validSegments.map((s, i) => ({ id: i, value: s.value, color: s.color, label: s.label })),
          innerRadius: size * 0.28, outerRadius: size * 0.44,
          cx: size / 2 - 4, cy: size / 2 - 4,
          paddingAngle: 2, cornerRadius: 2,
          highlightScope: { fade: "global", highlight: "item" },
        }]}
        width={size}
        height={size}
        slots={{ legend: () => null }}
        margin={{ top: 0, bottom: 0, left: 0, right: 0 }}
        sx={{ ...CHART_SX, outline: "none" }}
        skipAnimation={false}
      />
      {label && (
        <div style={{
          position: "absolute", top: "50%", left: "50%",
          transform: "translate(-60%, -50%)",
          fontSize: size * 0.16, fontWeight: 700, color: "#ededed",
          pointerEvents: "none", lineHeight: 1, letterSpacing: "-0.02em",
        }}>
          {label}
        </div>
      )}
    </div>
  );
}

// ─── LineChart ────────────────────────────────────────────────────────────────

export function LineChart({ data, labels, color = "#0070f3", h = 120, area = false, smooth = true }: {
  data: number[][]; labels: string[]; colors?: string[]; color?: string; h?: number; area?: boolean; smooth?: boolean;
}) {
  if (!data?.length || !labels?.length) return null;
  const colors = ["#0070f3", "#3ecf8e", "#f5a623", "#f472b6", "#38bdf8", "#a855f7"];
  return (
    <MuiLineChart
      height={h + 40}
      series={data.map((d, i) => ({
        data: d,
        color: data.length === 1 ? color : colors[i % colors.length],
        area,
        curve: smooth ? "catmullRom" : "linear",
        showMark: false,
        valueFormatter: (v: number | null) => String(v ?? 0),
      }))}
      xAxis={[{ data: labels, scaleType: "band", tickLabelStyle: TICK_STYLE, tickSize: 0 }]}
      yAxis={[{ tickLabelStyle: { ...TICK_STYLE, fill: "#444" }, tickSize: 0 }]}
      margin={{ top: 8, bottom: 28, left: 32, right: 4 }}
      grid={{ horizontal: true }}
      sx={{
        ...CHART_SX,
        width: "100% !important",
        "& .MuiAreaElement-root": { fillOpacity: 0.08 },
        "& .MuiLineElement-root": { strokeWidth: 2 },
        "& .MuiMarkElement-root": { display: "none" },
      }}
      skipAnimation={false}
    />
  );
}

// ─── FRow ─────────────────────────────────────────────────────────────────────

export interface FRowProps {
  label: string; value?: string | number | boolean | null;
  mono?: boolean; copyable?: boolean;
  badgeLabel?: string; badgeClassName?: string;
}

export function FRow({ label, value, mono, copyable, badgeLabel, badgeClassName }: FRowProps) {
  const [cp, setCp] = useState(false);
  const strVal  = (value !== undefined && value !== null && value !== "") ? String(value) : "";
  const copyVal = (value !== undefined && value !== null && value !== "") ? String(value) : "";
  return (
    <div className="flex items-start gap-2.5 py-2.5 border-b border-[#1a1a1a] last:border-0 min-w-0">
      <div className="w-32 shrink-0 text-[12px] font-medium text-[#555] uppercase tracking-wider pt-0.5">{label}</div>
      <div className={`flex-1 text-[14px] min-w-0 overflow-hidden ${mono ? "text-[#0070f3] font-mono" : "text-[#ededed]"}`}>
        {badgeLabel ? <Chip label={badgeLabel} className={badgeClassName ?? ""} /> : strVal}
      </div>
      {copyable && copyVal && (
        <button
          onClick={() => { navigator.clipboard?.writeText(copyVal); setCp(true); setTimeout(() => setCp(false), 1200); }}
          className={`shrink-0 text-[12px] font-medium border-none bg-transparent cursor-pointer transition-colors ${cp ? "text-[#3ecf8e]" : "text-[#555] hover:text-[#888]"}`}
        >
          {cp ? "✓" : "Copy"}
        </button>
      )}
    </div>
  );
}

export const AdminTokenContext = createContext("");

export function CodeRef({ k }: { k: string }) {
  const token = useContext(AdminTokenContext);
  const r = CODE_REFS[k];
  const [open,     setOpen]     = useState(false);
  const [content,  setContent]  = useState<string | null>(null);
  const [fetching, setFetching] = useState(false);
  const [err,      setErr]      = useState("");

  async function load() {
    setOpen(true);
    if (content) return;
    setFetching(true); setErr("");
    try {
      const res  = await fetch(`/api/admin?action=code_ref&key=${encodeURIComponent(k)}`, {
        headers: token ? { "x-admin-token": token } : {},
      });
      const json = await res.json() as { content?: string; error?: string };
      if (!res.ok || json.error) throw new Error(json.error ?? `HTTP ${res.status}`);
      setContent(json.content ?? "");
    } catch (e) { setErr((e as Error).message); }
    setFetching(false);
  }

  if (!r) return null;
  return (
    <>
      <span className="inline-flex items-center gap-1 bg-[rgba(99,102,241,0.08)] border border-[rgba(99,102,241,0.2)] rounded px-1.5 py-0.5">
        <svg width="9" height="9" fill="none" stroke="#818cf8" strokeWidth="2" viewBox="0 0 24 24">
          <polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/>
        </svg>
        <span className="font-mono text-[11px] text-[#818cf8] max-w-45 truncate">{r.file}</span>
        <button
          onClick={e => { e.stopPropagation(); void load(); }}
          title={r.desc}
          className="ml-0.5 w-3.5 h-3.5 rounded-full bg-[rgba(99,102,241,0.2)] text-[#818cf8] text-[8px] font-bold border-none cursor-pointer hover:bg-[rgba(99,102,241,0.4)] transition-colors flex items-center justify-center leading-none shrink-0"
        >
          ?
        </button>
      </span>

      {open && (
        <div
          className="fixed inset-0 z-[9999] flex items-center justify-center p-4"
          style={{ background: "rgba(0,0,0,0.85)", backdropFilter: "blur(4px)" }}
          onClick={e => { if (e.target === e.currentTarget) setOpen(false); }}
        >
          <div
            className="bg-[#0a0a0a] border border-[#2a2a2a] rounded-2xl flex flex-col overflow-hidden w-full max-w-3xl"
            style={{ maxHeight: "82vh" }}
          >
            {/* Header */}
            <div className="flex items-center gap-3 px-5 py-4 border-b border-[#1a1a1a] shrink-0">
              <svg width="12" height="12" fill="none" stroke="#818cf8" strokeWidth="2" viewBox="0 0 24 24" className="shrink-0">
                <polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/>
              </svg>
              <code className="font-mono text-[13px] text-[#818cf8] flex-1 min-w-0 truncate">{r.file}</code>
              <button
                onClick={() => setOpen(false)}
                className="p-1.5 rounded-md border border-[#2a2a2a] bg-transparent text-[#555] hover:text-[#ededed] hover:border-[#555] transition-colors cursor-pointer shrink-0 flex"
              >
                <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M18 6L6 18M6 6l12 12"/></svg>
              </button>
            </div>
            <div className="px-5 py-2.5 text-[12px] text-[#555] border-b border-[#111] shrink-0">{r.desc}</div>

            {/* Code body */}
            <div className="flex-1 overflow-auto min-h-0">
              {fetching && (
                <div className="flex items-center justify-center py-12">
                  <div className="w-5 h-5 rounded-full border-2 border-[#2a2a2a] border-t-[#818cf8] animate-spin" />
                </div>
              )}
              {err && !fetching && (
                <div className="px-5 py-4 text-sm text-[#f44]">{err}</div>
              )}
              {content && !fetching && (
                <pre className="p-5 m-0 text-[12px] font-mono text-[#c8c8c8] leading-relaxed overflow-x-auto whitespace-pre">
                  <code>{content}</code>
                </pre>
              )}
            </div>

            {content && (
              <div className="px-5 py-2.5 border-t border-[#111] text-[11px] text-[#444] shrink-0 flex items-center justify-between">
                <span>{content.split("\n").length} lines · {r.file}</span>
                <button
                  onClick={() => navigator.clipboard?.writeText(content)}
                  className="text-[11px] text-[#555] hover:text-[#888] border-none bg-transparent cursor-pointer transition-colors"
                >
                  Copy all
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}

// ─── Spinner ──────────────────────────────────────────────────────────────────

export function Spinner({ size }: { size?: number } = {}) {
  if (size) {
    return (
      <div
        className="rounded-full border-[1.5px] border-[#222] border-t-[#555] animate-spin shrink-0"
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <div className="flex-1 w-full flex flex-col items-center justify-center gap-2.5 min-h-48">
      <div className="w-5 h-5 rounded-full border-[1.5px] border-[#222] border-t-[#555] animate-spin" />
      <span className="text-[12px] text-[#3a3a3a] tracking-wide">Loading…</span>
    </div>
  );
}

export function SL({ children }: { children: ReactNode }) {
  return <div className="text-[10px] font-semibold text-[#3a3a3a] uppercase tracking-[0.12em] mb-3">{children}</div>;
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`bg-[#0a0a0a] border border-[#111] rounded-xl p-4 md:p-5 ${className}`}>{children}</div>;
}

export function CardTitle({ children }: { children: ReactNode }) {
  return <div className="text-[13px] font-semibold text-[#ccc] tracking-tight mb-4">{children}</div>;
}
