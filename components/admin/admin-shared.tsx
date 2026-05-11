// components/admin/admin-shared.tsx
"use client";

import { useState, useEffect, ReactNode } from "react";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface Subscription {
  plan?: string; status?: string; interviewsUsed?: number; interviewsLimit?: number;
  currentPeriodStart?: string; currentPeriodEnd?: string; subscriptionEndsAt?: string;
  canceledAt?: string; lastPaymentAt?: string; trialEndsAt?: string;
  studentVerified?: boolean; studentEduEmail?: string;
  stripeCustomerId?: string; stripeSubscriptionId?: string;
  lastAppliedCoupon?: string; lastCouponAppliedAt?: string;
  [key: string]: unknown;
}
export interface Usage {
  resumesUsed?: number; coverLettersUsed?: number; studyPlansUsed?: number;
  interviewsUsed?: number; interviewDebriefsUsed?: number; linkedinOptimisationsUsed?: number;
  coldOutreachUsed?: number; findContactsUsed?: number; jobTrackerUsed?: number;
  lastReset?: string; lastUpdated?: string; [key: string]: unknown;
}
export interface User {
  id: string; name?: string; email?: string; provider?: string; isAdmin?: boolean;
  createdAt?: string; updatedAt?: string; lastLogin?: string;
  lastContactedAt?: string; lastContactSubject?: string;
  subscription?: Subscription; usage?: Usage; [key: string]: unknown;
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

export const CODE_REFS: Record<string, { file: string; desc: string }> = {
  stripeWebhook:      { file: "app/api/webhooks/stripe/route.ts",                    desc: "Handles subscription.created/updated/deleted, invoice.payment_succeeded/failed" },
  stripeCreateSub:    { file: "app/api/subscription/create-subscription/route.ts",   desc: "Creates Stripe customer + incomplete subscription + SetupIntent" },
  stripeCancelSub:    { file: "app/api/subscription/cancel-subscription/route.ts",   desc: "cancel_at_period_end — keeps access until period end" },
  priceIds:           { file: "components/StripePaymentForm.tsx",                    desc: "PRICE_IDS const" },
  subscriptionFields: { file: "lib/actions/auth.action.ts",                          desc: "buildSubscription() — all subscription Firestore fields" },
  usageFields:        { file: "lib/actions/auth.action.ts",                          desc: "buildUsage() — all usage counters" },
  usageLimits:        { file: "lib/config/usage-limits.ts",                          desc: "USAGE_LIMITS per-plan limits" },
  usageGuard:         { file: "lib/usage-guard.ts",                                  desc: "checkUsage() + checkAndIncrementUsage()" },
  userDocument:       { file: "lib/actions/auth.action.ts",                          desc: "getCurrentUser()" },
  validateUser:       { file: "lib/actions/auth.action.ts",                          desc: "validateAndFixUserDocument()" },
  adminRoute:         { file: "app/api/admin/route.ts",                              desc: "Server-side admin route" },
  adminTs:            { file: "admin.ts",                                             desc: "Client-side Firebase init with long-polling" },
};

export const PRICE_IDS_MAP: Record<string, { plan: string; billing: string; price: string; label: string }> = {
  "price_1TFjvAQSkS83MGF9XlLXgu5H": { plan: "free",    billing: "—",       price: "$0",           label: "Free"           },
  "price_1TFjwCQSkS83MGF9xH1bdc1o": { plan: "pro",     billing: "Monthly", price: "$9.99/mo",     label: "Pro Monthly"    },
  "price_1TFjykQSkS83MGF9oczwiyNo": { plan: "pro",     billing: "Annual",  price: "$95.88/yr",    label: "Pro Annual"     },
  "price_1TFjzWQSkS83MGF9YCP7CBk3": { plan: "premium", billing: "Monthly", price: "$24.99/mo",    label: "Premium Monthly"},
  "price_1TFk0EQSkS83MGF9pPfRehCO": { plan: "premium", billing: "Annual",  price: "$239.88/yr",   label: "Premium Annual" },
};

// ─── Plan features (matches pricing page) ────────────────────────────────────

export const PLAN_FEATURES: Record<string, { features: string[]; price: string; annualPrice: string; tagline: string; cta: string; popular?: boolean; customPricing?: boolean; securityFeatures?: string[] }> = {
  free: {
    tagline: "Get started and feel the value.",
    price: "$0",
    annualPrice: "$0",
    cta: "Current plan",
    features: [
      "2 resume analyses / month",
      "3 cover letters / month",
      "1 mock interview / month",
      "1 LinkedIn optimisation / month",
      "1 interview debrief / month",
      "1 cold outreach message / month",
      "1 find contacts / month",
      "Job tracker (5 jobs)",
      "Chrome extension (limited)",
      "Basic analytics",
    ],
  },
  pro: {
    tagline: "Everything an active job seeker needs.",
    price: "$9.99/mo",
    annualPrice: "$95.88/yr",
    cta: "Start Pro",
    popular: true,
    features: [
      "10 resume analyses / month",
      "20 cover letters / month",
      "Unlimited mock interviews",
      "5 LinkedIn optimisations / month",
      "5 interview debriefs / month",
      "5 cold outreach messages / month",
      "5 find contacts / month",
      "5 active study plans",
      "Job tracker (30 jobs)",
      "Chrome extension (full)",
      "Resume editor + PDF & Word export",
      "Recruiter eye simulation",
      "Full analytics dashboard",
      "Priority AI responses",
      "Students: 1 month free — no card needed",
    ],
  },
  premium: {
    tagline: "Unlimited access for serious candidates.",
    price: "$24.99/mo",
    annualPrice: "$239.88/yr",
    cta: "Start Premium",
    features: [
      "Unlimited everything",
      "Company-specific interview prep",
      "AI interview coach + deep analysis",
      "Post-interview improvement roadmap",
      "All Pro features included",
      "Priority support (24hr SLA)",
      "Early access to new features",
    ],
  },
  enterprise: {
    tagline: "For teams, hiring pipelines & organisations.",
    price: "Custom",
    annualPrice: "Custom",
    cta: "Contact us",
    customPricing: true,
    features: [
      "Everything in Premium",
      "Unlimited seats across your org",
      "Custom AI interview tracks per role",
      "Dedicated account manager",
      "Flexible invoice billing",
    ],
    securityFeatures: [
      "End-to-end encryption · Google Cloud secured",
      "No data selling · Your data stays yours",
      "GDPR & CCPA ready · Full privacy compliance",
      "Custom DPA available · On request for universities",
      "Pricing based on team size & needs",
    ],
  },
};

export const WEBHOOK_EVENTS = [
  { event: "customer.subscription.created",  handler: "handleSubscriptionCreated" },
  { event: "customer.subscription.updated",  handler: "handleSubscriptionUpdated" },
  { event: "customer.subscription.deleted",  handler: "handleSubscriptionDeleted" },
  { event: "invoice.payment_succeeded",      handler: "handlePaymentSucceeded"    },
  { event: "invoice.payment_failed",         handler: "handlePaymentFailed"       },
];

export const PLANS = ["free", "pro", "premium", "enterprise"] as const;

export const USAGE_FIELDS: { key: keyof Usage; label: string; color: string }[] = [
  { key: "resumesUsed",               label: "Resumes",       color: "#6366F1" },
  { key: "coverLettersUsed",          label: "Cover Letters", color: "#0EA5E9" },
  { key: "studyPlansUsed",            label: "Study Plans",   color: "#10B981" },
  { key: "interviewsUsed",            label: "Interviews",    color: "#F59E0B" },
  { key: "interviewDebriefsUsed",     label: "Debriefs",      color: "#8B5CF6" },
  { key: "linkedinOptimisationsUsed", label: "LinkedIn",      color: "#3B82F6" },
  { key: "coldOutreachUsed",          label: "Cold Outreach", color: "#EC4899" },
  { key: "findContactsUsed",          label: "Find Contacts", color: "#14B8A6" },
  { key: "jobTrackerUsed",            label: "Job Tracker",   color: "#F97316" },
];

// Limits: -1 = unlimited. Matches pricing page exactly.
export const LIMITS: Record<string, Record<string, number>> = {
  free: {
    resumesUsed:               2,   // 2 resume analyses / month
    coverLettersUsed:          3,   // 3 cover letters / month
    studyPlansUsed:            0,   // not included
    interviewsUsed:            1,   // 1 mock interview / month
    interviewDebriefsUsed:     1,   // 1 interview debrief / month
    linkedinOptimisationsUsed: 1,   // 1 LinkedIn optimisation / month
    coldOutreachUsed:          1,   // 1 cold outreach message / month
    findContactsUsed:          1,   // 1 find contacts / month
    jobTrackerUsed:            5,   // Job tracker (5 jobs)
  },
  pro: {
    resumesUsed:               10,  // 10 resume analyses / month
    coverLettersUsed:          20,  // 20 cover letters / month
    studyPlansUsed:            5,   // 5 active study plans
    interviewsUsed:            -1,  // Unlimited mock interviews
    interviewDebriefsUsed:     5,   // 5 interview debriefs / month
    linkedinOptimisationsUsed: 5,   // 5 LinkedIn optimisations / month
    coldOutreachUsed:          5,   // 5 cold outreach messages / month
    findContactsUsed:          5,   // 5 find contacts / month
    jobTrackerUsed:            30,  // Job tracker (30 jobs)
  },
  premium: {
    resumesUsed:               -1,  // Unlimited everything
    coverLettersUsed:          -1,
    studyPlansUsed:            -1,
    interviewsUsed:            -1,
    interviewDebriefsUsed:     -1,
    linkedinOptimisationsUsed: -1,
    coldOutreachUsed:          -1,
    findContactsUsed:          -1,
    jobTrackerUsed:            -1,
  },
  enterprise: {
    resumesUsed:               -1,  // Unlimited everything
    coverLettersUsed:          -1,
    studyPlansUsed:            -1,
    interviewsUsed:            -1,
    interviewDebriefsUsed:     -1,
    linkedinOptimisationsUsed: -1,
    coldOutreachUsed:          -1,
    findContactsUsed:          -1,
    jobTrackerUsed:            -1,
  },
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
  if (p === "enterprise") return { bg:"#F0FDF4", text:"#065F46", border:"#6EE7B7", dot:"#10B981", accent:"#10B981", tw:"bg-emerald-50 text-emerald-800 border-emerald-200" };
  if (p === "premium")    return { bg:"#FEF9EE", text:"#92400E", border:"#FDE68A", dot:"#F59E0B", accent:"#F59E0B", tw:"bg-amber-50 text-amber-800 border-amber-200" };
  if (p === "pro")        return { bg:"#EFF6FF", text:"#1D4ED8", border:"#BFDBFE", dot:"#3B82F6", accent:"#3B82F6", tw:"bg-blue-50 text-blue-700 border-blue-200" };
  if (p === "starter")    return { bg:"#F5F3FF", text:"#6D28D9", border:"#DDD6FE", dot:"#8B5CF6", accent:"#8B5CF6", tw:"bg-violet-50 text-violet-700 border-violet-200" };
  return { bg:"#F9FAFB", text:"#6B7280", border:"#E5E7EB", dot:"#9CA3AF", accent:"#9CA3AF", tw:"bg-gray-50 text-gray-500 border-gray-200" };
}

export function statusColor(s?: string): StatusColor {
  if (s === "active")   return { bg:"#F0FDF4", text:"#16A34A", dot:"#22C55E" };
  if (s === "canceled") return { bg:"#FFF1F2", text:"#BE123C", dot:"#F43F5E" };
  if (s === "past_due") return { bg:"#FFFBEB", text:"#92400E", dot:"#F59E0B" };
  if (s === "trialing") return { bg:"#F5F3FF", text:"#6D28D9", dot:"#8B5CF6" };
  return { bg:"#F9FAFB", text:"#6B7280", dot:"#9CA3AF" };
}

export function fmt(s?: string) {
  if (!s) return "—";
  try { return new Date(s).toLocaleDateString("en-GB", { day:"2-digit", month:"short", year:"numeric" }); }
  catch { return s; }
}
export function fmtFull(s?: string) {
  if (!s) return "—";
  try { return new Date(s).toLocaleString("en-GB", { day:"2-digit", month:"short", year:"numeric", hour:"2-digit", minute:"2-digit" }); }
  catch { return s; }
}
export function daysAgo(s?: string) {
  if (!s) return "—";
  try {
    const d = Math.floor((Date.now() - new Date(s).getTime()) / 86400000);
    if (d === 0) return "Today"; if (d === 1) return "1d ago";
    if (d < 30) return `${d}d ago`; if (d < 365) return `${Math.floor(d/30)}mo ago`;
    return `${Math.floor(d/365)}y ago`;
  } catch { return "—"; }
}

// ─── Shared input classes ─────────────────────────────────────────────────────

export const inputCls  = "w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-900 bg-white outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-0 font-[inherit]";
export const selectCls = inputCls + " cursor-pointer";

// ─── Avatar ───────────────────────────────────────────────────────────────────

const PAL = [
  "bg-violet-100 text-violet-700","bg-blue-100 text-blue-700","bg-emerald-100 text-emerald-700",
  "bg-amber-100 text-amber-700","bg-rose-100 text-rose-700","bg-fuchsia-100 text-fuchsia-700",
  "bg-teal-100 text-teal-700","bg-orange-100 text-orange-700",
];

export function Avatar({ name, size = 36 }: { name?: string; size?: number }) {
  const initials = (name ?? "?").split(" ").map(w => w[0]).join("").slice(0,2).toUpperCase();
  const p = PAL[name ? name.charCodeAt(0) % PAL.length : 0];
  const sz = `${size}px`;
  return (
    <div className={`rounded-full flex items-center justify-center font-bold shrink-0 text-xs ${p}`}
      style={{ width: sz, height: sz, fontSize: size * 0.34 }}>
      {initials}
    </div>
  );
}

// ─── Chip ─────────────────────────────────────────────────────────────────────

export function Chip({ label, className = "" }: { label: string; className?: string }) {
  return (
    <span className={`inline-block text-[11px] font-semibold px-2 py-0.5 rounded whitespace-nowrap ${className}`}>
      {label}
    </span>
  );
}

// ─── StatusDot ────────────────────────────────────────────────────────────────

export function StatusDot({ color }: { color: string }) {
  return <span className="inline-block w-1.5 h-1.5 rounded-full shrink-0" style={{ background: color }} />;
}

// ─── MetricCard ───────────────────────────────────────────────────────────────

export function MetricCard({ label, value, color = "#111827", sub }: { label: string; value: ReactNode; color?: string; sub?: string }) {
  return (
    <div className="bg-white border border-gray-100 rounded-lg p-4 flex flex-col gap-1 min-w-0">
      <div className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">{label}</div>
      <div className="text-2xl font-extrabold leading-none tracking-tight mt-1" style={{ color }}>{value}</div>
      {sub && <div className="text-[11px] text-gray-400 mt-0.5">{sub}</div>}
    </div>
  );
}

// ─── HBar ─────────────────────────────────────────────────────────────────────

export function HBar({ pct, color = "#6366F1", height = 6 }: { pct: number; color?: string; height?: number }) {
  return (
    <div className="bg-gray-100 rounded-full overflow-hidden flex-1" style={{ height }}>
      <div className="h-full rounded-full transition-all" style={{ width: `${Math.min(pct,100)}%`, background: color }} />
    </div>
  );
}

// ─── Donut ────────────────────────────────────────────────────────────────────

export function Donut({ segments, size = 80, label }: { segments: { color: string; value: number }[]; size?: number; label?: string }) {
  const r = 32, cx = 50, cy = 50, circ = 2 * Math.PI * r;
  const total = segments.reduce((a, s) => a + s.value, 0) || 1;
  const arcs = segments.map((s, i) => {
    const pre = segments.slice(0, i).reduce((a, seg) => a + seg.value, 0);
    return { color: s.color, dash: (s.value / total) * circ, off: -(pre / total) * circ };
  });
  return (
    <svg viewBox="0 0 100 100" style={{ width: size, height: size, flexShrink: 0 }}>
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="#F3F4F6" strokeWidth="10" />
      {arcs.map((a, i) => (
        <circle key={i} cx={cx} cy={cy} r={r} fill="none" stroke={a.color} strokeWidth="10"
          strokeDasharray={`${a.dash} ${circ-a.dash}`} strokeDashoffset={a.off}
          style={{ transform:"rotate(-90deg)", transformOrigin:"50% 50%" }} />
      ))}
      {label && <text x="50" y="50" textAnchor="middle" dominantBaseline="central" fontSize="14" fontWeight="800" fill="#111827">{label}</text>}
    </svg>
  );
}

// ─── BarChart ─────────────────────────────────────────────────────────────────

export function BarChart({ data, color = "#6366F1", h = 80 }: { data: { l: string; v: number }[]; color?: string; h?: number }) {
  if (!data?.length) return null;
  const max = Math.max(...data.map(d => d.v), 1);
  const labelH = 14;
  const barArea = h - labelH;
  return (
    <div className="flex items-end overflow-hidden w-full" style={{ gap: 2, height: h }}>
      {data.map((d, i) => (
        <div key={i} className="flex flex-col items-center min-w-0" style={{ flex: 1, gap: 0 }}>
          <div title={`${d.l}: ${d.v}`} style={{ width:"100%", height: Math.max(2, Math.round((d.v/max)*barArea)), background: d.v===0 ? "#F3F4F6" : color, borderRadius:"3px 3px 0 0", opacity: d.v===0 ? 0.4 : 1, flexShrink: 0 }} />
          <div className="flex items-center justify-center overflow-hidden w-full" style={{ height: labelH }}>
            <span className="text-[8px] text-gray-400 text-center truncate block w-full leading-none">{d.l}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── FRow ─────────────────────────────────────────────────────────────────────

export interface FRowProps {
  label: string;
  value?: string | number | boolean | null;
  mono?: boolean;
  copyable?: boolean;
  badgeLabel?: string;
  badgeClassName?: string;
}

export function FRow({ label, value, mono, copyable, badgeLabel, badgeClassName }: FRowProps) {
  const [cp, setCp] = useState(false);
  const strVal  = (value !== undefined && value !== null && value !== "") ? String(value) : "—";
  const copyVal = (value !== undefined && value !== null && value !== "") ? String(value) : "";
  return (
    <div className="flex items-start gap-2.5 py-2 border-b border-gray-50 min-w-0">
      <div className="w-32 shrink-0 text-[10px] font-semibold text-gray-400 uppercase tracking-wider pt-0.5">{label}</div>
      <div className={`flex-1 text-[13px] min-w-0 overflow-hidden ${mono ? "text-indigo-600 font-mono" : "text-gray-900"}`}>
        {badgeLabel ? <Chip label={badgeLabel} className={badgeClassName ?? ""} /> : strVal}
      </div>
      {copyable && copyVal && (
        <button onClick={() => { navigator.clipboard?.writeText(copyVal); setCp(true); setTimeout(()=>setCp(false),1200); }}
          className={`shrink-0 text-[11px] font-semibold border-none bg-transparent cursor-pointer ${cp?"text-green-600":"text-gray-400"}`}>
          {cp ? "✓" : "Copy"}
        </button>
      )}
    </div>
  );
}

// ─── CodeRef ──────────────────────────────────────────────────────────────────

export function CodeRef({ k }: { k: string }) {
  const r = CODE_REFS[k];
  if (!r) return null;
  return (
    <span title={r.desc} className="inline-flex items-center gap-1 bg-violet-50 border border-violet-200 rounded px-1.5 py-0.5 cursor-help">
      <svg width="9" height="9" fill="none" stroke="#7C3AED" strokeWidth="2" viewBox="0 0 24 24">
        <polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/>
      </svg>
      <span className="font-mono text-[9px] text-violet-700 max-w-[180px] truncate">{r.file}</span>
    </span>
  );
}

// ─── Spinner ──────────────────────────────────────────────────────────────────

export function Spinner() {
  return (
    <div className="flex-1 w-full flex flex-col items-center justify-center gap-3 min-h-[240px]">
      <div className="w-7 h-7 rounded-full border-[2.5px] border-gray-200 border-t-indigo-500 animate-spin" />
      <span className="text-[13px] text-gray-400">Loading…</span>
    </div>
  );
}

// ─── SL — section label ───────────────────────────────────────────────────────

export function SL({ children }: { children: ReactNode }) {
  return <div className="text-[10px] font-bold text-gray-400 uppercase tracking-[0.1em] mb-2.5">{children}</div>;
}

// ─── Card ─────────────────────────────────────────────────────────────────────

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`bg-white border border-gray-100 rounded-xl p-4 md:p-5 ${className}`}>{children}</div>;
}

// ─── CardTitle ────────────────────────────────────────────────────────────────

export function CardTitle({ children }: { children: ReactNode }) {
  return <div className="text-[15px] font-extrabold text-gray-900 tracking-tight mb-4">{children}</div>;
}