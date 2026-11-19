// components/admin/admin-shared.tsx
"use client";

import React, { useState, useEffect, ReactNode, createContext, useContext } from "react";
import { Select as RadixSelect } from "radix-ui";
import { cn } from "@/lib/utils";
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
  applicationsUsed?: number; resumesUsed?: number; coverLettersUsed?: number; studyPlansUsed?: number;
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
  /** Optional emails turned off, e.g. ["weekly digest", "coaching"]. */
  emailOptOuts?: string[];
  subscription?: Subscription; usage?: Usage; packs?: PackSummary; student?: StudentInfo;
  /** Where they came from at sign-up; absent for accounts created before it was recorded. */
  origin?: Origin;
  [key: string]: unknown;
}
// Mirrors Origin in lib/attribution.ts (server-only, so it can't be imported here).
export interface Origin {
  source: string; channel: string; via: "site" | "app";
  campaign?: string; medium?: string; referrerHost?: string; landing?: string;
  visitorKey?: string; visitorPersistent?: boolean; at?: string;
}

const STUDENT_META: Record<StudentInfo["status"], { label: string; tw: string; title: string }> = {
  claimed:  { label: "Student · claimed", tw: "bg-violet-soft text-violet-fg border-violet-line", title: "Verified .edu email and claimed the free student month" },
  verified: { label: "Student",           tw: "bg-violet-soft text-violet-fg border-violet-line", title: "Verified .edu email — hasn't claimed the free month" },
  pending:  { label: "Student · pending", tw: "bg-raised text-fg-3 border-line", title: "Started .edu verification but never entered the code" },
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
  stripeWebhook:      { file: "app/api/webhooks/stripe/route.ts",                    desc: "Subscription lifecycle, pack grants, refunds, disputes, billing emails" },
  stripeCreateSub:    { file: "app/api/subscription/create-subscription/route.ts",   desc: "Checkout step 1: Stripe customer + SetupIntent tagged with the plan" },
  stripeActivate:     { file: "app/api/subscription/activate/route.ts",              desc: "Checkout step 2: creates the subscription from the saved card, grants the plan once paid" },
  stripeCancelSub:    { file: "app/api/billing/route.ts",                            desc: "In-app billing: cancel / resume at period end" },
  refundFirst:        { file: "lib/refund/first-payment.ts",                         desc: "Full first-payment refund (7 days, under 10% used), less fees" },
  refundUnused:       { file: "lib/refund/unused-credits.ts",                        desc: "Unused-credits refund for the current month, once per 6 months, less fees" },
  refundFees:         { file: "lib/refund/fees.ts",                                  desc: "Stripe processing + Billing fees deducted from every refund" },
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
// Both Stripe accounts are listed so a subscription from either is labelled.
// The live ids come first: the plan picker uses the first match per plan, and
// the server swaps in the price for its own key's mode anyway
// (planPriceId in app/api/admin/route.ts).
export const PRICE_IDS_MAP: Record<string, { plan: string; billing: string; price: string; label: string }> = {
  "price_1UOhFJKQ6vMUI1940yx1rqc5": { plan: "free",    billing: "",       price: "$0",           label: "Free"           },
  "price_1UOhFOKQ6vMUI194GVN3RAot": { plan: "pro",     billing: "Monthly", price: "$9.99/mo",     label: "Pro Monthly"    },
  "price_1UOhFJKQ6vMUI194CB4gWj4w": { plan: "premium", billing: "Monthly", price: "$24.99/mo",    label: "Premium Monthly"},
  // Test mode
  "price_1TFjvAQSkS83MGF9XlLXgu5H": { plan: "free",    billing: "",       price: "$0",           label: "Free (test)"           },
  "price_1TFjwCQSkS83MGF9xH1bdc1o": { plan: "pro",     billing: "Monthly", price: "$9.99/mo",     label: "Pro Monthly (test)"    },
  "price_1TFjzWQSkS83MGF9YCP7CBk3": { plan: "premium", billing: "Monthly", price: "$24.99/mo",    label: "Premium Monthly (test)"},
};

const PLAN_PRICES: Record<string, number> = { free: 0, pro: 9.99, premium: 24.99 };
export function planMonthlyPrice(plan?: string): number { return PLAN_PRICES[plan ?? "free"] ?? 0; }

// Monthly quotas — mirrors USAGE_LIMITS in the Dashboard's lib/config/usage-limits.ts. -1 = unlimited.
// Pack credits (User.packs.balance) are spent only after these run out.
// Journal entries and the job tracker are unlimited on every plan.
export const LIMITS: Record<string, Record<string, number>> = {
  free:       { applicationsUsed:1,  resumesUsed:2,  coverLettersUsed:2,  studyPlansUsed:1, interviewsUsed:1, interviewDebriefsUsed:-1, debriefAnalysesUsed:1, linkedinOptimisationsUsed:1, coldOutreachUsed:2,  findContactsUsed:2,  jobTrackerUsed:-1 },
  pro:        { applicationsUsed:6,  resumesUsed:10, coverLettersUsed:10, studyPlansUsed:3, interviewsUsed:3, interviewDebriefsUsed:-1, debriefAnalysesUsed:2, linkedinOptimisationsUsed:3, coldOutreachUsed:10, findContactsUsed:10, jobTrackerUsed:-1 },
  premium:    { applicationsUsed:12, resumesUsed:20, coverLettersUsed:20, studyPlansUsed:5, interviewsUsed:5, interviewDebriefsUsed:-1, debriefAnalysesUsed:4, linkedinOptimisationsUsed:5, coldOutreachUsed:20, findContactsUsed:20, jobTrackerUsed:-1 },
  enterprise: { applicationsUsed:-1, resumesUsed:-1, coverLettersUsed:-1, studyPlansUsed:-1, interviewsUsed:-1, interviewDebriefsUsed:-1, debriefAnalysesUsed:-1, linkedinOptimisationsUsed:-1, coldOutreachUsed:-1, findContactsUsed:-1, jobTrackerUsed:-1 },
};

// Plan-card lines, built from LIMITS in the Dashboard's display order and wording
// (lib/config/plan-features.ts) so the ERP can't advertise a different number.
const FEATURE_ORDER: [string, string, string][] = [
  ["applicationsUsed",          "tailored application",  "tailored applications"],
  ["resumesUsed",               "resume analysis",       "resume analyses"],
  ["coverLettersUsed",          "cover letter",          "cover letters"],
  ["interviewsUsed",            "mock interview",        "mock interviews"],
  ["studyPlansUsed",            "study plan",            "study plans"],
  ["linkedinOptimisationsUsed", "LinkedIn optimisation", "LinkedIn optimisations"],
  ["coldOutreachUsed",          "outreach message",      "outreach messages"],
  ["findContactsUsed",          "contact search",        "contact searches"],
  ["debriefAnalysesUsed",       "AI analysis of your real interviews", "AI analyses of your real interviews"],
];
function planFeatureLines(plan: string): string[] {
  const l = LIMITS[plan];
  return [
    ...FEATURE_ORDER.map(([k, one, many]) => l[k] < 0 ? `Unlimited ${many}` : `${l[k]} ${l[k] === 1 ? one : many} / month`),
    "Unlimited interview journal", "Unlimited job tracker",
  ];
}

export const PLAN_FEATURES: Record<string, { features: string[]; price: string; annualPrice: string; tagline: string; cta: string; popular?: boolean; customPricing?: boolean; securityFeatures?: string[] }> = {
  free: {
    tagline: "Get started and feel the value.",
    price: "$0", annualPrice: "$0", cta: "Current plan",
    features: planFeatureLines("free"),
  },
  pro: {
    tagline: "Everything an active job seeker needs.",
    price: "$9.99/mo", annualPrice: "—", cta: "Start Pro", popular: true,
    features: planFeatureLines("pro"),
  },
  premium: {
    tagline: "For serious candidates.",
    price: "$24.99/mo", annualPrice: "—", cta: "Start Premium",
    features: planFeatureLines("premium"),
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
  { event: "invoice.finalized",                     handler: "handleInvoiceFinalized"         },
  { event: "invoice.payment_action_required",       handler: "handleActionRequired"           },
  { event: "invoice.upcoming",                      handler: "handleInvoiceUpcoming"          },
  { event: "customer.subscription.trial_will_end",  handler: "handleTrialWillEnd"             },
  { event: "checkout.session.completed",            handler: "handleCheckoutSessionCompleted" },
  { event: "checkout.session.async_payment_succeeded", handler: "handleCheckoutSessionCompleted" },
  { event: "charge.refunded",                       handler: "handleChargeRefunded"           },
  { event: "charge.dispute.created",                handler: "handleDisputeCreated"           },
];

export const PLANS = ["free", "pro", "premium", "enterprise"] as const;

export const USAGE_FIELDS: { key: keyof Usage; label: string; color: string }[] = [
  { key: "applicationsUsed",          label: "Applications",  color: "#5b6cff" },
  { key: "resumesUsed",               label: "Resumes",       color: "#3b82f6" },
  { key: "coverLettersUsed",          label: "Cover Letters", color: "#10b981" },
  { key: "studyPlansUsed",            label: "Study Plans",   color: "#50e3c2" },
  { key: "interviewsUsed",            label: "Interviews",    color: "#f59e0b" },
  { key: "interviewDebriefsUsed",     label: "Journal",       color: "#a855f7" },
  { key: "debriefAnalysesUsed",       label: "Interview AI",  color: "#c084fc" },
  { key: "linkedinOptimisationsUsed", label: "LinkedIn",      color: "#38bdf8" },
  { key: "coldOutreachUsed",          label: "Cold Outreach", color: "#f472b6" },
  { key: "findContactsUsed",          label: "Find Contacts", color: "#2dd4bf" },
  { key: "jobTrackerUsed",            label: "Job Tracker",   color: "#fb923c" },
];

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
    bg: "var(--success-soft)", text: "var(--success-fg)", border: "var(--success-line)", dot: "#10b981", accent: "#10b981",
    tw: "bg-success-soft text-success-fg border-success-line",
  };
  if (p === "premium") return {
    bg: "var(--warning-soft)", text: "var(--warning-fg)", border: "var(--warning-line)", dot: "#f59e0b", accent: "#f59e0b",
    tw: "bg-warning-soft text-warning-fg border-warning-line",
  };
  if (p === "pro") return {
    bg: "var(--brand-soft)", text: "var(--brand-fg)", border: "var(--brand-line)", dot: "#5b6cff", accent: "#5b6cff",
    tw: "bg-brand-soft text-brand-fg border-brand-line",
  };
  if (p === "starter") return {
    bg: "var(--violet-soft)", text: "var(--violet-fg)", border: "var(--violet-line)", dot: "#a855f7", accent: "#a855f7",
    tw: "bg-violet-soft text-violet-fg border-violet-line",
  };
  return {
    bg: "var(--raised)", text: "var(--fg-3)", border: "var(--line)", dot: "var(--fg-4)", accent: "var(--fg-5)",
    tw: "bg-raised text-fg-3 border-line",
  };
}

export function statusColor(s?: string): StatusColor {
  if (s === "active")   return { bg: "var(--success-soft)", text: "var(--success-fg)", dot: "#10b981" };
  if (s === "canceled") return { bg: "var(--danger-soft)", text: "var(--danger-fg)", dot: "#ef4444" };
  if (s === "past_due") return { bg: "var(--warning-soft)", text: "var(--warning-fg)", dot: "#f59e0b" };
  if (s === "trialing") return { bg: "var(--info-soft)", text: "var(--info-fg)", dot: "var(--info)" };
  return { bg: "var(--raised)", text: "var(--fg-4)", dot: "var(--fg-5)" };
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

// The one form-control look (.field in globals.css). Kept as constants so
// existing call sites can append layout classes.
export const inputCls = "field";
export const selectCls = "field";

/** A colour at the given alpha ("12" hex byte or 0–1), for hex and var() colours alike. */
export function tint(color: string, alpha: string | number): string {
  const a = typeof alpha === "string" ? parseInt(alpha, 16) / 255 : alpha;
  return `color-mix(in srgb, ${color} ${Math.round(a * 1000) / 10}%, transparent)`;
}

// ─── Select ───────────────────────────────────────────────────────────────────

// Themed dropdown built on Radix Select. The native <select> popup is drawn by
// the OS (white list, bright blue highlight) and can't be styled, so this
// replaces it everywhere while keeping the native-select API: pass <option> /
// <optgroup> children and read e.target.value in onChange. Uses the same hex
// colour classes as the rest of the app so the light-theme overrides in
// globals.css apply to the portalled list too.

type SelectProps = {
  value?: string;
  onChange?: (e: { target: { value: string }; currentTarget: { value: string } }) => void;
  children?: ReactNode;
  className?: string;          // trigger styling (e.g. text size, height)
  wrapperClassName?: string;   // trigger width/layout (e.g. "flex-1", "min-w-[120px]")
  leading?: ReactNode;         // inline label inside the trigger, e.g. "Time"
  placeholder?: string;
  disabled?: boolean;
  id?: string;
  title?: string;
  "aria-label"?: string;
};

interface SelectOpt { value: string; label: ReactNode; text: string; disabled?: boolean }
interface SelectGroup { label?: string; options: SelectOpt[] }

// Radix reserves "" (it means "no value"), so an empty-valued <option> is mapped through a sentinel.
const EMPTY = "__adm_empty__";
const toRadix   = (v: string) => (v === "" ? EMPTY : v);
const fromRadix = (v: string) => (v === EMPTY ? "" : v);

function nodeText(n: ReactNode): string {
  if (n == null || typeof n === "boolean") return "";
  if (typeof n === "string" || typeof n === "number") return String(n);
  if (Array.isArray(n)) return n.map(nodeText).join("");
  if (React.isValidElement(n)) return nodeText((n.props as { children?: ReactNode }).children);
  return "";
}

function parseOptions(children: ReactNode): SelectGroup[] {
  const groups: SelectGroup[] = [{ options: [] }];
  const walk = (nodes: ReactNode, into: SelectGroup) => {
    React.Children.forEach(nodes, child => {
      if (!React.isValidElement(child)) return;
      const props = child.props as { value?: string | number; children?: ReactNode; label?: string; disabled?: boolean };
      if (child.type === React.Fragment) { walk(props.children, into); return; }
      if (child.type === "optgroup") {
        const g: SelectGroup = { label: props.label, options: [] };
        groups.push(g); walk(props.children, g); return;
      }
      if (child.type === "option") {
        const text = nodeText(props.children);
        into.options.push({ value: String(props.value ?? text), label: props.children, text, disabled: props.disabled });
      }
    });
  };
  walk(children, groups[0]);
  return groups.filter(g => g.options.length > 0);
}

const Chevron = ({ className = "" }: { className?: string }) => (
  <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" className={className} aria-hidden="true">
    <path d="M6 9l6 6 6-6"/>
  </svg>
);

export function Select({
  value, onChange, children, className = "", wrapperClassName = "w-full",
  leading, placeholder, disabled, id, title, "aria-label": ariaLabel,
}: SelectProps) {
  const groups = parseOptions(children);
  const all    = groups.flatMap(g => g.options);
  const current = all.find(o => o.value === (value ?? ""));

  return (
    <RadixSelect.Root
      value={current ? toRadix(current.value) : undefined}
      onValueChange={v => { const val = fromRadix(v); onChange?.({ target: { value: val }, currentTarget: { value: val } }); }}
      disabled={disabled}
    >
      <RadixSelect.Trigger
        id={id} title={title} aria-label={ariaLabel ?? (typeof leading === "string" ? leading : undefined)}
        className={cn(
          "group inline-flex items-center gap-2 min-w-0 h-9 border border-line rounded-lg pl-3 pr-2.5 text-[13px] text-fg bg-subtle",
          "outline-none hover:border-line-hover focus-visible:border-brand-line focus-visible:ring-[3px] focus-visible:ring-brand-soft",
          "data-[state=open]:border-brand-line data-[state=open]:ring-[3px] data-[state=open]:ring-brand-soft disabled:opacity-40 disabled:cursor-not-allowed transition-[border-color,box-shadow] cursor-pointer font-[inherit] text-left",
          wrapperClassName, className,
        )}
      >
        {leading && <span className="text-[11px] font-medium uppercase tracking-wider text-fg-4 shrink-0">{leading}</span>}
        <span className="flex-1 min-w-0 truncate group-data-placeholder:text-fg-4">
          <RadixSelect.Value placeholder={placeholder ?? all[0]?.text ?? "Select…"}>
            {current ? current.text : undefined}
          </RadixSelect.Value>
        </span>
        <RadixSelect.Icon asChild>
          <Chevron className="shrink-0 text-fg-4 transition-transform duration-150 group-data-[state=open]:rotate-180" />
        </RadixSelect.Icon>
      </RadixSelect.Trigger>

      <RadixSelect.Portal>
        <RadixSelect.Content
          position="popper" side="bottom" align="start" sideOffset={6} collisionPadding={8}
          className={cn(
            "z-[10000] min-w-(--radix-select-trigger-width) max-w-[min(360px,calc(100vw-16px))]",
            "max-h-[min(320px,var(--radix-select-content-available-height))] overflow-hidden",
            "popover rounded-[10px]!",
            "adm-select-content",
          )}
        >
          <RadixSelect.ScrollUpButton className="flex items-center justify-center h-6 text-fg-4 bg-surface cursor-default">
            <Chevron className="rotate-180" />
          </RadixSelect.ScrollUpButton>
          <RadixSelect.Viewport className="p-1">
            {groups.map((g, gi) => (
              <RadixSelect.Group key={gi}>
                {gi > 0 && <RadixSelect.Separator className="h-px bg-line-soft my-1 mx-1" />}
                {g.label && (
                  <RadixSelect.Label className="px-2.5 pt-1.5 pb-1 text-[10px] font-semibold uppercase tracking-[0.1em] text-fg-4">
                    {g.label}
                  </RadixSelect.Label>
                )}
                {g.options.map(o => (
                  <RadixSelect.Item
                    key={o.value} value={toRadix(o.value)} disabled={o.disabled} textValue={o.text}
                    className={cn(
                      "relative flex items-center gap-2 rounded-md pl-2.5 pr-8 py-1.5 text-[13px] text-fg-2 select-none outline-none cursor-pointer",
                      "data-highlighted:bg-hover data-highlighted:text-fg",
                      "data-[state=checked]:text-fg data-[state=checked]:font-medium",
                      "data-disabled:opacity-40 data-disabled:cursor-not-allowed",
                    )}
                  >
                    <RadixSelect.ItemText>{o.label}</RadixSelect.ItemText>
                    <RadixSelect.ItemIndicator className="absolute right-2.5 inline-flex items-center text-brand-fg">
                      <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24" aria-hidden="true">
                        <polyline points="20 6 9 17 4 12"/>
                      </svg>
                    </RadixSelect.ItemIndicator>
                  </RadixSelect.Item>
                ))}
              </RadixSelect.Group>
            ))}
          </RadixSelect.Viewport>
          <RadixSelect.ScrollDownButton className="flex items-center justify-center h-6 text-fg-4 bg-surface cursor-default">
            <Chevron />
          </RadixSelect.ScrollDownButton>
        </RadixSelect.Content>
      </RadixSelect.Portal>
    </RadixSelect.Root>
  );
}

// ─── Avatar ───────────────────────────────────────────────────────────────────

const PAL = [
  "bg-brand-soft text-brand-fg",
  "bg-info-soft text-info-fg",
  "bg-success-soft text-success-fg",
  "bg-warning-soft text-warning-fg",
  "bg-danger-soft text-danger-fg",
  "bg-violet-soft text-violet-fg",
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
    <span className={`badge ${className}`}>
      {label}
    </span>
  );
}

export function StatusDot({ color }: { color: string }) {
  return <span className="inline-block w-1.5 h-1.5 rounded-full shrink-0" style={{ background: color }} />;
}

// ─── Checkbox ─────────────────────────────────────────────────────────────────
// A real <input> kept for keyboard and screen readers, visually replaced by a
// box in the ERP palette; the browser's default renders white on black.

export function Checkbox({
  checked, onChange, label, indeterminate = false, disabled = false, className = "",
}: {
  checked: boolean; onChange: () => void; label: string;
  indeterminate?: boolean; disabled?: boolean; className?: string;
}) {
  const on = checked || indeterminate;
  return (
    <label onClick={e => e.stopPropagation()}
      className={`relative inline-flex items-center justify-center w-4 h-4 shrink-0 ${disabled ? "opacity-40 cursor-not-allowed" : "cursor-pointer"} ${className}`}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={onChange} aria-label={label}
        aria-checked={indeterminate ? "mixed" : checked} className="peer absolute inset-0 opacity-0 m-0 cursor-[inherit]" />
      <span aria-hidden="true"
        className={`w-4 h-4 rounded-[4px] border flex items-center justify-center transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-line-hover ${
          on ? "bg-brand border-brand" : "bg-subtle border-line-hover hover:border-line-strong"}`}>
        {indeterminate && !checked
          ? <span className="w-2 h-[1.5px] bg-white rounded" />
          : checked && <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>}
      </span>
    </label>
  );
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
    <div className="card px-4 py-3.5 flex flex-col gap-2">
      <SkeletonLine w="45%" h={9} />
      <SkeletonLine w="55%" h={22} />
      <SkeletonLine w="35%" h={9} />
    </div>
  );
}

export function SkeletonTable({ rows = 6, cols = 4 }: { rows?: number; cols?: number }) {
  return (
    <div className="w-full">
      <div className="flex gap-4 px-4 py-2.5 border-b border-line-soft">
        {Array.from({ length: cols }).map((_, i) => (
          <SkeletonLine key={i} w={i === 0 ? "30%" : "20%"} h={9} />
        ))}
      </div>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex gap-4 px-4 py-3 border-b border-line-soft">
          {Array.from({ length: cols }).map((_, j) => (
            <SkeletonLine key={j} w={j === 0 ? "30%" : j === cols - 1 ? "12%" : "20%"} h={10} />
          ))}
        </div>
      ))}
    </div>
  );
}

// ─── MetricCard ───────────────────────────────────────────────────────────────

export function MetricCard({ label, value, color = "var(--fg)", sub }: { label: string; value: ReactNode; color?: string; sub?: string }) {
  return (
    <div className="card px-4 py-3.5 flex flex-col gap-1">
      <div className="label truncate">{label}</div>
      <div className="text-[24px] font-semibold leading-none tracking-tight mt-1.5 num truncate" style={{ color }}>{value}</div>
      {sub && <div className="text-caption mt-1 truncate">{sub}</div>}
    </div>
  );
}

// ─── HBar ─────────────────────────────────────────────────────────────────────

export function HBar({ pct, color = "#5b6cff", height = 4 }: { pct: number; color?: string; height?: number }) {
  return (
    <div className="rounded-full overflow-hidden flex-1" style={{ height, background: "var(--raised-2)" }}>
      <div className="h-full rounded-full transition-all" style={{ width: `${Math.min(pct, 100)}%`, background: color }} />
    </div>
  );
}

// ─── Chart SX overrides ───────────────────────────────────────────────────────

const CHART_SX = {
  fontFamily: "var(--font-geist-sans), -apple-system, sans-serif",
  background: "transparent",
  "& .MuiChartsAxis-line":      { stroke: "var(--line)" },
  "& .MuiChartsAxis-tick":      { stroke: "var(--line)" },
  "& .MuiChartsGrid-line":      { stroke: "var(--line-soft)", strokeDasharray: "4 4" },
  "& .MuiChartsAxis-tickLabel": { fill: "var(--fg-4)" },
  "& .MuiChartsTooltip-root":   { background: "var(--surface) !important", border: "1px solid var(--line-hover) !important", borderRadius: "10px", boxShadow: "var(--shadow-pop)" },
  "& .MuiChartsTooltip-table":  { fontFamily: "inherit" },
  "& .MuiChartsLegend-label":   { fill: "var(--fg-3)", fontSize: 11, fontFamily: "inherit" },
  "& text":                      { fontFamily: "var(--font-geist-sans), -apple-system, sans-serif !important", fill: "var(--fg-4) !important" },
} as const;

const TICK_STYLE = { fontSize: 9, fill: "var(--fg-4)", fontFamily: "var(--font-geist-sans), -apple-system, sans-serif" } as const;

// ─── BarChart ─────────────────────────────────────────────────────────────────

export function BarChart({ data, color = "#5b6cff", h = 80 }: { data: { l: string; v: number }[]; color?: string; h?: number }) {
  if (!data?.length) return null;
  return (
    <MuiBarChart
      height={h + 40}
      series={[{ data: data.map(d => d.v), color, valueFormatter: (v: number | null) => String(v ?? 0) }]}
      xAxis={[{ data: data.map(d => d.l), scaleType: "band", tickLabelStyle: TICK_STYLE, tickSize: 0 }]}
      yAxis={[{ tickLabelStyle: { ...TICK_STYLE, fill: "var(--fg-5)" }, tickSize: 0 }]}
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
          fontSize: size * 0.16, fontWeight: 700, color: "var(--fg)",
          pointerEvents: "none", lineHeight: 1, letterSpacing: "-0.02em",
        }}>
          {label}
        </div>
      )}
    </div>
  );
}

// ─── LineChart ────────────────────────────────────────────────────────────────

export function LineChart({ data, labels, color = "#5b6cff", h = 120, area = false, smooth = true }: {
  data: number[][]; labels: string[]; colors?: string[]; color?: string; h?: number; area?: boolean; smooth?: boolean;
}) {
  if (!data?.length || !labels?.length) return null;
  const colors = ["#5b6cff", "#10b981", "#f59e0b", "#f472b6", "#38bdf8", "#a855f7"];
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
      yAxis={[{ tickLabelStyle: { ...TICK_STYLE, fill: "var(--fg-5)" }, tickSize: 0 }]}
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
    <div className="flex items-start gap-2.5 py-2.5 border-b border-line-soft last:border-0 min-w-0">
      <div className="w-32 shrink-0 label pt-0.5">{label}</div>
      <div className={`flex-1 text-[13px] min-w-0 overflow-hidden ${mono ? "text-brand-fg font-mono text-[12px]" : "text-fg"}`}>
        {badgeLabel ? <Chip label={badgeLabel} className={badgeClassName ?? ""} /> : strVal}
      </div>
      {copyable && copyVal && (
        <button
          onClick={() => { navigator.clipboard?.writeText(copyVal); setCp(true); setTimeout(() => setCp(false), 1200); }}
          className={`link shrink-0 text-[12px] ${cp ? "text-success-fg!" : ""}`}
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
      <span className="inline-flex items-center gap-1 bg-brand-soft border border-brand-line rounded px-1.5 py-0.5">
        <svg width="9" height="9" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" className="text-brand-fg">
          <polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/>
        </svg>
        <span className="font-mono text-[11px] text-brand-fg max-w-45 truncate">{r.file}</span>
        <button
          onClick={e => { e.stopPropagation(); void load(); }}
          title={r.desc}
          className="ml-0.5 w-3.5 h-3.5 rounded-full bg-brand-soft text-brand-fg text-[8px] font-bold border-none cursor-pointer hover:bg-brand-line transition-colors flex items-center justify-center leading-none shrink-0"
        >
          ?
        </button>
      </span>

      {open && (
        <div
          className="fixed inset-0 z-[9999] flex items-center justify-center p-4"
          style={{ background: "var(--scrim)", backdropFilter: "blur(3px)" }}
          onClick={e => { if (e.target === e.currentTarget) setOpen(false); }}
        >
          <div
            className="popover animate-pop-in flex flex-col overflow-hidden w-full max-w-3xl"
            style={{ maxHeight: "82vh" }}
          >
            {/* Header */}
            <div className="flex items-center gap-3 px-5 py-4 border-b border-line shrink-0">
              <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" className="shrink-0 text-brand-fg">
                <polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/>
              </svg>
              <code className="font-mono text-[13px] text-brand-fg flex-1 min-w-0 truncate">{r.file}</code>
              <button
                onClick={() => setOpen(false)}
                className="btn btn-ghost btn-sm btn-icon shrink-0" aria-label="Close"
              >
                <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M18 6L6 18M6 6l12 12"/></svg>
              </button>
            </div>
            <div className="px-5 py-2.5 text-[12px] text-fg-4 border-b border-line-soft shrink-0">{r.desc}</div>

            {/* Code body */}
            <div className="flex-1 overflow-auto min-h-0">
              {fetching && (
                <div className="flex items-center justify-center py-12">
                  <div className="w-5 h-5 rounded-full border-2 border-line border-t-brand animate-spin" />
                </div>
              )}
              {err && !fetching && (
                <div className="px-5 py-4 text-sm text-danger-fg">{err}</div>
              )}
              {content && !fetching && (
                <pre className="p-5 m-0 text-[12px] font-mono text-fg-2 leading-relaxed overflow-x-auto whitespace-pre">
                  <code>{content}</code>
                </pre>
              )}
            </div>

            {content && (
              <div className="px-5 py-2.5 border-t border-line-soft text-[11px] text-fg-5 shrink-0 flex items-center justify-between">
                <span>{content.split("\n").length} lines · {r.file}</span>
                <button
                  onClick={() => navigator.clipboard?.writeText(content)}
                  className="link text-[12px]"
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
        className="rounded-full border-2 border-line border-t-brand animate-spin shrink-0"
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <div className="flex-1 w-full flex flex-col items-center justify-center gap-2.5 min-h-48">
      <div className="w-5 h-5 rounded-full border-2 border-line border-t-brand animate-spin" />
      <span className="text-caption">Loading…</span>
    </div>
  );
}

export function SL({ children }: { children: ReactNode }) {
  return <div className="label mb-3">{children}</div>;
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`card card-pad ${className}`}>{children}</div>;
}

export function CardTitle({ children }: { children: ReactNode }) {
  return <div className="section-title mb-4">{children}</div>;
}

// ─── Origin (where a user came from) ──────────────────────────────────────────

export const CHANNEL_LABEL: Record<string, string> = {
  organic: "Search", paid: "Paid", social: "Social", ai: "AI assistant", email: "Email",
  referral: "Referral", campaign: "Campaign", affiliate: "Affiliate", direct: "Direct",
};
const CHANNEL_TONE: Record<string, string> = {
  organic: "badge-success", paid: "badge-warning", social: "badge-info", ai: "badge-violet",
  email: "badge-brand", campaign: "badge-brand", affiliate: "badge-warning", referral: "badge-neutral", direct: "badge-neutral",
};
/** Series colour per channel, for charts and bars. */
export const CHANNEL_COLOR: Record<string, string> = {
  organic: "#10b981", paid: "#f59e0b", social: "#3b82f6", ai: "#a855f7", email: "#5b6cff",
  campaign: "#5b6cff", affiliate: "#f59e0b", referral: "#9aa3b2", direct: "#6b7486",
};
export const channelLabel = (c?: string) => CHANNEL_LABEL[c ?? "direct"] ?? (c ? c[0].toUpperCase() + c.slice(1) : "Direct");

/** "Google · Search", tinted by channel. Shows "Not recorded" for accounts from before tracking. */
export function OriginBadge({ origin, compact = false }: { origin?: Origin; compact?: boolean }) {
  if (!origin) return <span className="text-[12px] text-fg-5" title="Signed up before sources were recorded">Not recorded</span>;
  const label = origin.source === "Direct" || origin.source.toLowerCase() === channelLabel(origin.channel).toLowerCase()
    ? channelLabel(origin.channel)
    : compact ? origin.source : `${origin.source} · ${channelLabel(origin.channel)}`;
  const title = [`${origin.source} (${channelLabel(origin.channel)})`, origin.campaign && `Campaign: ${origin.campaign}`,
    origin.landing && `First page: ${origin.landing}`, origin.via === "site" ? "Came through preciprocal.com" : "Went straight to the app"]
    .filter(Boolean).join("\n");
  return <span className={`badge ${CHANNEL_TONE[origin.channel] ?? "badge-neutral"} max-w-[180px]`} title={title}><span className="truncate">{label}</span></span>;
}
