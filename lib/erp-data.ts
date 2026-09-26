// lib/erp-data.ts
// Server-side mapping between the Dashboard's Supabase schema and the
// camelCase User shape the ERP UI was built around (originally one Firestore
// users/{uid} doc, now split across profiles / subscriptions / usage_counters).
import "server-only";
import { SupabaseClient } from "@supabase/supabase-js";

// ─── Usage counters ───────────────────────────────────────────────────────────

/** ERP usage key → usage_counters column. */
export const USAGE_COLUMNS: Record<string, string> = {
  resumesUsed:               "resumes_used",
  coverLettersUsed:          "cover_letters_used",
  studyPlansUsed:            "study_plans_used",
  interviewsUsed:            "interviews_used",
  interviewDebriefsUsed:     "interview_debriefs_used",
  debriefAnalysesUsed:       "debrief_analyses_used",
  linkedinOptimisationsUsed: "linkedin_optimisations_used",
  coldOutreachUsed:          "cold_outreach_used",
  findContactsUsed:          "find_contacts_used",
  jobTrackerUsed:            "job_tracker_used",
  jobAnalysesUsed:           "job_analyses_used",
};

// Copy of the Dashboard's lib/usage/period.ts. usage_counters is keyed on
// (user_id, period_start), so this MUST compute the same window the Dashboard
// does or edits land on a row the app never reads.
const PERIOD_DAYS = 30;
const DAY_MS = 86_400_000;
const toDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export function computeUsagePeriod(anchor: string | null | undefined): { periodStart: string; periodEnd: string } {
  const anchorMs = anchor ? Date.parse(anchor) : NaN;
  if (!Number.isFinite(anchorMs)) {
    const now = new Date();
    return {
      periodStart: toDay(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)),
      periodEnd:   toDay(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)),
    };
  }
  const now = Date.now();
  const startMs = now < anchorMs
    ? anchorMs
    : anchorMs + Math.floor((now - anchorMs) / (PERIOD_DAYS * DAY_MS)) * PERIOD_DAYS * DAY_MS;
  return { periodStart: toDay(startMs), periodEnd: toDay(startMs + PERIOD_DAYS * DAY_MS - DAY_MS) };
}

export function pickAnchor(subStartedAt?: string | null, curPeriodStart?: string | null, profileCreatedAt?: string | null) {
  return subStartedAt ?? curPeriodStart ?? profileCreatedAt ?? null;
}

// ─── Paging helper ────────────────────────────────────────────────────────────

/** PostgREST caps responses at 1000 rows; page through the whole result. */
export async function fetchAll<T = Record<string, unknown>>(
  build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  pageSize = 1000,
  maxRows = 50_000,
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; from < maxRows; from += pageSize) {
    const { data, error } = await build(from, from + pageSize - 1);
    if (error) throw new Error(error.message);
    out.push(...(data ?? []));
    if (!data || data.length < pageSize) break;
  }
  return out;
}

// ─── Row types ────────────────────────────────────────────────────────────────

type Row = Record<string, unknown>;
interface ProfileRow { user_id: string; name: string | null; email: string; provider: string | null; is_admin: boolean; created_at: string; updated_at: string; last_login: string | null }
interface SubRow {
  user_id: string; plan: string; status: string;
  stripe_customer_id: string | null; stripe_subscription_id: string | null;
  trial_ends_at: string | null; current_period_start: string | null; current_period_end: string | null;
  subscription_ends_at: string | null; canceled_at: string | null; last_payment_at: string | null;
  student_verified: boolean; student_edu_email: string | null; subscription_started_at: string | null;
}
interface PackRow { user_id: string; pack_key: string; granted: Record<string, number>; consumed: Record<string, number>; price_cents: number; purchased_at: string; refunded_at: string | null }
interface MetaRow { user_id: string; last_contacted_at: string | null; last_contact_subject: string | null; last_applied_coupon: string | null; last_coupon_applied_at: string | null }
interface StudentRow {
  user_id: string; edu_email: string | null; email_domain: string | null; verification_method: string;
  verified_at: string | null; edu_perk_redeemed: boolean; redeemed_at: string | null; attempts: number; created_at: string;
}

/**
 * .edu student perk, from student_verifications (the Dashboard's ledger):
 *   pending  — started verifying an .edu email, never entered the code
 *   verified — .edu email confirmed by one-time code (verified_at)
 *   claimed  — redeemed the free student month (edu_perk_redeemed)
 * Falls back to subscriptions.student_verified for accounts with no ledger row.
 * Device fingerprint and signup IP are deliberately not exposed.
 */
export interface StudentInfo {
  status: "pending" | "verified" | "claimed";
  eduEmail?: string; domain?: string; method?: string;
  verifiedAt?: string; claimedAt?: string; startedAt?: string; attempts?: number;
}

function studentInfo(row: StudentRow | undefined, sub: SubRow | undefined): StudentInfo | undefined {
  if (row) {
    return {
      status:     row.edu_perk_redeemed ? "claimed" : row.verified_at ? "verified" : "pending",
      eduEmail:   row.edu_email ?? sub?.student_edu_email ?? undefined,
      domain:     row.email_domain ?? row.edu_email?.split("@")[1] ?? undefined,
      method:     row.verification_method,
      verifiedAt: row.verified_at ?? undefined,
      claimedAt:  row.redeemed_at ?? undefined,
      startedAt:  row.created_at,
      attempts:   row.attempts,
    };
  }
  if (sub?.student_verified) {
    return { status: "verified", eduEmail: sub.student_edu_email ?? undefined, domain: sub.student_edu_email?.split("@")[1], method: "subscription flag" };
  }
  return undefined;
}

export interface PackSummary {
  purchases: number;
  refunded: number;
  spentCents: number;
  balance: Record<string, number>;
  totalCredits: number;
  lastPurchasedAt?: string;
  keys: string[];
}

function summarisePacks(rows: PackRow[]): PackSummary {
  const s: PackSummary = { purchases: 0, refunded: 0, spentCents: 0, balance: {}, totalCredits: 0, keys: [] };
  for (const p of rows) {
    s.purchases++;
    s.keys.push(p.pack_key);
    if (!s.lastPurchasedAt || p.purchased_at > s.lastPurchasedAt) s.lastPurchasedAt = p.purchased_at;
    if (p.refunded_at) { s.refunded++; continue; }
    s.spentCents += p.price_cents ?? 0;
    for (const [k, v] of Object.entries(p.granted ?? {})) {
      const left = Math.max(0, (v ?? 0) - (p.consumed?.[k] ?? 0));
      s.balance[k] = (s.balance[k] ?? 0) + left;
      s.totalCredits += left;
    }
  }
  return s;
}

// ─── Users ────────────────────────────────────────────────────────────────────

export async function loadUsers(sb: SupabaseClient) {
  const today = new Date().toISOString().slice(0, 10);
  const [profiles, subs, counters, packs, metas, sessions, students] = await Promise.all([
    fetchAll<ProfileRow>((a, b) => sb.from("profiles").select("user_id,name,email,provider,is_admin,created_at,updated_at,last_login").range(a, b)),
    fetchAll<SubRow>((a, b) => sb.from("subscriptions").select("*").range(a, b)),
    fetchAll<Row>((a, b) => sb.from("usage_counters").select("*").gte("period_end", today).range(a, b)),
    fetchAll<PackRow>((a, b) => sb.from("credit_packs").select("user_id,pack_key,granted,consumed,price_cents,purchased_at,refunded_at").range(a, b)),
    // erp_user_meta only exists once supabase/erp_schema.sql has been run.
    fetchAll<MetaRow>((a, b) => sb.from("erp_user_meta").select("*").range(a, b)).catch(() => [] as MetaRow[]),
    fetchAll<{ user_id: string; last_seen_at: string }>((a, b) => sb.from("user_sessions").select("user_id,last_seen_at").range(a, b)).catch(() => []),
    fetchAll<StudentRow>((a, b) => sb.from("student_verifications")
      .select("user_id,edu_email,email_domain,verification_method,verified_at,edu_perk_redeemed,redeemed_at,attempts,created_at").range(a, b))
      .catch(() => [] as StudentRow[]),
  ]);
  const studentBy = new Map(students.map(s => [s.user_id, s]));

  const subBy  = new Map(subs.map(s => [s.user_id, s]));
  const metaBy = new Map(metas.map(m => [m.user_id, m]));
  const packsBy = new Map<string, PackRow[]>();
  packs.forEach(p => { const l = packsBy.get(p.user_id) ?? []; l.push(p); packsBy.set(p.user_id, l); });
  const countersBy = new Map<string, Row[]>();
  counters.forEach(c => { const id = c.user_id as string; const l = countersBy.get(id) ?? []; l.push(c); countersBy.set(id, l); });
  const lastSeen = new Map<string, string>();
  sessions.forEach(s => { const cur = lastSeen.get(s.user_id); if (!cur || s.last_seen_at > cur) lastSeen.set(s.user_id, s.last_seen_at); });

  return profiles.map(p => {
    const sub  = subBy.get(p.user_id);
    const meta = metaBy.get(p.user_id);
    const { periodStart, periodEnd } = computeUsagePeriod(pickAnchor(sub?.subscription_started_at, sub?.current_period_start, p.created_at));
    const row  = (countersBy.get(p.user_id) ?? []).find(c => c.period_start === periodStart);
    const usage: Record<string, unknown> = { periodStart, periodEnd, lastUpdated: row?.updated_at ?? undefined };
    for (const [k, col] of Object.entries(USAGE_COLUMNS)) usage[k] = (row?.[col] as number | undefined) ?? 0;

    return {
      id: p.user_id,
      name: p.name ?? undefined,
      email: p.email,
      provider: p.provider ?? "email",
      isAdmin: p.is_admin,
      createdAt: p.created_at,
      updatedAt: p.updated_at,
      lastLogin: p.last_login ?? lastSeen.get(p.user_id),
      lastContactedAt: meta?.last_contacted_at ?? undefined,
      lastContactSubject: meta?.last_contact_subject ?? undefined,
      subscription: {
        plan:                 sub?.plan ?? "free",
        status:               sub?.status ?? "active",
        stripeCustomerId:     sub?.stripe_customer_id ?? undefined,
        stripeSubscriptionId: sub?.stripe_subscription_id ?? undefined,
        currentPeriodStart:   sub?.current_period_start ?? undefined,
        currentPeriodEnd:     sub?.current_period_end ?? undefined,
        subscriptionStartedAt: sub?.subscription_started_at ?? undefined,
        subscriptionEndsAt:   sub?.subscription_ends_at ?? undefined,
        trialEndsAt:          sub?.trial_ends_at ?? undefined,
        canceledAt:           sub?.canceled_at ?? undefined,
        lastPaymentAt:        sub?.last_payment_at ?? undefined,
        studentVerified:      sub?.student_verified ?? false,
        studentEduEmail:      sub?.student_edu_email ?? undefined,
        lastAppliedCoupon:    meta?.last_applied_coupon ?? undefined,
        lastCouponAppliedAt:  meta?.last_coupon_applied_at ?? undefined,
      },
      usage,
      packs: summarisePacks(packsBy.get(p.user_id) ?? []),
      student: studentInfo(studentBy.get(p.user_id), sub),
    };
  });
}

// ─── Writes ───────────────────────────────────────────────────────────────────

/** Camel-case subscription patch → subscriptions columns (unknown keys dropped). */
export function subscriptionPatch(s: Record<string, unknown>): Row {
  const map: Record<string, string> = {
    plan: "plan", status: "status",
    stripeCustomerId: "stripe_customer_id", stripeSubscriptionId: "stripe_subscription_id",
    currentPeriodStart: "current_period_start", currentPeriodEnd: "current_period_end",
    subscriptionEndsAt: "subscription_ends_at", trialEndsAt: "trial_ends_at",
    canceledAt: "canceled_at", lastPaymentAt: "last_payment_at",
    studentVerified: "student_verified", studentEduEmail: "student_edu_email",
  };
  const out: Row = {};
  for (const [k, col] of Object.entries(map)) if (s[k] !== undefined) out[col] = s[k] === "" ? null : s[k];
  return out;
}

export async function upsertSubscription(sb: SupabaseClient, userId: string, patch: Row) {
  if (!Object.keys(patch).length) return;
  const { error } = await sb.from("subscriptions")
    .upsert({ user_id: userId, ...patch, updated_at: new Date().toISOString() }, { onConflict: "user_id" });
  if (error) throw new Error(`subscriptions: ${error.message}`);
}

export async function upsertUserMeta(sb: SupabaseClient, userId: string, patch: Row) {
  const { error } = await sb.from("erp_user_meta")
    .upsert({ user_id: userId, ...patch, updated_at: new Date().toISOString() }, { onConflict: "user_id" });
  if (error) throw new Error(`erp_user_meta: ${error.message} (run supabase/erp_schema.sql)`);
}

/** Overwrite the user's CURRENT-period usage counters. */
export async function writeUsage(sb: SupabaseClient, userId: string, usage: Record<string, unknown>) {
  const cols: Row = {};
  for (const [k, col] of Object.entries(USAGE_COLUMNS)) {
    const v = usage[k];
    if (typeof v === "number" && Number.isFinite(v)) cols[col] = Math.max(0, Math.round(v));
  }
  if (!Object.keys(cols).length) return;
  const [{ data: sub }, { data: prof }] = await Promise.all([
    sb.from("subscriptions").select("subscription_started_at,current_period_start").eq("user_id", userId).maybeSingle(),
    sb.from("profiles").select("created_at").eq("user_id", userId).maybeSingle(),
  ]);
  const { periodStart, periodEnd } = computeUsagePeriod(pickAnchor(sub?.subscription_started_at, sub?.current_period_start, prof?.created_at));
  const { error } = await sb.from("usage_counters").upsert(
    { user_id: userId, period_start: periodStart, period_end: periodEnd, ...cols, updated_at: new Date().toISOString() },
    { onConflict: "user_id,period_start" },
  );
  if (error) throw new Error(`usage_counters: ${error.message}`);
}

/** Resolve display names/emails for a set of user ids. */
export async function profileLookup(sb: SupabaseClient, ids: string[]) {
  const out = new Map<string, { name?: string; email?: string }>();
  // Filtering a uuid column with a non-uuid (e.g. a legacy Firebase uid) errors the whole query.
  const uniq = [...new Set(ids.filter(id => UUID_RE.test(id)))];
  for (let i = 0; i < uniq.length; i += 200) {
    const { data } = await sb.from("profiles").select("user_id,name,email").in("user_id", uniq.slice(i, i + 200));
    (data ?? []).forEach(r => out.set(r.user_id, { name: r.name ?? undefined, email: r.email ?? undefined }));
  }
  return out;
}

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const isoOrNull =(v: unknown) => (typeof v === "string" && v ? new Date(v).toISOString() : null);
