// lib/provider-balances.ts
// Usage → "What's left": remaining credit or free-plan headroom per service.
//
// Three kinds of source, and each card says which one it is:
//   live      the provider reports what is left (Hunter, Twilio)
//   counted   we count our own usage against the plan's limits (Resend from
//             email_sends, Supabase from admin_resource_usage(), RapidAPI from
//             the quota headers the Dashboard stores on each JSearch call)
//   estimate  prepaid credit with no balance API (Claude, OpenAI, Vapi): the
//             balance entered after a top-up, minus the spend the provider
//             reports since then
// Gemini and Upstash report neither, so they only link to their consoles
// (Gemini can still hold a manual balance).
//
// Tables: provider_balances and admin_resource_usage() (Dashboard migration 0054).
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

export type BalanceStatus = "ok" | "low" | "critical" | "unknown";
export type BalanceSource = "live" | "counted" | "estimate" | "manual" | "none";

export interface Meter { label: string; used: number; limit: number; unit?: "bytes" | "count" | "usd" }
export interface ProviderBalance {
  key: string;
  name: string;
  plan: string | null;
  source: BalanceSource;
  status: BalanceStatus;
  /** Prepaid credit: dollars left (estimate), and what it was based on. */
  remainingUsd?: number | null;
  balanceUsd?: number | null;
  spentUsd?: number | null;
  setAt?: string | null;
  lowUsd?: number | null;
  /** Free or plan allowances: one bar each. */
  meters?: Meter[];
  resetsAt?: string | null;
  note?: string;
  error?: string;
  /** Where to top up or upgrade. */
  manageUrl: string;
  /** Whether the admin can enter a balance for it. */
  editable: boolean;
}

/** Providers whose balance the admin can enter. */
export const EDITABLE = ["claude", "openai", "vapi", "gemini"] as const;
export type EditableProvider = (typeof EDITABLE)[number];

const GB = 1024 ** 3;
// Supabase plan quotas. SUPABASE_PLAN=pro switches to the Pro numbers.
const SUPABASE_LIMITS = {
  free: { db: 0.5 * GB, storage: 1 * GB, mau: 50_000 },
  pro:  { db: 8 * GB,   storage: 100 * GB, mau: 100_000 },
};
// Resend free plan: 3,000 a month and 100 a day. Override with
// RESEND_MONTHLY_LIMIT / RESEND_DAILY_LIMIT (0 = no daily cap) on a paid plan.
const num = (v: string | undefined, d: number) => (v && Number.isFinite(Number(v)) ? Number(v) : d);

/** Worst status across meters: under 20% left is low, under 5% critical. */
function meterStatus(meters: Meter[]): BalanceStatus {
  let worst: BalanceStatus = meters.length ? "ok" : "unknown";
  for (const m of meters) {
    if (!(m.limit > 0)) continue;
    const left = 1 - m.used / m.limit;
    if (left < 0.05) return "critical";
    if (left < 0.2) worst = "low";
  }
  return worst;
}
function moneyStatus(remaining: number | null, balance: number | null, low: number | null): BalanceStatus {
  if (remaining == null || balance == null) return "unknown";
  if (remaining <= 0 || remaining < balance * 0.05) return "critical";
  if ((low != null && remaining < low) || remaining < balance * 0.2) return "low";
  return "ok";
}

async function json<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, { ...init, signal: AbortSignal.timeout(15_000), cache: "no-store" });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json() as Promise<T>;
}

// ── Spend since a date ────────────────────────────────────────────────────

/** Anthropic Admin API cost_report. Amounts are in cents (decimal strings). */
export async function claudeSpendSince(since: Date): Promise<number> {
  const key = process.env.ANTHROPIC_ADMIN_KEY;
  if (!key) throw new Error("ANTHROPIC_ADMIN_KEY is not set");
  let cents = 0, page: string | null = null, n = 0;
  do {
    const u = new URL("https://api.anthropic.com/v1/organizations/cost_report");
    u.searchParams.set("starting_at", since.toISOString().slice(0, 19) + "Z");
    u.searchParams.set("ending_at", new Date(Date.now() + 86_400_000).toISOString().slice(0, 10) + "T00:00:00Z");
    u.searchParams.set("bucket_width", "1d");
    u.searchParams.set("limit", "31");
    if (page) u.searchParams.set("page", page);
    const j = await json<{ data?: { results?: { amount?: string }[] }[]; has_more?: boolean; next_page?: string | null }>(u.toString(), {
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01" },
    });
    for (const b of j.data ?? []) for (const r of b.results ?? []) cents += Number(r.amount ?? 0) || 0;
    page = j.has_more ? j.next_page ?? null : null;
  } while (page && ++n < 12);
  return cents / 100;
}

/** OpenAI organization costs (dollars). */
export async function openaiSpendSince(since: Date): Promise<number> {
  const key = process.env.OPENAI_ADMIN_KEY;
  if (!key) throw new Error("OPENAI_ADMIN_KEY is not set");
  let total = 0, page: string | null = null, n = 0;
  do {
    const u = new URL("https://api.openai.com/v1/organization/costs");
    u.searchParams.set("start_time", String(Math.floor(since.getTime() / 1000)));
    u.searchParams.set("bucket_width", "1d");
    u.searchParams.set("limit", "31");
    if (page) u.searchParams.set("page", page);
    const j = await json<{ data?: { results?: { amount?: { value?: number } }[] }[]; has_more?: boolean; next_page?: string | null }>(u.toString(), {
      headers: { Authorization: `Bearer ${key}` },
    });
    for (const b of j.data ?? []) for (const r of b.results ?? []) total += Number(r.amount?.value ?? 0) || 0;
    page = j.has_more ? j.next_page ?? null : null;
  } while (page && ++n < 12);
  return total;
}

/** Vapi: the per-call cost the webhook records (interview_call_costs). */
async function vapiSpendSince(sb: SupabaseClient, since: Date): Promise<number> {
  let total = 0;
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.from("interview_call_costs").select("cost_usd").gte("created_at", since.toISOString()).range(from, from + 999);
    if (error) throw new Error(error.message);
    for (const r of data ?? []) total += Number(r.cost_usd ?? 0) || 0;
    if (!data || data.length < 1000) break;
  }
  return total;
}

// ── Each provider ─────────────────────────────────────────────────────────

interface Row { provider: string; balance_usd: number | null; set_at: string | null; low_usd: number | null; quota: Record<string, number> | null; quota_at: string | null }

async function prepaid(
  key: EditableProvider, name: string, manageUrl: string, row: Row | undefined,
  spend: ((since: Date) => Promise<number>) | null, note?: string,
): Promise<ProviderBalance> {
  const base: ProviderBalance = { key, name, plan: "Prepaid credit", source: "manual", status: "unknown", manageUrl, editable: true, note };
  if (row?.balance_usd == null || !row.set_at) {
    return { ...base, note: note ?? "Enter the balance shown on the provider's billing page to track what is left." };
  }
  const balance = Number(row.balance_usd);
  const low = row.low_usd == null ? null : Number(row.low_usd);
  if (!spend) {
    return { ...base, balanceUsd: balance, remainingUsd: balance, setAt: row.set_at, lowUsd: low, status: moneyStatus(balance, balance, low) };
  }
  try {
    const spent = await spend(new Date(row.set_at));
    const remaining = balance - spent;
    return { ...base, source: "estimate", balanceUsd: balance, spentUsd: spent, remainingUsd: remaining, setAt: row.set_at, lowUsd: low, status: moneyStatus(remaining, balance, low) };
  } catch (e) {
    return { ...base, balanceUsd: balance, setAt: row.set_at, lowUsd: low, error: `Could not read spend: ${(e as Error).message}` };
  }
}

async function hunter(): Promise<ProviderBalance> {
  const base: ProviderBalance = { key: "hunter", name: "Hunter.io", plan: null, source: "live", status: "unknown", manageUrl: "https://hunter.io/pricing", editable: false };
  const k = process.env.HUNTER_API_KEY;
  if (!k) return { ...base, source: "none", error: "HUNTER_API_KEY is not set on the ERP" };
  try {
    type Use = { used?: number; available?: number };
    const j = await json<{ data?: { plan_name?: string; reset_date?: string; requests?: { searches?: Use; verifications?: Use; credits?: Use } } }>(
      `https://api.hunter.io/v2/account?api_key=${encodeURIComponent(k)}`,
    );
    const r = j.data?.requests ?? {};
    // Hunter now bills everything from one credit pool; older accounts only
    // report separate search and verification allowances.
    const meters: Meter[] = r.credits?.available
      ? [{ label: "Credits", used: r.credits.used ?? 0, limit: r.credits.available }]
      : [
          { label: "Searches", used: r.searches?.used ?? 0, limit: r.searches?.available ?? 0 },
          { label: "Verifications", used: r.verifications?.used ?? 0, limit: r.verifications?.available ?? 0 },
        ];
    return { ...base, plan: j.data?.plan_name ?? null, meters, resetsAt: j.data?.reset_date ?? null, status: meterStatus(meters) };
  } catch (e) { return { ...base, error: (e as Error).message }; }
}

async function twilio(): Promise<ProviderBalance | null> {
  const sid = process.env.TWILIO_ACCOUNT_SID, tok = process.env.TWILIO_AUTH_TOKEN;
  if (!sid || !tok) return null; // phone verification not switched on
  const base: ProviderBalance = { key: "twilio", name: "Twilio", plan: null, source: "live", status: "unknown", manageUrl: "https://console.twilio.com/us1/billing/manage-billing/billing-overview", editable: false };
  try {
    const j = await json<{ balance?: string; currency?: string }>(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Balance.json`, {
      headers: { Authorization: `Basic ${Buffer.from(`${sid}:${tok}`).toString("base64")}` },
    });
    const bal = Number(j.balance ?? NaN);
    return { ...base, remainingUsd: bal, status: !Number.isFinite(bal) ? "unknown" : bal < 2 ? "critical" : bal < 10 ? "low" : "ok" };
  } catch (e) { return { ...base, error: (e as Error).message }; }
}

async function resend(sb: SupabaseClient): Promise<ProviderBalance> {
  const monthly = num(process.env.RESEND_MONTHLY_LIMIT, 3000);
  const daily = num(process.env.RESEND_DAILY_LIMIT, 100);
  const base: ProviderBalance = {
    key: "resend", name: "Resend", plan: process.env.RESEND_MONTHLY_LIMIT ? "Paid plan" : "Free plan", source: "counted", status: "unknown",
    manageUrl: "https://resend.com/settings/billing", editable: false,
    note: "Counted from emails the apps logged. Set RESEND_MONTHLY_LIMIT and RESEND_DAILY_LIMIT on the ERP after upgrading.",
  };
  try {
    const now = new Date();
    const month = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const day = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const [m, d] = await Promise.all([
      sb.from("email_sends").select("resend_id", { count: "exact", head: true }).gte("sent_at", month.toISOString()),
      sb.from("email_sends").select("resend_id", { count: "exact", head: true }).gte("sent_at", day.toISOString()),
    ]);
    if (m.error) throw new Error(m.error.message);
    const meters: Meter[] = [{ label: "This month", used: m.count ?? 0, limit: monthly }];
    if (daily > 0) meters.push({ label: "Today (UTC)", used: d.count ?? 0, limit: daily });
    const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
    return { ...base, meters, resetsAt: next.toISOString(), status: meterStatus(meters) };
  } catch (e) { return { ...base, error: (e as Error).message }; }
}

async function supabase(sb: SupabaseClient): Promise<ProviderBalance> {
  const plan = process.env.SUPABASE_PLAN === "pro" ? "pro" : "free";
  const L = SUPABASE_LIMITS[plan];
  const base: ProviderBalance = {
    key: "supabase", name: "Supabase", plan: plan === "pro" ? "Pro plan" : "Free plan", source: "counted", status: "unknown",
    manageUrl: "https://supabase.com/dashboard/org/_/billing", editable: false,
    note: plan === "free" ? "Free projects pause after a week with no activity. Set SUPABASE_PLAN=pro on the ERP after upgrading." : undefined,
  };
  try {
    const { data, error } = await sb.rpc("admin_resource_usage");
    if (error) throw new Error(error.message.includes("admin_resource_usage") ? "Run Dashboard migration 0054 first" : error.message);
    const u = data as { db_bytes: number; storage_bytes: number; mau: number };
    const meters: Meter[] = [
      { label: "Database", used: Number(u.db_bytes), limit: L.db, unit: "bytes" },
      { label: "File storage", used: Number(u.storage_bytes), limit: L.storage, unit: "bytes" },
      { label: "Monthly active users", used: Number(u.mau), limit: L.mau },
    ];
    return { ...base, meters, status: meterStatus(meters) };
  } catch (e) { return { ...base, error: (e as Error).message }; }
}

function rapidapi(row: Row | undefined): ProviderBalance {
  const base: ProviderBalance = {
    key: "rapidapi", name: "JSearch (RapidAPI)", plan: null, source: "counted", status: "unknown",
    manageUrl: "https://rapidapi.com/letscrape-6bRBa3QguO5/api/jsearch/pricing", editable: false,
  };
  const q = row?.quota;
  if (!q || !(q.limit > 0)) return { ...base, note: "Shows up after the next job recommendation search, which reports the plan's quota." };
  const meters: Meter[] = [{ label: "Requests", used: Math.max(0, q.limit - (q.remaining ?? 0)), limit: q.limit }];
  const resetsAt = row?.quota_at && q.resetSeconds ? new Date(new Date(row.quota_at).getTime() + q.resetSeconds * 1000).toISOString() : null;
  return { ...base, meters, resetsAt, status: meterStatus(meters), note: `As of ${row?.quota_at ? new Date(row.quota_at).toLocaleString("en-US") : "the last search"}.` };
}

// ── All of them ───────────────────────────────────────────────────────────

export async function providerBalances(sb: SupabaseClient): Promise<{ providers: ProviderBalance[]; tableMissing: boolean }> {
  const { data, error } = await sb.from("provider_balances").select("provider,balance_usd,set_at,low_usd,quota,quota_at");
  const tableMissing = !!error;
  const rows = new Map(((data ?? []) as Row[]).map(r => [r.provider, r]));

  const list = await Promise.all([
    prepaid("claude", "Claude (Anthropic)", "https://console.anthropic.com/settings/billing", rows.get("claude"), claudeSpendSince),
    prepaid("openai", "OpenAI", "https://platform.openai.com/settings/organization/billing/overview", rows.get("openai"), openaiSpendSince),
    prepaid("vapi", "Vapi (voice interviews)", "https://dashboard.vapi.ai/org/billing", rows.get("vapi"), since => vapiSpendSince(sb, since)),
    prepaid("gemini", "Gemini", "https://aistudio.google.com/usage", rows.get("gemini"), null,
      "Google has no usage API. On the free tier the limits are per minute and per day; check AI Studio. If you prepay, enter the balance here."),
    hunter(),
    rapidapi(rows.get("rapidapi")),
    resend(sb),
    supabase(sb),
    twilio(),
    Promise.resolve<ProviderBalance>({
      key: "upstash", name: "Upstash Redis", plan: null, source: "none", status: "unknown", editable: false,
      manageUrl: "https://console.upstash.com/redis", note: "Upstash needs a separate management key to report usage. Check the console.",
    }),
  ]);
  return { providers: list.filter((p): p is ProviderBalance => !!p), tableMissing };
}
