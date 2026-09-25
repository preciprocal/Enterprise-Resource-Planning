// app/api/admin/route.ts
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";

import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { getAdmin, requireAdmin, envAllowedEmails, normaliseEmail } from "@/lib/admin-auth";
import {
  loadUsers, fetchAll, profileLookup, subscriptionPatch, upsertSubscription,
  upsertUserMeta, writeUsage, UUID_RE,
} from "@/lib/erp-data";
import { PACKS, PACK_KEYS, packEnvVar } from "@/lib/packs";

// ─── UA Parser (no deps) ─────────────────────────────────────────────────────

function parseUA(ua: string): { browser: string; os: string; device: string } {
  if (!ua) return { browser: "Unknown", os: "Unknown", device: "desktop" };
  const u = ua.toLowerCase();

  let browser = "Unknown";
  if (u.includes("edg/") || u.includes("edge/"))      browser = "Edge";
  else if (u.includes("opr/") || u.includes("opera"))  browser = "Opera";
  else if (u.includes("chrome") && !u.includes("chromium")) browser = "Chrome";
  else if (u.includes("chromium"))                     browser = "Chromium";
  else if (u.includes("firefox") || u.includes("fxios")) browser = "Firefox";
  else if (u.includes("safari") && !u.includes("chrome")) browser = "Safari";
  else if (u.includes("samsungbrowser"))               browser = "Samsung";
  else if (u.includes("ucbrowser"))                    browser = "UC Browser";

  let os = "Unknown";
  if (u.includes("windows nt 10"))      os = "Windows 10";
  else if (u.includes("windows nt 11") || (u.includes("windows nt 10.0") && u.includes("rv:11"))) os = "Windows 11";
  else if (u.includes("windows"))       os = "Windows";
  else if (u.includes("iphone os 17") || u.includes("iphone os 16")) os = `iOS ${u.includes("17") ? "17" : "16"}`;
  else if (u.includes("iphone"))        os = "iOS";
  else if (u.includes("ipad"))          os = "iPadOS";
  else if (u.includes("mac os x 14") || u.includes("mac os x 15")) os = "macOS Sonoma";
  else if (u.includes("mac os x"))      os = "macOS";
  else if (u.includes("android 14"))    os = "Android 14";
  else if (u.includes("android 13"))    os = "Android 13";
  else if (u.includes("android"))       os = "Android";
  else if (u.includes("linux"))         os = "Linux";
  else if (u.includes("cros"))          os = "ChromeOS";

  let device = "desktop";
  if (u.includes("mobile") || u.includes("iphone") || (u.includes("android") && !u.includes("tablet"))) device = "mobile";
  else if (u.includes("tablet") || u.includes("ipad")) device = "tablet";

  return { browser, os, device };
}

async function getGeoFromIP(ip: string): Promise<{ city?: string; country?: string; countryCode?: string }> {
  if (!ip || ip === "unknown" || ip.startsWith("127.") || ip.startsWith("::1") || ip.startsWith("10.") || ip.startsWith("192.168.")) return {};
  try {
    const res  = await fetch(`https://ip-api.com/json/${ip}?fields=country,countryCode,city`, { signal: AbortSignal.timeout(2000) });
    if (!res.ok) return {};
    const data = await res.json() as { country?: string; countryCode?: string; city?: string };
    return { city: data.city, country: data.country, countryCode: data.countryCode };
  } catch { return {}; }
}

// ─── Supabase ─────────────────────────────────────────────────────────────────

const sb = () => getSupabaseAdmin();

/** Stripe customer ids belonging to admins — excluded from revenue figures. */
async function adminCustomerIds(): Promise<Set<string>> {
  const { data: admins } = await sb().from("profiles").select("user_id").eq("is_admin", true);
  const ids = (admins ?? []).map(a => a.user_id as string);
  if (!ids.length) return new Set();
  const { data: subs } = await sb().from("subscriptions").select("stripe_customer_id").in("user_id", ids);
  return new Set((subs ?? []).map(s => s.stripe_customer_id as string | null).filter((v): v is string => !!v));
}

const iso = (v: unknown) => (v ? new Date(v as string).toISOString() : null);

// ─── Stripe ───────────────────────────────────────────────────────────────────

function getStripe() {
  return new Stripe(process.env.STRIPE_SECRET_KEY ?? "", {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    apiVersion: "2024-04-10" as any,
  });
}

// ─── GET ──────────────────────────────────────────────────────────────────────

// ── OpenAI paginated costs fetcher (module scope — used by usage + usage_openai) ─
async function fetchOAICosts(
  startTs: number, endTs: number, headers: Record<string, string>
): Promise<{ total: number; daily: Record<string, number> }> {
  let total = 0;
  const daily: Record<string, number> = {};
  let nextPage: string | null = null;
  let pages = 0;
  do {
    const url = new URL("https://api.openai.com/v1/organization/costs");
    url.searchParams.set("start_time",   String(startTs));
    url.searchParams.set("end_time",     String(endTs));
    url.searchParams.set("bucket_width", "1d");
    url.searchParams.set("limit",        "31");
    if (nextPage) url.searchParams.set("page", nextPage);
    const res = await fetch(url.toString(), { headers });
    if (!res.ok) {
      console.error("[openai/costs] HTTP", res.status, await res.text().then(t => t.slice(0, 200)));
      break;
    }
    interface OAICostResult { amount?: { value?: number; currency?: string } }
    interface OAICostBucket { start_time?: number; results?: OAICostResult[] }
    interface OAICostPage   { data?: OAICostBucket[]; has_more?: boolean; next_page?: string | null }
    const json = await res.json() as OAICostPage;
    console.log(`[openai/costs] page=${pages + 1} buckets=${json.data?.length ?? 0} has_more=${json.has_more}`);
    (json.data ?? []).forEach(b => {
      const day = b.start_time
        ? new Date(b.start_time * 1000).toISOString().slice(0, 10)
        : new Date(startTs     * 1000).toISOString().slice(0, 10);
      (b.results ?? []).forEach(r => {
        // amount.value is typed as number in the interface — safe to use directly
        const val: number = (r.amount?.value != null && typeof r.amount.value === "number")
          ? r.amount.value
          : 0;
        total        += val;
        daily[day]    = (daily[day] ?? 0) + val;
      });
    });
    nextPage = json.next_page ?? null;
    pages++;
  } while (nextPage && pages < 5);
  console.log(`[openai/costs] done total=$${total.toFixed(4)} pages=${pages}`);
  return { total, daily };
}

export async function GET(req: NextRequest) {
  const action = req.nextUrl.searchParams.get("action") ?? "users";

  // ── verify ────────────────────────────────────────────────────────────────
  if (action === "verify") {
    const admin = await getAdmin(req);
    if (!admin) {
      console.log("[verify] DENIED");
      return NextResponse.json({ error: "Not an admin" }, { status: 403 });
    }
    // Only log real sign-ins (login=1), not every page load with a stored session
    if (req.nextUrl.searchParams.get("login") === "1") void (async () => {
      try {
        const ua     = req.headers.get("user-agent") ?? "";
        const ip     = (req.headers.get("x-forwarded-for") ?? req.headers.get("x-real-ip") ?? "unknown").split(",")[0].trim();
        const parsed = parseUA(ua);
        const geo    = await getGeoFromIP(ip);
        await sb().from("erp_logs").insert({
          user_id: admin.userId, user_name: admin.name, user_email: admin.email,
          type: "login", ip, user_agent: ua,
          browser: parsed.browser, os: parsed.os, device: parsed.device,
          city: geo.city ?? "", country: geo.country ?? "", country_code: geo.countryCode ?? "",
          details: { source: "admin_erp" },
        });
      } catch (e) { console.error("[verify] log write failed:", e); }
    })();

    return NextResponse.json({ ok: true, uid: admin.userId, email: admin.email, name: admin.name });
  }

  const _authErr = await requireAdmin(req); if (_authErr) return _authErr;

  // ── users ─────────────────────────────────────────────────────────────────
  if (action === "users") {
    try {
      const users = await loadUsers(sb());
      return NextResponse.json({ users }, { headers: { "Cache-Control": "private, no-store" } });
    } catch (err) {
      return NextResponse.json({ error: (err as Error).message }, { status: 500 });
    }
  }

  // ── analytics ─────────────────────────────────────────────────────────────
  if (action === "analytics") {
    try {
      const db = sb();
      const [interviews, feedbacks, resumes, plans] = await Promise.all([
        db.from("interviews").select("id,user_id,role,type,techstack,company,status,finalized,created_at,level,duration")
          .order("created_at", { ascending: false }).limit(1000),
        db.from("interview_feedback").select("id,user_id,interview_id,total_score,category_scores,created_at")
          .order("created_at", { ascending: false }).limit(1000),
        db.from("resumes").select("id,user_id,job_title,company_name,status,score,created_at").eq("deleted", false)
          .order("created_at", { ascending: false }).limit(1000),
        db.from("interview_plans").select("id,user_id,archived,created_at")
          .order("created_at", { ascending: false }).limit(500),
      ]);
      const err = interviews.error ?? feedbacks.error ?? resumes.error ?? plans.error;
      if (err) throw new Error(err.message);

      // Keep the camelCase field names the Analytics tab was written against.
      return NextResponse.json({
        interviews: (interviews.data ?? []).map(r => ({
          id: r.id, userId: r.user_id, role: r.role, type: r.type, techstack: r.techstack, company: r.company,
          status: r.status, finalized: r.finalized, createdAt: r.created_at, level: r.level, duration: r.duration,
        })),
        feedbacks: (feedbacks.data ?? []).map(r => ({
          id: r.id, userId: r.user_id, interviewId: r.interview_id, totalScore: r.total_score,
          categoryScores: r.category_scores, createdAt: r.created_at,
        })),
        resumes: (resumes.data ?? []).map(r => ({
          id: r.id, userId: r.user_id, jobTitle: r.job_title, companyName: r.company_name,
          status: r.status, score: r.score, createdAt: r.created_at,
        })),
        plans: (plans.data ?? []).map(r => ({
          id: r.id, userId: r.user_id, status: r.archived ? "archived" : "active", createdAt: r.created_at,
        })),
      }, { headers: { "Cache-Control": "private, max-age=60" } });
    } catch (err) {
      return NextResponse.json({ error: (err as Error).message }, { status: 500 });
    }
  }

  // ── access_list — who can sign in to the ERP ────────────────────────────────
  if (action === "access_list") {
    try {
      const env = envAllowedEmails();
      // Mirror env entries into the table so the DB-side erp_is_admin() (used by
      // the realtime support policies) sees the same list the API enforces.
      if (env.size) {
        await sb().from("erp_allowed_emails")
          .upsert([...env].map(email => ({ email, added_by: "env", note: "ERP_ALLOWED_EMAILS" })), { onConflict: "email", ignoreDuplicates: true })
          .then(r => r, () => null);
      }
      const { data, error } = await sb().from("erp_allowed_emails").select("email,note,added_by,created_at").order("created_at");
      const tableMissing = !!error;
      const rows = new Map<string, { email: string; note: string | null; addedBy: string | null; createdAt: string | null }>();
      env.forEach(email => rows.set(email, { email, note: "ERP_ALLOWED_EMAILS", addedBy: "env", createdAt: null }));
      (data ?? []).forEach(r => {
        const prev = rows.get(r.email as string);
        rows.set(r.email as string, { email: r.email as string, note: (r.note as string | null) ?? prev?.note ?? null, addedBy: r.added_by as string | null, createdAt: r.created_at as string });
      });
      const emails = [...rows.keys()];
      const { data: profs } = emails.length
        ? await sb().from("profiles").select("email,name").in("email", emails)
        : { data: [] };
      const nameBy = new Map((profs ?? []).map(p => [String(p.email).toLowerCase(), p.name as string | null]));
      const me = (await getAdmin(req))?.email?.toLowerCase() ?? "";
      const list = [...rows.values()].map(r => ({
        ...r,
        locked:     env.has(r.email),
        isYou:      r.email === me,
        hasAccount: nameBy.has(r.email),
        name:       nameBy.get(r.email) ?? undefined,
      }));
      return NextResponse.json({ list, tableMissing, tableError: error?.message }, { headers: { "Cache-Control": "private, no-store" } });
    } catch (err) {
      return NextResponse.json({ error: (err as Error).message }, { status: 500 });
    }
  }

  // ── packs — catalog, configured price IDs, and sales from credit_packs ──────
  if (action === "packs") {
    try {
      const rows = await fetchAll<{ user_id: string; pack_key: string; price_cents: number; purchased_at: string; refunded_at: string | null; granted: Record<string, number>; consumed: Record<string, number> }>(
        (a, b) => sb().from("credit_packs").select("user_id,pack_key,price_cents,purchased_at,refunded_at,granted,consumed")
          .order("purchased_at", { ascending: false }).range(a, b),
      );
      const names = await profileLookup(sb(), rows.slice(0, 50).map(r => r.user_id));
      const packs = PACK_KEYS.map(key => {
        const mine = rows.filter(r => r.pack_key === key);
        const live = mine.filter(r => !r.refunded_at);
        return {
          ...PACKS[key],
          envVar:    packEnvVar(key),
          priceId:   process.env[packEnvVar(key)] ?? null,
          sold:      mine.length,
          refunded:  mine.length - live.length,
          revenueCents: live.reduce((s, r) => s + (r.price_cents ?? 0), 0),
          buyers:    new Set(live.map(r => r.user_id)).size,
        };
      });
      const recent = rows.slice(0, 50).map(r => ({
        userId: r.user_id, userName: names.get(r.user_id)?.name, userEmail: names.get(r.user_id)?.email,
        packKey: r.pack_key, packName: PACKS[r.pack_key as keyof typeof PACKS]?.name ?? r.pack_key,
        priceCents: r.price_cents, purchasedAt: r.purchased_at, refundedAt: r.refunded_at,
        granted: r.granted, consumed: r.consumed,
      }));
      return NextResponse.json({
        packs, recent,
        checkoutEnabled: process.env.PACKS_CHECKOUT_ENABLED === "true",
        totals: {
          sold: rows.length,
          revenueCents: rows.filter(r => !r.refunded_at).reduce((s, r) => s + (r.price_cents ?? 0), 0),
          buyers: new Set(rows.filter(r => !r.refunded_at).map(r => r.user_id)).size,
        },
      }, { headers: { "Cache-Control": "private, no-store" } });
    } catch (err) {
      return NextResponse.json({ error: (err as Error).message }, { status: 500 });
    }
  }

  // ── debug_claude — dumps raw Anthropic API responses for troubleshooting ──
  if (action === "debug_claude") {
    const anthropicAdminKey = process.env.ANTHROPIC_ADMIN_KEY;
    const anthropicStdKey   = process.env.ANTHROPIC_API_KEY;
    if (!anthropicAdminKey && !anthropicStdKey) {
      return NextResponse.json({ error: "No Anthropic key set" }, { status: 400 });
    }
    const ADMIN_HEADERS = anthropicAdminKey
      ? { "x-api-key": anthropicAdminKey, "anthropic-version": "2023-06-01" }
      : null;
    const STD_HEADERS = anthropicStdKey
      ? { "x-api-key": anthropicStdKey, "anthropic-version": "2023-06-01" }
      : null;

    const now       = new Date();
    const startDate = new Date(now.getFullYear(), now.getMonth(), 1);
    const startIso  = startDate.toISOString().slice(0, 19) + "Z";
    const endIso    = now.toISOString().slice(0, 19) + "Z";
    const debug: Record<string, unknown> = {
      has_admin_key: !!anthropicAdminKey,
      has_std_key:   !!anthropicStdKey,
      admin_key_prefix: anthropicAdminKey?.slice(0, 20),
      std_key_prefix:   anthropicStdKey?.slice(0, 20),
      period: `${startIso} → ${endIso}`,
    };

    // 1. Models (std key)
    if (STD_HEADERS) {
      try {
        const r = await fetch("https://api.anthropic.com/v1/models?limit=5", { headers: STD_HEADERS });
        const j = await r.json();
        debug.models_status = r.status;
        debug.models_raw    = j;
      } catch (e) { debug.models_error = String(e); }
    }

    if (ADMIN_HEADERS) {
      // 2. Usage report (raw — first 2 buckets only)
      try {
        const r = await fetch(
          `https://api.anthropic.com/v1/organizations/usage_report/messages?starting_at=${startIso}&ending_at=${endIso}&bucket_width=1d&limit=5&group_by[]=model`,
          { headers: ADMIN_HEADERS }
        );
        const text = await r.text();
        debug.usage_report_status = r.status;
        try { debug.usage_report_raw = JSON.parse(text); } catch { debug.usage_report_raw = text.slice(0, 500); }
      } catch (e) { debug.usage_report_error = String(e); }

      // 3. Cost report (raw — ALL buckets, full amounts)
      try {
        const r = await fetch(
          `https://api.anthropic.com/v1/organizations/cost_report?starting_at=${startIso}&ending_at=${endIso}&bucket_width=1d&limit=31`,
          { headers: ADMIN_HEADERS }
        );
        const text = await r.text();
        debug.cost_report_status = r.status;
        try {
          const j = JSON.parse(text) as { data?: { starting_at?: string; results?: { amount?: unknown; currency?: string; model?: string }[] }[] };
          debug.cost_report_raw = j;
          debug.cost_report_bucket_count = j.data?.length ?? 0;
          debug.cost_report_first_bucket = j.data?.[0];
          // Show ALL field keys from first result row so we know exact shape
          debug.cost_report_first_result_keys = Object.keys(j.data?.[0]?.results?.[0] ?? {});
          debug.cost_report_first_result_raw  = j.data?.[0]?.results?.[0];
          // Try every known amount field
          let total = 0;
          (j.data ?? []).forEach(bucket => {
            (bucket.results ?? []).forEach((r2: Record<string, unknown>) => {
              const raw = r2.amount ?? r2.cost ?? r2.total_cost ?? 0;
              const val = typeof raw === "object" && raw !== null && "value" in raw
                ? Number((raw as {value:unknown}).value)
                : parseFloat(String(raw ?? "0"));
              if (!isNaN(val)) total += val;
            });
          });
          debug.cost_report_computed_total = total;
        } catch { debug.cost_report_raw = text.slice(0, 1000); }
      } catch (e) { debug.cost_report_error = String(e); }

      // 4. Billing / credit balance
      try {
        const r = await fetch("https://api.anthropic.com/v1/organizations/billing", { headers: ADMIN_HEADERS });
        const text = await r.text();
        debug.billing_status = r.status;
        try { debug.billing_raw = JSON.parse(text); } catch { debug.billing_raw = text.slice(0, 500); }
      } catch (e) { debug.billing_error = String(e); }

      // 5. Credit grants
      try {
        const r = await fetch("https://api.anthropic.com/v1/organizations/billing/credit_grants", { headers: ADMIN_HEADERS });
        const text = await r.text();
        debug.credit_grants_status = r.status;
        try { debug.credit_grants_raw = JSON.parse(text); } catch { debug.credit_grants_raw = text.slice(0, 500); }
      } catch (e) { debug.credit_grants_error = String(e); }
    }

    return NextResponse.json(debug, { headers: { "Cache-Control": "no-store" } });
  }

  // ── usage ─────────────────────────────────────────────────────────────────
  if (action === "usage") {
    type UsageCache = { data: Record<string, unknown>; ts: number };
    // No globalThis cache — always fetch fresh so cost data is never stale
    const USAGE_CACHE = new Map<string, UsageCache>();
    const CACHE_TTL_MS = 5 * 60 * 1000;
    const claudeMonthKey = req.nextUrl.searchParams.get("claudeMonth") ?? "current";
    const openaiMonthKey  = req.nextUrl.searchParams.get("openaiMonth")  ?? "current";
    const cacheKey = `claude:${claudeMonthKey}|openai:${openaiMonthKey}`;
    const forceRefresh = req.nextUrl.searchParams.get("refresh") === "1";
    const cached = USAGE_CACHE.get(cacheKey);
    if (!forceRefresh && cached && Date.now() - cached.ts < CACHE_TTL_MS) {
      return NextResponse.json(
        { ...cached.data, fromCache: true, cachedAt: new Date(cached.ts).toISOString() },
        { headers: { "Cache-Control": "private, max-age=300", "X-Cache": "HIT" } }
      );
    }

    const errors: Record<string, string> = {};

    async function safeGet<T>(key: string, fn: () => Promise<T>): Promise<T | null> {
      try { return await fn(); }
      catch (e) { errors[key] = (e as Error).message; console.error(`[usage/${key}]`, (e as Error).message); return null; }
    }

    // ── Claude (Anthropic) ──────────────────────────────────────────────────
    const anthropicAdminKey = process.env.ANTHROPIC_ADMIN_KEY;
    const anthropicStdKey   = process.env.ANTHROPIC_API_KEY;
    const claudeMonthParam  = req.nextUrl.searchParams.get("claudeMonth");

    const claudeData = await safeGet("claude", async () => {
      if (!anthropicAdminKey && !anthropicStdKey) throw new Error("Set ANTHROPIC_API_KEY or ANTHROPIC_ADMIN_KEY in .env");

      const ADMIN_HEADERS = anthropicAdminKey ? { "x-api-key": anthropicAdminKey, "anthropic-version": "2023-06-01" } : null;
      const STD_HEADERS   = anthropicStdKey   ? { "x-api-key": anthropicStdKey,   "anthropic-version": "2023-06-01" } : null;

      type AnthropicModel = { id: string; display_name?: string };
      let availableModels: string[] = [];
      if (STD_HEADERS) {
        const modelsRes = await fetch("https://api.anthropic.com/v1/models?limit=20", { headers: STD_HEADERS });
        if (modelsRes.ok) {
          const modelsJson = await modelsRes.json() as { data?: AnthropicModel[] };
          availableModels = (modelsJson.data ?? []).map((m: AnthropicModel) => m.id);
        }
      }
      if (availableModels.length === 0) {
        availableModels = ["claude-sonnet-4-6","claude-opus-4-20250514","claude-sonnet-4-20250514","claude-haiku-4-5-20251001","claude-3-5-sonnet-20241022","claude-3-haiku-20240307"];
      }

      const now = new Date();
      let startDate: Date, endDate: Date;
      if (claudeMonthParam && /^\d{4}-\d{2}$/.test(claudeMonthParam)) {
        const [y, m] = claudeMonthParam.split("-").map(Number);
        startDate = new Date(y, m - 1, 1);
        endDate   = new Date(y, m, 0, 23, 59, 59);
      } else {
        startDate = new Date(now.getFullYear(), now.getMonth(), 1);
        endDate   = now;
      }
      const startStr = startDate.toISOString().slice(0, 10);
      const endStr   = endDate.toISOString().slice(0, 10);
      const startIso = startDate.toISOString().slice(0, 19) + "Z";
      const endIso   = endDate.toISOString().slice(0, 19) + "Z";

      // ── Pricing per 1M tokens (USD) ──────────────────────────────────────
      const INPUT_PRICE: Record<string, number> = {
        "claude-opus-4-5": 15,   "claude-opus-4-20250514": 15,
        "claude-sonnet-4-5": 3,  "claude-sonnet-4-20250514": 3, "claude-sonnet-4-6": 3,
        "claude-haiku-4-5": 0.8, "claude-haiku-4-5-20251001": 0.8,
        "claude-3-opus-20240229": 15, "claude-3-5-sonnet-20241022": 3,
        "claude-3-5-haiku-20241022": 0.8, "claude-3-haiku-20240307": 0.25,
      };
      const OUTPUT_PRICE: Record<string, number> = {
        "claude-opus-4-5": 75,   "claude-opus-4-20250514": 75,
        "claude-sonnet-4-5": 15, "claude-sonnet-4-20250514": 15, "claude-sonnet-4-6": 15,
        "claude-haiku-4-5": 4,   "claude-haiku-4-5-20251001": 4,
        "claude-3-opus-20240229": 75, "claude-3-5-sonnet-20241022": 15,
        "claude-3-5-haiku-20241022": 4, "claude-3-haiku-20240307": 1.25,
      };

      let totalInput = 0, totalOutput = 0, totalReqs = 0, totalCost = 0;
      const modelMap:      Record<string, { tokens: number; requests: number; cost: number }> = {};
      const dailyMap:      Record<string, { tokens: number; requests: number; cost: number }> = {};
      const modelDailyMap: Record<string, Record<string, { tokens: number; requests: number; cost: number }>> = {};
      let creditBalance: number | null = null;
      let dataSource: "admin_api" | "none" = "none";

      if (anthropicAdminKey && ADMIN_HEADERS) {
        // ── Path A: Anthropic Admin API ─────────────────────────────────────
        type UsageResult = {
          model?: string;
          input_tokens?: number; output_tokens?: number;
          cache_creation_input_tokens?: number; cache_read_input_tokens?: number;
          uncached_input_tokens?: number; cached_input_tokens?: number;
          request_count?: number;
        };
        type UsageBucket = {
          starting_at?: string; ending_at?: string; results?: UsageResult[];
          model?: string; input_tokens?: number; output_tokens?: number; request_count?: number;
        };

        const [usageByModelRes, usageDailyRes] = await Promise.all([
          fetch(`https://api.anthropic.com/v1/organizations/usage_report/messages?starting_at=${startIso}&ending_at=${endIso}&bucket_width=1d&limit=31&group_by[]=model`, { headers: ADMIN_HEADERS }),
          fetch(`https://api.anthropic.com/v1/organizations/usage_report/messages?starting_at=${startIso}&ending_at=${endIso}&bucket_width=1d&limit=31`, { headers: ADMIN_HEADERS }),
        ]);

        // ── FIXED: price each token type correctly ──────────────────────────
        // Cache reads = 10% of input price, cache writes = 125% of input price
        const processResult = (r: UsageResult, model: string) => {
          const uncachedInp   = (r.input_tokens ?? 0) + (r.uncached_input_tokens ?? 0);
          const cacheReadInp  = r.cache_read_input_tokens    ?? 0;
          const cacheWriteInp = r.cache_creation_input_tokens ?? 0;
          const out           = r.output_tokens ?? 0;
          const rq            = r.request_count ?? 1;
          // Total for display
          const inp = uncachedInp + cacheReadInp + cacheWriteInp;

          const inP  = INPUT_PRICE[model]  ?? 3;
          const outP = OUTPUT_PRICE[model] ?? 15;
          // Cache read tokens are 10× cheaper; cache write tokens are 25% more expensive
          const cost = (
            uncachedInp   * inP           +
            cacheReadInp  * (inP * 0.10)  +
            cacheWriteInp * (inP * 1.25)  +
            out           * outP
          ) / 1_000_000;

          return { inp, out, rq, cost };
        };

        if (usageByModelRes.ok) {
          const uj = await usageByModelRes.json() as { data?: UsageBucket[] };
          console.log("[claude/usage_by_model] buckets:", uj.data?.length, "first:", JSON.stringify(uj.data?.[0])?.slice(0, 300));
          (uj.data ?? []).forEach(bucket => {
            const day = (bucket.starting_at ?? startStr).slice(0, 10);
            const results: UsageResult[] = bucket.results?.length
              ? bucket.results
              : (bucket.model ? [bucket as UsageResult] : []);
            results.forEach(r => {
              const model = r.model;
              if (!model) return;
              const { inp, out, rq, cost } = processResult(r, model);
              totalInput += inp; totalOutput += out; totalReqs += rq; totalCost += cost;
              if (!modelMap[model]) modelMap[model] = { tokens: 0, requests: 0, cost: 0 };
              modelMap[model].tokens += inp + out; modelMap[model].requests += rq; modelMap[model].cost += cost;
              if (!modelDailyMap[model]) modelDailyMap[model] = {};
              if (!modelDailyMap[model][day]) modelDailyMap[model][day] = { tokens: 0, requests: 0, cost: 0 };
              modelDailyMap[model][day].tokens += inp + out; modelDailyMap[model][day].requests += rq; modelDailyMap[model][day].cost += cost;
            });
          });
          dataSource = "admin_api";
        } else {
          console.error("[claude/usage_by_model]", usageByModelRes.status, await usageByModelRes.text().then(t => t.slice(0, 300)));
          dataSource = "admin_api";
        }

        if (usageDailyRes.ok) {
          const uj = await usageDailyRes.json() as { data?: UsageBucket[] };
          console.log("[claude/usage_daily] buckets:", uj.data?.length);
          (uj.data ?? []).forEach(bucket => {
            const day = (bucket.starting_at ?? startStr).slice(0, 10);
            const results: UsageResult[] = bucket.results?.length ? bucket.results : [bucket as UsageResult];
            results.forEach(r => {
              const uncachedInp   = (r.input_tokens ?? 0) + (r.uncached_input_tokens ?? 0);
              const cacheReadInp  = r.cache_read_input_tokens    ?? 0;
              const cacheWriteInp = r.cache_creation_input_tokens ?? 0;
              const out           = r.output_tokens ?? 0;
              const rq            = r.request_count ?? 1;
              const inp           = uncachedInp + cacheReadInp + cacheWriteInp;
              if (inp + out + rq === 0) return;
              if (!dailyMap[day]) dailyMap[day] = { tokens: 0, requests: 0, cost: 0 };
              dailyMap[day].tokens   += inp + out;
              dailyMap[day].requests += rq;
            });
          });
        }

        if (totalInput === 0 && totalOutput === 0) {
          Object.values(dailyMap).forEach(d => {
            totalInput  += Math.round(d.tokens * 0.6);
            totalOutput += Math.round(d.tokens * 0.4);
            totalReqs   += d.requests;
          });
        }

        // ── Cost report — filter strictly to the requested date window ──────
        // The cost_report API sometimes ignores date params and returns all-time
        // totals. We guard against this by:
        //   1. Only summing buckets whose starting_at falls within our window
        //   2. Sanity-checking: if cost_report > token-estimate * 3, discard it
        const costRes = await fetch(
          `https://api.anthropic.com/v1/organizations/cost_report?starting_at=${startIso}&ending_at=${endIso}&bucket_width=1d&limit=31`,
          { headers: ADMIN_HEADERS }
        );
        if (costRes.ok) {
          type CostResult = { currency?: string; amount?: string | number; model?: string };
          type CostBucket = { starting_at?: string; ending_at?: string; results?: CostResult[] };
          const cj = await costRes.json() as { data?: CostBucket[] };
          let billedTotal = 0;
          let bucketsInWindow = 0;
          let bucketsTotal = 0;

          const windowStart = startDate.getTime();
          const windowEnd   = endDate.getTime();

          (cj.data ?? []).forEach(bucket => {
            bucketsTotal++;
            const bucketTs = bucket.starting_at ? new Date(bucket.starting_at).getTime() : windowStart;
            if (bucketTs < windowStart - 86_400_000 || bucketTs > windowEnd + 86_400_000) {
              console.log("[claude/cost_report] skipping out-of-window bucket:", bucket.starting_at);
              return;
            }
            bucketsInWindow++;
            (bucket.results ?? []).forEach((r: Record<string, unknown>) => {
              // Anthropic has shipped the amount in multiple shapes across API versions:
              //   { amount: "1.23" }           — string dollars
              //   { amount: { value: 1.23 } }  — nested object
              //   { cost: 1.23 }               — alternate field name
              //   { total_cost: "1.23" }       — another variant
              const raw =
                r.amount !== undefined ? r.amount :
                r.cost    !== undefined ? r.cost    :
                r.total_cost !== undefined ? r.total_cost : 0;
              const val = typeof raw === "object" && raw !== null && "value" in raw
                ? Number((raw as { value: unknown }).value)
                : parseFloat(String(raw ?? "0"));
              if (!isNaN(val)) billedTotal += val;
              console.log("[claude/cost_report] row:", JSON.stringify(r), "→ parsed:", val);
            });
          });

          console.log(`[claude/cost_report] buckets total=${bucketsTotal} in-window=${bucketsInWindow} sum=$${billedTotal}`);

          // Sanity check: token-based estimate as upper bound
          // If cost_report returns > 10× the token estimate, it's returning
          // cumulative data — discard it and fall back to the token estimate
          const tokenEstimate = totalCost; // already computed by processResult
          const sanityMultiplier = 10;
          if (billedTotal > 0 && (tokenEstimate === 0 || billedTotal < tokenEstimate * sanityMultiplier)) {
            totalCost = billedTotal;
            console.log("[claude/cost_report] accepted real billed total:", billedTotal);
          } else if (billedTotal > tokenEstimate * sanityMultiplier) {
            console.warn(`[claude/cost_report] DISCARDED — $${billedTotal} is >${sanityMultiplier}× token estimate $${tokenEstimate}. API likely returning cumulative data.`);
            // Keep token estimate (totalCost unchanged)
          } else if (billedTotal === 0 && bucketsInWindow > 0) {
            totalCost = 0; // Genuine $0 spend
          }
        } else {
          console.error("[claude/cost_report]", costRes.status, await costRes.text().then(t => t.slice(0, 300)));
        }

        // ── Credit balance ────────────────────────────────────────────────────
        // Try all known endpoint variants — Anthropic changes these frequently
        const billingEndpoints = [
          "https://api.anthropic.com/v1/organizations/billing/credit_balance",
          "https://api.anthropic.com/v1/organizations/credits",
          "https://api.anthropic.com/v1/organizations/billing",
          "https://api.anthropic.com/v1/organizations/billing/credit_grants",
          "https://api.anthropic.com/v1/organizations/usage/credit_grants",
        ];
        for (const endpoint of billingEndpoints) {
          try {
            const billingRes = await fetch(endpoint, { headers: ADMIN_HEADERS });
            if (!billingRes.ok) { console.log("[claude/billing]", endpoint, billingRes.status); continue; }
            const raw = await billingRes.text();
            console.log("[claude/billing] OK", endpoint, raw.slice(0, 300));
            const bj = JSON.parse(raw) as Record<string, unknown>;
            // Walk every possible field name
            const candidates = [
              bj.credit_balance_usd, bj.remaining_credits, bj.balance,
              bj.available_balance,  bj.credits_remaining,  bj.current_balance,
              bj.remaining,          bj.credit_balance,     bj.credits,
            ];
            const found = candidates.find(v => typeof v === "number" && v >= 0);
            if (found !== undefined) { creditBalance = found as number; break; }
            // Array shape: data[].remaining_credits etc.
            if (Array.isArray(bj.data) && bj.data.length > 0) {
              const row = bj.data[0] as Record<string, unknown>;
              const arrFound = [row.remaining_credits, row.balance, row.amount, row.credit_balance_usd]
                .find(v => typeof v === "number" && v >= 0);
              if (arrFound !== undefined) { creditBalance = arrFound as number; break; }
            }
          } catch (e) { console.error("[claude/billing] error:", endpoint, e); }
        }

      }
      // Without an admin key there is no usage source: the Dashboard no longer
      // self-tracks Claude calls (the Firestore claude_usage collection is gone).

      const daily = Object.entries(dailyMap)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([date, v]) => ({ date, ...v }));

      // Only show cost when it comes from real billing data (Admin API cost_report)
      // Never show a token-estimate as cost — it's always wrong due to cache pricing.
      const costIsReal = dataSource === "admin_api";
      const costToShow = costIsReal ? totalCost : null;

      return {
        total_tokens: totalInput + totalOutput,
        input_tokens: totalInput, output_tokens: totalOutput,
        total_requests: totalReqs,
        cost_usd: costToShow,
        cost_is_estimated: false,
        spend_limit: process.env.ANTHROPIC_SPEND_LIMIT ? parseFloat(process.env.ANTHROPIC_SPEND_LIMIT) : null,
        cost_real: costIsReal,
        credit_balance: creditBalance,
        period: `${startStr} – ${endStr}`,
        data_source: dataSource,
        has_tracking: dataSource !== "none",
        usage_note: dataSource === "admin_api" ? "" : "Set ANTHROPIC_ADMIN_KEY to see Claude usage.",
        daily,
        model_daily: Object.fromEntries(
          Object.entries(modelDailyMap).map(([model, dayMap]) => [
            model,
            Object.entries(dayMap).sort(([a], [b]) => a.localeCompare(b)).map(([date, v]) => ({ date, ...v })),
          ])
        ),
        models: Object.keys(modelMap).length > 0
          ? Object.entries(modelMap).map(([model, v]) => ({ model, ...v })).sort((a, b) => b.tokens - a.tokens)
          : availableModels.slice(0, 6).map(id => ({ model: id, tokens: 0, requests: 0, cost: 0 })),
      };
    });


    // ── OpenAI ──────────────────────────────────────────────────────────────
    const openaiAdminKey   = process.env.OPENAI_ADMIN_KEY;
    const openaiMonthParam = req.nextUrl.searchParams.get("openaiMonth");
    const openaiData = await safeGet("openai", async () => {
      if (!openaiAdminKey) throw new Error("OPENAI_ADMIN_KEY not set — add your sk-admin-... key to .env");

      const now = new Date();
      let start: Date, end: Date;
      if (openaiMonthParam && /^\d{4}-\d{2}$/.test(openaiMonthParam)) {
        const [y, m] = openaiMonthParam.split("-").map(Number);
        start = new Date(y, m - 1, 1); end = new Date(y, m, 0, 23, 59, 59);
      } else {
        start = new Date(now.getFullYear(), now.getMonth(), 1); end = now;
      }
      const startTs  = Math.floor(start.getTime() / 1000);
      const endTs    = Math.floor(end.getTime()   / 1000);
      const startStr = start.toISOString().slice(0, 10);
      const endStr   = end.toISOString().slice(0, 10);
      const OAI_HEADERS = { Authorization: `Bearer ${openaiAdminKey}`, "Content-Type": "application/json" };

      const OAI_IN_PRICE: Record<string, number> = {
        "gpt-4o": 2.5, "gpt-4o-2024-08-06": 2.5, "gpt-4o-2024-11-20": 2.5,
        "gpt-4o-mini": 0.15, "gpt-4o-mini-2024-07-18": 0.15,
        "gpt-4-turbo": 10, "gpt-4": 30, "gpt-3.5-turbo": 0.5,
        "o1": 15, "o1-mini": 3, "o3-mini": 1.1,
      };
      const OAI_OUT_PRICE: Record<string, number> = {
        "gpt-4o": 10, "gpt-4o-2024-08-06": 10, "gpt-4o-2024-11-20": 10,
        "gpt-4o-mini": 0.6, "gpt-4o-mini-2024-07-18": 0.6,
        "gpt-4-turbo": 30, "gpt-4": 60, "gpt-3.5-turbo": 1.5,
        "o1": 60, "o1-mini": 12, "o3-mini": 4.4,
      };

      type OAIResult = { input_tokens?: number; output_tokens?: number; num_model_requests?: number; model?: string | null };
      type OAIBucket = { start_time?: number; results?: OAIResult[] };
      type OAIResp   = { data?: OAIBucket[] };

      let promptTok = 0, completionTok = 0, totalReqs = 0, totalCost = 0;
      const models:   Record<string, { tokens: number; requests: number; cost: number }> = {};
      const dailyMap: Record<string, { tokens: number; requests: number; cost: number }> = {};

      const usageEndpoints = [
        `https://api.openai.com/v1/organization/usage/completions?start_time=${startTs}&end_time=${endTs}&bucket_width=1d&limit=31&group_by[]=model`,
        `https://api.openai.com/v1/organization/usage/completions?start_time=${startTs}&end_time=${endTs}&bucket_width=1d&limit=31`,
      ];

      let usageFetched = false;
      const lastErrors: string[] = [];
      for (const endpoint of usageEndpoints) {
        const usageRes = await fetch(endpoint, { headers: OAI_HEADERS });
        const txt = await usageRes.text();
        console.log(`[openai/usage] ${usageRes.status} ${endpoint.split("?")[0]}`);
        if (usageRes.ok) {
          const uj = JSON.parse(txt) as OAIResp;
          (uj.data ?? []).forEach(bucket => {
            const day = bucket.start_time ? new Date(bucket.start_time * 1000).toISOString().slice(0, 10) : startStr;
            (bucket.results ?? []).forEach(r => {
              const inp = r.input_tokens ?? 0, out = r.output_tokens ?? 0;
              const rq  = r.num_model_requests ?? 0, model = r.model ?? "unknown";
              const cost = (inp * (OAI_IN_PRICE[model] ?? 2.5) + out * (OAI_OUT_PRICE[model] ?? 10)) / 1_000_000;
              promptTok += inp; completionTok += out; totalReqs += rq; totalCost += cost;
              if (!models[model]) models[model] = { tokens: 0, requests: 0, cost: 0 };
              models[model].tokens += inp + out; models[model].requests += rq; models[model].cost += cost;
              if (!dailyMap[day]) dailyMap[day] = { tokens: 0, requests: 0, cost: 0 };
              dailyMap[day].tokens += inp + out; dailyMap[day].requests += rq; dailyMap[day].cost += cost;
            });
          });
          usageFetched = true;
          break;
        } else {
          lastErrors.push(`${usageRes.status}: ${txt.slice(0, 200)}`);
        }
      }
      if (!usageFetched) throw new Error(`OpenAI usage fetch failed: ${lastErrors.join(" | ")}`);

      // Fetch real billed costs with full pagination
      const oaiCosts = await fetchOAICosts(startTs, endTs, OAI_HEADERS);
      if (oaiCosts.total > 0) {
        totalCost = oaiCosts.total;
        Object.entries(oaiCosts.daily).forEach(([day, cost]) => {
          if (dailyMap[day]) dailyMap[day].cost = cost;
          else dailyMap[day] = { tokens: 0, requests: 0, cost };
        });
      } else {
        console.log("[openai/costs] $0 from API — keeping token estimate:", totalCost);
      }

      const daily = Object.entries(dailyMap).sort(([a],[b]) => a.localeCompare(b)).map(([date, v]) => ({ date, ...v }));
      return {
        total_tokens: promptTok + completionTok, prompt_tokens: promptTok,
        completion_tokens: completionTok, total_requests: totalReqs, cost_usd: totalCost,
        period: `${startStr} – ${endStr}`, daily: daily.slice(-31),
        models: Object.entries(models).map(([model, v]) => ({ model, ...v })).sort((a, b) => b.tokens - a.tokens),
      };
    });

    // ── Stripe ──────────────────────────────────────────────────────────────
    const stripeData = await safeGet("stripe", async () => {
      type StripeCharge  = { status: string; amount: number; amount_refunded: number; customer?: string | null };
      type StripeSubItem = { price?: { unit_amount?: number; recurring?: { interval?: string } } };
      type StripeCoupon  = { percent_off?: number | null; amount_off?: number | null };
      type StripeDiscount = { coupon?: StripeCoupon } | null;
      type StripeSub     = { customer?: string | { id?: string } | null; items?: { data?: StripeSubItem[] }; discount?: StripeDiscount };
      type StripeList<T> = { data: T[] };

      // Admin customer IDs so we can exclude their subscriptions from MRR
      const adminCustIds = await adminCustomerIds();

      const stripe = getStripe();
      const since  = Math.floor((Date.now() - 30 * 86_400_000) / 1000);
      const [charges, subs] = await Promise.all([
        stripe.charges.list({ limit: 100, created: { gte: since } }) as Promise<StripeList<StripeCharge>>,
        stripe.subscriptions.list({ limit: 100, status: "active" }) as Promise<StripeList<StripeSub>>,
      ]);

      const successful = charges.data.filter(c => c.status === "succeeded" && !adminCustIds.has(c.customer ?? ""));
      const failed     = charges.data.filter(c => c.status === "failed"    && !adminCustIds.has(c.customer ?? ""));
      const refunded   = successful.reduce((s, c) => s + (c.amount_refunded ?? 0), 0);
      const volume     = successful.reduce((s, c) => s + (c.amount ?? 0), 0);

      let paidSubCount = 0;
      const mrr = subs.data.reduce((s, sub) => {
        // Exclude admin subscriptions
        const custId = typeof sub.customer === "string" ? sub.customer : (sub.customer as { id?: string } | null)?.id ?? "";
        if (custId && adminCustIds.has(custId)) return s;

        const item     = sub.items?.data?.[0];
        const amount   = item?.price?.unit_amount ?? 0;
        const interval = item?.price?.recurring?.interval ?? "month";
        let monthly    = (interval === "year" ? amount / 12 : amount) / 100;

        // Apply subscription-level coupon discount — 100% off = free, skip from MRR
        const coupon = sub.discount?.coupon;
        if (coupon) {
          const pct = coupon.percent_off ?? 0;
          if (pct >= 100) return s;
          if (pct > 0) monthly *= (1 - pct / 100);
          else if ((coupon.amount_off ?? 0) > 0) monthly = Math.max(0, monthly - (coupon.amount_off ?? 0) / 100);
        }

        if (monthly > 0) paidSubCount++;
        return s + monthly;
      }, 0);

      // One-time credit packs (ledger in credit_packs), last 30 days
      const { data: packRows } = await sb().from("credit_packs")
        .select("price_cents,refunded_at").gte("purchased_at", new Date(since * 1000).toISOString());
      const livePacks = (packRows ?? []).filter(p => !p.refunded_at);

      return {
        mrr: Math.round(mrr * 100) / 100,
        total_charges: charges.data.filter(c => !adminCustIds.has(c.customer ?? "")).length,
        successful_charges: successful.length,
        failed_charges: failed.length, total_volume: volume, refunded,
        active_subscriptions: paidSubCount, period_requests: charges.data.length,
        pack_purchases: livePacks.length,
        pack_revenue: livePacks.reduce((s, p) => s + (p.price_cents ?? 0), 0),
      };
    });

    // ── Resend ──────────────────────────────────────────────────────────────
    const resendData = await safeGet("resend", async () => {
      const resendKey = process.env.RESEND_API_KEY;
      if (!resendKey) throw new Error("RESEND_API_KEY not set");
      const res = await fetch("https://api.resend.com/emails?limit=100", {
        headers: { Authorization: `Bearer ${resendKey}` },
      });
      if (!res.ok) throw new Error(`Resend API ${res.status}: ${await res.text().then(t => t.slice(0, 200))}`);
      type ResendEmail = { last_event: string };
      const json = await res.json() as { data?: ResendEmail[] };
      const emails = json.data ?? [];
      return {
        emails_sent:       emails.length,
        emails_delivered:  emails.filter(e => e.last_event === "delivered").length,
        emails_bounced:    emails.filter(e => ["bounced","hard_bounced","soft_bounced"].includes(e.last_event)).length,
        emails_complained: emails.filter(e => e.last_event === "complained").length,
        period: "last 100 emails",
      };
    });

    // ── Cloudflare ──────────────────────────────────────────────────────────
    const cloudflareData = await safeGet("cloudflare", async () => {
      const cfToken  = process.env.CLOUDFLARE_API_TOKEN;
      const cfZoneId = process.env.CLOUDFLARE_ZONE_ID;
      if (!cfToken || !cfZoneId) throw new Error("CLOUDFLARE_API_TOKEN or CLOUDFLARE_ZONE_ID not set");

      const now   = new Date();
      const since = new Date(now.getTime() - 7 * 86_400_000).toISOString().slice(0, 10);
      const until = new Date(now.getTime() + 86_400_000).toISOString().slice(0, 10);

      const gqlQuery = `{
        viewer {
          zones(filter: { zoneTag: "${cfZoneId}" }) {
            httpRequests1dGroups(
              limit: 7
              filter: { date_geq: "${since}", date_lt: "${until}" }
              orderBy: [date_ASC]
            ) {
              dimensions { date }
              sum { requests cachedRequests bytes cachedBytes threats }
              uniq { uniques }
            }
          }
        }
      }`;

      const res = await fetch("https://api.cloudflare.com/client/v4/graphql", {
        method:  "POST",
        headers: { Authorization: `Bearer ${cfToken}`, "Content-Type": "application/json" },
        body:    JSON.stringify({ query: gqlQuery }),
      });
      const text = await res.text();
      if (!res.ok) throw new Error(`Cloudflare API ${res.status}: ${text.slice(0, 300)}`);

      type CFSum   = { requests?: number; cachedRequests?: number; bytes?: number; cachedBytes?: number; threats?: number };
      type CFGroup = { dimensions?: { date?: string }; sum?: CFSum; uniq?: { uniques?: number } };
      type CFResp  = { data?: { viewer?: { zones?: { httpRequests1dGroups?: CFGroup[] }[] } }; errors?: { message: string }[] };

      const json = JSON.parse(text) as CFResp;
      if (json.errors?.length) throw new Error(json.errors.map(e => e.message).join("; "));

      const groups = json.data?.viewer?.zones?.[0]?.httpRequests1dGroups ?? [];
      const totals = groups.reduce<{
        requests: number; cachedRequests: number; bytes: number;
        cachedBytes: number; threats: number; uniques: number;
      }>((acc, g) => ({
        requests:       acc.requests       + (g.sum?.requests       ?? 0),
        cachedRequests: acc.cachedRequests + (g.sum?.cachedRequests ?? 0),
        bytes:          acc.bytes          + (g.sum?.bytes          ?? 0),
        cachedBytes:    acc.cachedBytes    + (g.sum?.cachedBytes    ?? 0),
        threats:        acc.threats        + (g.sum?.threats        ?? 0),
        uniques:        acc.uniques        + (g.uniq?.uniques        ?? 0),
      }), { requests: 0, cachedRequests: 0, bytes: 0, cachedBytes: 0, threats: 0, uniques: 0 });

      return {
        requests:        totals.requests,
        bandwidth_bytes: totals.bytes,
        threats:         totals.threats,
        cached_requests: totals.cachedRequests,
        unique_visitors: totals.uniques,
        period:          `${since} – ${now.toISOString().slice(0, 10)}`,
      };
    });

    // ── Supabase (Postgres) + optional Google Cloud budget ─────────────────────
    // Real row counts per table via head-only count queries. Google Cloud has
    // no direct cost API, but the budget can still be read if configured.
    const supabaseData = await safeGet("supabase", async () => {
      const db = sb();

      const tables = ["profiles","interviews","interview_feedback","resumes","interview_plans","cover_letters",
        "job_applications","support_tickets","credit_packs","usage_counters","erp_logs"];
      const countResults = await Promise.all(
        tables.map(t => Promise.resolve(db.from(t).select("*", { count: "exact", head: true })).then(r => r.count ?? 0).catch(() => 0))
      );
      const counts: Record<string, number> = {};
      tables.forEach((t, i) => { counts[t] = countResults[i]; });
      const totalDocs   = Object.values(counts).reduce((a, b) => a + b, 0);
      const userCount   = counts.profiles ?? 0;

      // Optional: Google Cloud Billing Budget API
      // Requires GOOGLE_CLOUD_BILLING_ACCOUNT=billingAccounts/XXXXXX-XXXXXX-XXXXXX
      // and GOOGLE_APPLICATION_CREDENTIALS or GOOGLE_CLOUD_SA_KEY (service account JSON)
      // The budget API shows spend vs budget — nearest thing to real cost data without BigQuery
      let billingInfo: {
        budget_amount?: number;
        budget_spent?: number;
        budget_name?: string;
        currency?: string;
        budget_period?: string;
      } | null = null;

      const billingAccount = process.env.GOOGLE_CLOUD_BILLING_ACCOUNT; // e.g. "billingAccounts/012345-ABCDEF-012345"
      const gcpApiKey      = process.env.GOOGLE_CLOUD_API_KEY;          // optional simple auth

      if (billingAccount) {
        try {
          // Get an access token from the service account key if provided
          let accessToken: string | null = null;
          const saKeyRaw = process.env.GOOGLE_CLOUD_SA_KEY;
          if (saKeyRaw) {
            // Service account key JSON stored in env (base64 or raw JSON)
            try {
              const saKey = JSON.parse(
                saKeyRaw.startsWith("{") ? saKeyRaw : Buffer.from(saKeyRaw, "base64").toString()
              ) as { client_email: string; private_key: string };
              // Mint a JWT and exchange for access token
              const now   = Math.floor(Date.now() / 1000);
              const claim = {
                iss: saKey.client_email,
                scope: "https://www.googleapis.com/auth/cloud-platform",
                aud: "https://oauth2.googleapis.com/token",
                exp: now + 3600,
                iat: now,
              };
              // Simple JWT without library — header.payload.signature
              const header  = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url");
              const payload = Buffer.from(JSON.stringify(claim)).toString("base64url");
              const { createSign } = await import("node:crypto");
              const sign    = createSign("RSA-SHA256");
              sign.update(`${header}.${payload}`);
              const sig     = sign.sign(saKey.private_key, "base64url");
              const jwt     = `${header}.${payload}.${sig}`;
              const tokRes  = await fetch("https://oauth2.googleapis.com/token", {
                method: "POST",
                headers: { "Content-Type": "application/x-www-form-urlencoded" },
                body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`,
              });
              if (tokRes.ok) {
                const tokJson = await tokRes.json() as { access_token?: string };
                accessToken   = tokJson.access_token ?? null;
              }
            } catch (e) { console.error("[gcp/sa_token]", e); }
          }

          const authHeader = accessToken
            ? { Authorization: `Bearer ${accessToken}` }
            : gcpApiKey
            ? { } as Record<string,string>  // API key goes in URL for budget API
            : null;

          if (authHeader !== null) {
            const budgetUrl = `https://billingbudgets.googleapis.com/v1/${billingAccount}/budgets`
              + (gcpApiKey && !accessToken ? `?key=${gcpApiKey}` : "");
            const budgetRes = await fetch(budgetUrl, {
              headers: { "Content-Type": "application/json", ...authHeader },
              signal: AbortSignal.timeout(4000),
            });
            console.log("[gcp/budget]", budgetRes.status);
            if (budgetRes.ok) {
              type BudgetAmount = { specifiedAmount?: { units?: string; currencyCode?: string } };
              type Budget = {
                name?: string; displayName?: string;
                amount?: BudgetAmount;
                budgetFilter?: { budgetPeriod?: string };
              };
              const bj = await budgetRes.json() as { budgets?: Budget[] };
              const first = bj.budgets?.[0];
              if (first) {
                billingInfo = {
                  budget_name:   first.displayName ?? first.name,
                  budget_amount: parseFloat(first.amount?.specifiedAmount?.units ?? "0"),
                  currency:      first.amount?.specifiedAmount?.currencyCode ?? "USD",
                  budget_period: first.budgetFilter?.budgetPeriod ?? "MONTHLY",
                };
              }
            } else {
              console.log("[gcp/budget] failed:", await budgetRes.text().then(t => t.slice(0, 200)));
            }
          }
        } catch (e) { console.error("[gcp/billing]", e); }
      }

      return {
        tables:        counts,
        total_rows:    totalDocs,
        active_users:  userCount,
        project_ref:   (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").replace(/^https?:\/\//, "").split(".")[0],
        // Real billing from Budget API (if configured)
        billing: billingInfo,
        billing_note: billingAccount
          ? "Budget data from Cloud Billing API"
          : "Row counts are live from Postgres. Supabase billing is per-plan — see the Supabase dashboard for invoices.",
        period: "current",
      };
    });

    // ── Google AI ─────────────────────────────────────────────────────────────
    const googleaiData = await safeGet("googleai", async () => {
      const googleKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
      if (!googleKey) throw new Error("GOOGLE_GENERATIVE_AI_API_KEY not set");
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${googleKey}`);
      if (!res.ok) throw new Error(`Google AI API ${res.status}: ${await res.text().then(t => t.slice(0, 200))}`);
      type GMModel = { name?: string };
      const json = await res.json() as { models?: GMModel[] };
      const models = (json.models ?? []).slice(0, 5).map((m: GMModel) => ({ model: m.name ?? "unknown", requests: 0 }));
      return {
        total_requests: 0, input_tokens: 0, output_tokens: 0, cost_usd: 0,
        models, period: "Google AI Studio has no public usage API — key validated ✓",
      };
    });

    const responseData = {
      openai: openaiData, claude: claudeData, stripe: stripeData,
      resend: resendData, cloudflare: cloudflareData, supabase: supabaseData,
      googleai: googleaiData, errors, fetchedAt: new Date().toISOString(),
    };
    USAGE_CACHE.set(cacheKey, { data: responseData, ts: Date.now() });
    return NextResponse.json(
      { ...responseData, fromCache: false },
      { headers: { "Cache-Control": "private, max-age=300", "X-Cache": "MISS" } }
    );
  }

  // ── usage_openai ───────────────────────────────────────────────────────────
  if (action === "usage_openai") {
    type UsageCache = { data: Record<string, unknown>; ts: number };
    const OAI_CACHE = new Map<string, UsageCache>();
    const monthKey     = req.nextUrl.searchParams.get("openaiMonth") ?? "current";
    const forceRefresh = req.nextUrl.searchParams.get("refresh") === "1";
    const cached       = OAI_CACHE.get(monthKey);
    if (!forceRefresh && cached && Date.now() - cached.ts < 5 * 60 * 1000) {
      return NextResponse.json({ ...cached.data, fromCache: true }, { headers: { "Cache-Control": "private, max-age=300" } });
    }

    const openaiAdminKey2   = process.env.OPENAI_ADMIN_KEY;
    const openaiMonthParam2 = req.nextUrl.searchParams.get("openaiMonth");
    let openaiResult = null;
    let openaiError  = "";
    try {
      if (!openaiAdminKey2) throw new Error("OPENAI_ADMIN_KEY not set — add your sk-admin-... key to .env");
      const now2 = new Date();
      let start2: Date, end2: Date;
      if (openaiMonthParam2 && /^\d{4}-\d{2}$/.test(openaiMonthParam2)) {
        const [y, m] = openaiMonthParam2.split("-").map(Number);
        start2 = new Date(y, m - 1, 1); end2 = new Date(y, m, 0, 23, 59, 59);
      } else {
        start2 = new Date(now2.getFullYear(), now2.getMonth(), 1); end2 = now2;
      }
      const startTs2  = Math.floor(start2.getTime() / 1000);
      const endTs2    = Math.floor(end2.getTime()   / 1000);
      const startStr2 = start2.toISOString().slice(0, 10);
      const endStr2   = end2.toISOString().slice(0, 10);
      const OAI_HEADERS2 = { Authorization: `Bearer ${openaiAdminKey2}`, "Content-Type": "application/json" };

      const OAI_IN_PRICE2: Record<string, number> = {
        "gpt-4o": 2.5, "gpt-4o-2024-08-06": 2.5, "gpt-4o-2024-11-20": 2.5,
        "gpt-4o-mini": 0.15, "gpt-4o-mini-2024-07-18": 0.15,
        "gpt-4-turbo": 10, "gpt-4": 30, "gpt-3.5-turbo": 0.5,
        "o1": 15, "o1-mini": 3, "o3-mini": 1.1,
      };
      const OAI_OUT_PRICE2: Record<string, number> = {
        "gpt-4o": 10, "gpt-4o-2024-08-06": 10, "gpt-4o-2024-11-20": 10,
        "gpt-4o-mini": 0.6, "gpt-4o-mini-2024-07-18": 0.6,
        "gpt-4-turbo": 30, "gpt-4": 60, "gpt-3.5-turbo": 1.5,
        "o1": 60, "o1-mini": 12, "o3-mini": 4.4,
      };

      type OAIResult2  = { input_tokens?: number; output_tokens?: number; num_model_requests?: number; model?: string | null };
      type OAIBucket2  = { start_time?: number; results?: OAIResult2[] };
      type OAIResp2    = { data?: OAIBucket2[] };

      let promptTok = 0, completionTok = 0, totalReqs = 0, totalCost2 = 0;
      const models:    Record<string, { tokens: number; requests: number; cost: number }> = {};
      const dailyMap2: Record<string, { tokens: number; requests: number; cost: number }> = {};

      const processOAIBuckets = (data: OAIBucket2[]) => {
        data.forEach(bucket => {
          const day = bucket.start_time ? new Date(bucket.start_time * 1000).toISOString().slice(0, 10) : startStr2;
          (bucket.results ?? []).forEach(r => {
            const inp = r.input_tokens ?? 0, out = r.output_tokens ?? 0;
            const rq  = r.num_model_requests ?? 0, model = r.model ?? "unknown";
            const cost = (inp * (OAI_IN_PRICE2[model] ?? 2.5) + out * (OAI_OUT_PRICE2[model] ?? 10)) / 1_000_000;
            promptTok += inp; completionTok += out; totalReqs += rq; totalCost2 += cost;
            if (!models[model]) models[model] = { tokens: 0, requests: 0, cost: 0 };
            models[model].tokens += inp + out; models[model].requests += rq; models[model].cost += cost;
            if (!dailyMap2[day]) dailyMap2[day] = { tokens: 0, requests: 0, cost: 0 };
            dailyMap2[day].tokens += inp + out; dailyMap2[day].requests += rq; dailyMap2[day].cost += cost;
          });
        });
      };

      let usageFetched = false;
      const lastErrors: string[] = [];
      for (const endpoint of [
        `https://api.openai.com/v1/organization/usage/completions?start_time=${startTs2}&end_time=${endTs2}&bucket_width=1d&limit=31&group_by[]=model`,
        `https://api.openai.com/v1/organization/usage/completions?start_time=${startTs2}&end_time=${endTs2}&bucket_width=1d&limit=31`,
      ]) {
        const usageRes2 = await fetch(endpoint, { headers: OAI_HEADERS2 });
        const responseText = await usageRes2.text();
        console.log(`[openai/usage] ${usageRes2.status} ${endpoint.split("?")[0]}`);
        if (usageRes2.ok) {
          processOAIBuckets((JSON.parse(responseText) as OAIResp2).data ?? []);
          usageFetched = true;
          break;
        } else {
          lastErrors.push(`${usageRes2.status}: ${responseText.slice(0, 300)}`);
        }
      }
      if (!usageFetched) throw new Error(`OpenAI usage fetch failed: ${lastErrors.join(" | ")}`);

      // Fetch real billed costs with full pagination
      const oaiCosts2 = await fetchOAICosts(startTs2, endTs2, OAI_HEADERS2);
      if (oaiCosts2.total > 0) {
        totalCost2 = oaiCosts2.total;
        Object.entries(oaiCosts2.daily).forEach(([day, cost]) => {
          if (dailyMap2[day]) dailyMap2[day].cost = cost;
          else dailyMap2[day] = { tokens: 0, requests: 0, cost };
        });
      } else {
        console.log("[openai/costs usage_openai] $0 from API — keeping token estimate:", totalCost2);
      }

      const daily2 = Object.entries(dailyMap2).sort(([a],[b]) => a.localeCompare(b)).map(([date, v]) => ({ date, ...v }));
      openaiResult = {
        total_tokens: promptTok + completionTok, prompt_tokens: promptTok,
        completion_tokens: completionTok, total_requests: totalReqs, cost_usd: totalCost2,
        period: `${startStr2} – ${endStr2}`, daily: daily2.slice(-31),
        models: Object.entries(models).map(([model, v]) => ({ model, ...v })).sort((a, b) => b.tokens - a.tokens),
      };
    } catch(e) { openaiError = (e as Error).message; }

    const result = { openai: openaiResult, errors: openaiError ? { openai: openaiError } : {}, fetchedAt: new Date().toISOString() };
    OAI_CACHE.set(monthKey, { data: result, ts: Date.now() });
    return NextResponse.json({ ...result, fromCache: false }, { headers: { "Cache-Control": "private, max-age=300" } });
  }

  // ── logs ──────────────────────────────────────────────────────────────────
  // Two sources, merged newest-first:
  //   erp_logs       — ERP admin logins + anything POSTed via write_log
  //   user_sessions  — the Dashboard's own session table (one row per sign-in,
  //                    with IP/geo/UA), surfaced as "login" events
  if (action === "logs") {
    try {
      const db     = sb();
      const userId = req.nextUrl.searchParams.get("userId");
      const type   = req.nextUrl.searchParams.get("type");
      const limit  = Math.min(parseInt(req.nextUrl.searchParams.get("limit") ?? "500"), 1000);

      let erpQ = db.from("erp_logs").select("*").order("timestamp", { ascending: false }).limit(limit);
      if (userId) erpQ = erpQ.eq("user_id", userId);
      if (type)   erpQ = erpQ.eq("type", type);

      const wantSessions = !type || type === "login";
      let sessQ = db.from("user_sessions").select("session_id,user_id,ip,geo_country,geo_city,user_agent,created_at,revoked_at,revoked_reason")
        .order("created_at", { ascending: false }).limit(limit);
      if (userId) sessQ = UUID_RE.test(userId) ? sessQ.eq("user_id", userId) : sessQ.eq("user_id", "00000000-0000-0000-0000-000000000000");

      const [erp, sess] = await Promise.all([
        erpQ.then(r => r, () => ({ data: null, error: null })),
        wantSessions ? sessQ : Promise.resolve({ data: [], error: null }),
      ]);

      const sessRows = (sess.data ?? []) as { session_id: string; user_id: string; ip: string | null; geo_country: string | null; geo_city: string | null; user_agent: string | null; created_at: string; revoked_at: string | null; revoked_reason: string | null }[];
      const names = await profileLookup(db, sessRows.map(s => s.user_id));

      const logs = [
        ...((erp.data ?? []) as Record<string, unknown>[]).map(r => ({
          id: r.id, userId: r.user_id ?? "", userName: r.user_name ?? undefined, userEmail: r.user_email ?? undefined,
          type: r.type, timestamp: iso(r.timestamp), ip: r.ip ?? undefined, city: r.city ?? undefined,
          country: r.country ?? undefined, countryCode: r.country_code ?? undefined, device: r.device ?? undefined,
          browser: r.browser ?? undefined, os: r.os ?? undefined, userAgent: r.user_agent ?? undefined,
          action: r.action ?? undefined, path: r.path ?? undefined, details: r.details ?? {},
        })),
        ...sessRows.map(s => {
          const ua = parseUA(s.user_agent ?? "");
          return {
            id: `sess_${s.session_id}`, userId: s.user_id,
            userName: names.get(s.user_id)?.name, userEmail: names.get(s.user_id)?.email,
            type: "login", timestamp: iso(s.created_at), ip: s.ip ?? undefined,
            city: s.geo_city ?? undefined, countryCode: s.geo_country ?? undefined, country: s.geo_country ?? undefined,
            device: ua.device, browser: ua.browser, os: ua.os, userAgent: s.user_agent ?? undefined,
            details: { source: "dashboard_session", ...(s.revoked_at ? { revokedAt: s.revoked_at, revokedReason: s.revoked_reason } : {}) },
          };
        }),
      ].sort((a, b) => String(b.timestamp ?? "").localeCompare(String(a.timestamp ?? ""))).slice(0, limit);

      return NextResponse.json({ logs }, { headers: { "Cache-Control": "private, no-store" } });
    } catch (err) {
      return NextResponse.json({ error: (err as Error).message }, { status: 500 });
    }
  }

  // ── cloudflare — dedicated endpoint for OverviewTab ─────────────────────────
  if (action === "cloudflare") {
    const cfToken  = process.env.CLOUDFLARE_API_TOKEN;
    const cfZoneId = process.env.CLOUDFLARE_ZONE_ID;
    if (!cfToken || !cfZoneId) {
      return NextResponse.json({ error: "CLOUDFLARE_API_TOKEN or CLOUDFLARE_ZONE_ID not set" }, { status: 400 });
    }

    const days    = parseInt(req.nextUrl.searchParams.get("days") ?? "7");
    const country = req.nextUrl.searchParams.get("country") ?? "";
    const device  = req.nextUrl.searchParams.get("device")  ?? "";

    const now   = new Date();
    const since = new Date(now.getTime() - days * 86_400_000).toISOString().slice(0, 10);
    const until = new Date(now.getTime() + 86_400_000).toISOString().slice(0, 10);

    // Build filter
    const filterParts = [`date_geq: "${since}"`, `date_lt: "${until}"`];
    if (country && country !== "all") filterParts.push(`clientCountryName: "${country}"`);
    if (device  && device  !== "all") {
      const deviceMap: Record<string, string> = { desktop: "desktop", mobile: "mobile", tablet: "tablet" };
      if (deviceMap[device]) filterParts.push(`deviceType: "${deviceMap[device]}"`);
    }
    const filter = filterParts.join(", ");

    const gqlQuery = `{
      viewer {
        zones(filter: { zoneTag: "${cfZoneId}" }) {
          httpRequests1dGroups(
            limit: ${Math.min(days + 1, 31)}
            filter: { ${filter} }
            orderBy: [date_ASC]
          ) {
            dimensions { date }
            sum { requests cachedRequests bytes cachedBytes threats }
            uniq { uniques }
          }
        }
      }
    }`;

    try {
      const res = await fetch("https://api.cloudflare.com/client/v4/graphql", {
        method:  "POST",
        headers: { Authorization: `Bearer ${cfToken}`, "Content-Type": "application/json" },
        body:    JSON.stringify({ query: gqlQuery }),
      });
      const text = await res.text();
      if (!res.ok) return NextResponse.json({ error: `Cloudflare ${res.status}: ${text.slice(0, 200)}` }, { status: 502 });

      type CFSum   = { requests?: number; cachedRequests?: number; bytes?: number; cachedBytes?: number; threats?: number };
      type CFGroup = { dimensions?: { date?: string }; sum?: CFSum; uniq?: { uniques?: number } };
      type CFResp  = { data?: { viewer?: { zones?: { httpRequests1dGroups?: CFGroup[] }[] } }; errors?: { message: string }[] };

      const json = JSON.parse(text) as CFResp;
      if (json.errors?.length) return NextResponse.json({ error: json.errors.map(e => e.message).join("; ") }, { status: 502 });

      const groups = json.data?.viewer?.zones?.[0]?.httpRequests1dGroups ?? [];
      const totals = groups.reduce<{
        requests: number; cachedRequests: number; bytes: number;
        cachedBytes: number; threats: number; uniques: number;
      }>((acc, g) => ({
        requests:       acc.requests       + (g.sum?.requests       ?? 0),
        cachedRequests: acc.cachedRequests + (g.sum?.cachedRequests ?? 0),
        bytes:          acc.bytes          + (g.sum?.bytes          ?? 0),
        cachedBytes:    acc.cachedBytes    + (g.sum?.cachedBytes    ?? 0),
        threats:        acc.threats        + (g.sum?.threats        ?? 0),
        uniques:        acc.uniques        + (g.uniq?.uniques        ?? 0),
      }), { requests: 0, cachedRequests: 0, bytes: 0, cachedBytes: 0, threats: 0, uniques: 0 });

      const cacheRate = totals.requests > 0
        ? Math.round((totals.cachedRequests / totals.requests) * 100)
        : null;

      return NextResponse.json({
        totals: {
          uniqueVisitors: totals.uniques,
          requests:       totals.requests,
          bytes:          totals.bytes,
          cachedBytes:    totals.cachedBytes,
          cacheRate,
        },
        daily: groups.map(g => ({
          date: g.dimensions?.date,
          sum:  g.sum,
        })),
        adaptive: false,
      }, { headers: { "Cache-Control": "private, max-age=300" } });
    } catch (e) {
      return NextResponse.json({ error: (e as Error).message }, { status: 500 });
    }
  }

  // ─── Support Tickets ────────────────────────────────────────────────────────
  // Reads go through here with the service role. The Support tab also opens a
  // Supabase realtime channel on support_tickets / support_ticket_replies and
  // refetches on change (needs the admin SELECT policies in erp_schema.sql).
  if (action === "tickets") {
    try {
      const { data, error } = await sb().from("support_tickets")
        .select("id,user_id,subject,message,category,status,priority,user_email,user_name,attachments,last_reply_by,last_reply_at,reply_count,created_at,updated_at")
        .order("created_at", { ascending: false }).limit(500);
      if (error) throw new Error(error.message);
      const ids = (data ?? []).map(t => t.id as string);
      const { data: notes } = ids.length
        ? await sb().from("erp_ticket_notes").select("ticket_id,notes").in("ticket_id", ids).then(r => r, () => ({ data: null }))
        : { data: [] };
      const noteBy = new Map((notes ?? []).map(n => [n.ticket_id as string, n.notes as string]));
      const tickets = (data ?? []).map(t => ({
        id: t.id, userId: t.user_id, subject: t.subject ?? undefined, message: t.message ?? undefined,
        category: t.category ?? undefined, status: t.status, priority: t.priority,
        userEmail: t.user_email ?? undefined, userName: t.user_name ?? undefined,
        lastReplyBy: t.last_reply_by ?? undefined, lastReplyAt: t.last_reply_at ?? undefined, replyCount: t.reply_count ?? 0,
        tags: t.category ? [t.category] : [],
        notes: noteBy.get(t.id as string) ?? "",
        createdAt: t.created_at, updatedAt: t.updated_at,
      }));
      return NextResponse.json({ tickets }, { headers: { "Cache-Control": "private, no-store" } });
    } catch (e) {
      return NextResponse.json({ error: (e as Error).message }, { status: 500 });
    }
  }

  if (action === "ticket_replies") {
    const ticketId = req.nextUrl.searchParams.get("ticketId");
    if (!ticketId) return NextResponse.json({ error: "Missing ticketId" }, { status: 400 });
    try {
      const { data, error } = await sb().from("support_ticket_replies")
        .select("id,ticket_id,author_user_id,is_staff,body,from_email,created_at")
        .eq("ticket_id", ticketId).order("created_at", { ascending: true });
      if (error) throw new Error(error.message);
      const replies = (data ?? []).map(r => ({
        id: r.id, ticketId: r.ticket_id, message: r.body, from: r.is_staff ? "support" : "user",
        fromEmail: r.from_email ?? undefined, isStaff: r.is_staff, createdAt: r.created_at,
      }));
      return NextResponse.json({ replies }, { headers: { "Cache-Control": "private, no-store" } });
    } catch (e) {
      return NextResponse.json({ error: (e as Error).message }, { status: 500 });
    }
  }

  // ─── Feedback (feature_ratings) ──────────────────────────────────────────────
  if (action === "feedback_list") {
    try {
      const sp         = req.nextUrl.searchParams;
      const userId     = sp.get("userId");
      const serviceKey = sp.get("serviceKey");
      let q = sb().from("feature_ratings").select("id,user_id,feature,rating,comment,nps,tags,created_at")
        .order("created_at", { ascending: false }).limit(500);
      if (serviceKey) q = q.eq("feature", serviceKey);
      if (userId && UUID_RE.test(userId)) q = q.eq("user_id", userId);
      const { data, error } = await q;
      if (error) throw new Error(error.message);
      const names = await profileLookup(sb(), (data ?? []).map(r => r.user_id as string));
      const items = (data ?? []).map(r => ({
        id: r.id, type: "feature-rating", userId: r.user_id,
        userName: names.get(r.user_id)?.name, userEmail: names.get(r.user_id)?.email,
        serviceKey: r.feature, rating: r.rating ?? undefined, comment: r.comment ?? undefined,
        nps: r.nps ?? undefined, tags: r.tags?.length ? r.tags : undefined, createdAt: r.created_at,
      }));
      return NextResponse.json({ items });
    } catch (e) {
      return NextResponse.json({ error: (e as Error).message }, { status: 500 });
    }
  }

  // ─── Surveys (product_surveys) ───────────────────────────────────────────────
  if (action === "surveys") {
    try {
      const userId = req.nextUrl.searchParams.get("userId");
      let q = sb().from("product_surveys").select("*").order("created_at", { ascending: false }).limit(500);
      if (userId && UUID_RE.test(userId)) q = q.eq("user_id", userId);
      const { data, error } = await q;
      if (error) throw new Error(error.message);
      const surveys = (data ?? []).map(s => ({
        id: s.id, userId: s.user_id ?? undefined, userEmail: s.user_email ?? undefined, userName: s.user_name ?? undefined,
        page: s.page, overallRating: s.overall_rating, nps: s.nps ?? undefined,
        featureRatings: s.feature_ratings, usageOptions: s.usage_options, specificAnswers: s.specific_answers,
        topImprovement: s.top_improvement ?? undefined, freeText: s.free_text ?? undefined,
        userAgent: s.user_agent ?? undefined, submittedAt: s.submitted_at, createdAt: s.created_at,
      }));
      return NextResponse.json({ surveys });
    } catch (e) {
      return NextResponse.json({ error: (e as Error).message }, { status: 500 });
    }
  }

  // ─── Stripe Coupons ──────────────────────────────────────────────────────────
  if (action === "coupons") {
    try {
      const stripe = getStripe();
      const list = await stripe.coupons.list({ limit: 100 });
      const coupons = list.data.map(c => ({
        id:           c.id,
        name:         c.name ?? c.id,
        amountOff:    c.amount_off,
        percentOff:   c.percent_off,
        currency:     c.currency,
        duration:     c.duration,
        durationMonths: c.duration_in_months,
        timesRedeemed: c.times_redeemed,
        maxRedemptions: c.max_redemptions,
        valid:        c.valid,
      }));
      return NextResponse.json({ coupons });
    } catch (e) {
      return NextResponse.json({ error: (e as Error).message }, { status: 500 });
    }
  }

  if (action === "code_ref") {
    const key = req.nextUrl.searchParams.get("key") ?? "";
    // "erp:" paths live in this repo; the rest in the Dashboard repo
    // (DASHBOARD_REPO_DIR, default ../Dashboard — only available in local dev).
    const ALLOWED: Record<string, string> = {
      stripeWebhook:      "app/api/webhooks/stripe/route.ts",
      stripeCreateSub:    "app/api/subscription/create-subscription/route.ts",
      stripeCancelSub:    "app/api/subscription/cancel-subscription/route.ts",
      priceIds:           "lib/config/stripe-prices.ts",
      packs:              "lib/config/packs.ts",
      packGrant:          "lib/packs/grant.ts",
      subscriptionFields: "lib/actions/auth.action.ts",
      usageLimits:        "lib/config/usage-limits.ts",
      usageGuard:         "lib/ai/usage-guard.ts",
      usagePeriod:        "lib/usage/period.ts",
      adminRoute:         "erp:app/api/admin/route.ts",
      erpData:            "erp:lib/erp-data.ts",
      erpSchema:          "erp:supabase/erp_schema.sql",
    };
    if (!key || !ALLOWED[key]) {
      return NextResponse.json({ error: "Unknown ref key" }, { status: 400 });
    }
    try {
      const { readFile } = await import("node:fs/promises");
      const { join }     = await import("node:path");
      const ref  = ALLOWED[key];
      // turbopackIgnore: dev-only source viewer, keep these reads out of the build trace
      const path = ref.startsWith("erp:")
        ? join(/*turbopackIgnore: true*/ process.cwd(), ref.slice(4))
        : join(/*turbopackIgnore: true*/ process.env.DASHBOARD_REPO_DIR ?? join(/*turbopackIgnore: true*/ process.cwd(), "..", "Dashboard"), ref);
      const content = await readFile(path, "utf-8");
      return NextResponse.json({ content, file: ref.replace(/^erp:/, "") });
    } catch (e) {
      return NextResponse.json({ error: (e as Error).message }, { status: 500 });
    }
  }

  return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
}

// ─── POST ─────────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const admin = await getAdmin(req);
  if (!admin) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });

  let body: Record<string, unknown>;
  try { body = await req.json() as Record<string, unknown>; }
  catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const action = (body.action as string) ?? "update";

  // ── 0. Write log entry ────────────────────────────────────────────────────
  if (action === "write_log") {
    const log = body.log as Record<string, unknown>;
    if (!log || !log.userId || !log.type) {
      return NextResponse.json({ error: "Missing log.userId or log.type" }, { status: 400 });
    }
    try {
      const ua     = (log.userAgent as string) || req.headers.get("user-agent") || "";
      const ip     = (log.ip as string) || (req.headers.get("x-forwarded-for") ?? req.headers.get("x-real-ip") ?? "").split(",")[0].trim();
      const parsed = ua && !log.browser ? parseUA(ua) : { browser: log.browser, os: log.os, device: log.device };
      const geo    = ip && !log.country  ? await getGeoFromIP(ip) : {};
      const { data: row, error } = await sb().from("erp_logs").insert({
        user_id:      String(log.userId),
        user_name:    (log.userName as string) ?? null,
        user_email:   (log.userEmail as string) ?? null,
        type:         String(log.type),
        action:       (log.action as string) ?? null,
        path:         (log.path as string) ?? null,
        user_agent:   ua || null,
        browser:      (parsed.browser || log.browser || "Unknown") as string,
        os:           (parsed.os || log.os || "Unknown") as string,
        device:       (parsed.device || log.device || "desktop") as string,
        ip:           (ip || log.ip || "") as string,
        city:         (geo.city || log.city || "") as string,
        country:      (geo.country || log.country || "") as string,
        country_code: (geo.countryCode || log.countryCode || "") as string,
        details:      (log.details as Record<string, unknown>) ?? {},
        timestamp:    (log.timestamp as string) ?? new Date().toISOString(),
      }).select("id").single();
      if (error) throw new Error(error.message);
      return NextResponse.json({ success: true, id: row.id });
    } catch (err) {
      return NextResponse.json({ error: (err as Error).message }, { status: 500 });
    }
  }

  // ── Support: staff reply ──────────────────────────────────────────────────
  // The sync_ticket_on_reply trigger maintains reply_count / last_reply_* /
  // status, so only the reply row is inserted here.
  if (action === "ticket_reply") {
    const { ticketId, message } = body as { ticketId?: string; message?: string };
    if (!ticketId || !message?.trim()) return NextResponse.json({ error: "Missing ticketId or message" }, { status: 400 });
    try {
      const { data, error } = await sb().from("support_ticket_replies").insert({
        ticket_id: ticketId, author_user_id: admin.userId, is_staff: true,
        body: message.trim(), from_email: admin.email || null,
      }).select("id,created_at").single();
      if (error) throw new Error(error.message);
      return NextResponse.json({ success: true, id: data.id, createdAt: data.created_at });
    } catch (e) {
      return NextResponse.json({ error: (e as Error).message }, { status: 500 });
    }
  }

  // ── Support: status / priority / internal notes ───────────────────────────
  if (action === "ticket_update") {
    const { ticketId, status, priority, notes } = body as { ticketId?: string; status?: string; priority?: string; notes?: string };
    if (!ticketId) return NextResponse.json({ error: "Missing ticketId" }, { status: 400 });
    try {
      const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
      if (status)   patch.status   = status;
      if (priority) patch.priority = priority;
      const { error } = await sb().from("support_tickets").update(patch).eq("id", ticketId);
      if (error) throw new Error(error.message);
      if (notes !== undefined) {
        const { error: nErr } = await sb().from("erp_ticket_notes").upsert(
          { ticket_id: ticketId, notes, updated_by: admin.userId, updated_at: new Date().toISOString() },
          { onConflict: "ticket_id" },
        );
        if (nErr) throw new Error(`Notes not saved: ${nErr.message} (run supabase/erp_schema.sql)`);
      }
      return NextResponse.json({ success: true });
    } catch (e) {
      return NextResponse.json({ error: (e as Error).message }, { status: 500 });
    }
  }

  // ─── Ticket reply notification email ────────────────────────────────────────
  // Sends the customer their "you have a reply" email after ticket_reply.
  if (action === "ticket_notify_reply") {
    const { ticketId, message } = body as { ticketId: string; message: string };
    if (!ticketId || !message) return NextResponse.json({ error: "Missing ticketId or message" }, { status: 400 });
    try {
      const { data: ticket } = await sb().from("support_tickets").select("user_email,user_name,subject").eq("id", ticketId).maybeSingle();
      if (!ticket) return NextResponse.json({ error: "Ticket not found" }, { status: 404 });
      if (!ticket.user_email) return NextResponse.json({ error: "Ticket has no user email" }, { status: 400 });

      const fromEmail = process.env.ADMIN_FROM_EMAIL ?? "support@preciprocal.com";
      const resendKey = process.env.RESEND_API_KEY;
      const shortId   = ticketId.slice(0, 8).toUpperCase();
      const subject   = `[Ticket #${shortId}] Re: ${ticket.subject ?? "Your support ticket"}`;

      if (resendKey) {
        const res = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: { "Authorization": `Bearer ${resendKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            from: fromEmail, to: [ticket.user_email], subject,
            html: `<p>Hi ${ticket.user_name ?? "there"},</p>`
              + `<p>Our support team replied to your ticket <strong>${ticket.subject ?? ""}</strong>:</p>`
              + `<blockquote style="border-left:3px solid #4f46e5;margin:0;padding:8px 16px;color:#374151;white-space:pre-wrap;">${message.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</blockquote>`
              + `<p>Sign in to Preciprocal and go to Help & Support &gt; Tickets to view the full conversation and reply.</p>`
              + `<hr/><small style="color:#9ca3af">Preciprocal Support · Ticket #${shortId}</small>`,
          }),
        });
        if (!res.ok) throw new Error(`Resend error: ${await res.text()}`);
      } else {
        console.log("📧 [DRAFT — no RESEND_API_KEY]\nTo:", ticket.user_email, "\nSubject:", subject);
      }
      return NextResponse.json({ success: true, sent: !!resendKey });
    } catch (e) {
      console.error("❌ ticket_notify_reply error:", e);
      return NextResponse.json({ error: (e as Error).message }, { status: 500 });
    }
  }

  // ── ERP access list: add / remove ─────────────────────────────────────────
  if (action === "access_add") {
    const email = normaliseEmail(String(body.email ?? ""));
    const note  = typeof body.note === "string" && body.note.trim() ? body.note.trim().slice(0, 200) : null;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return NextResponse.json({ error: "Enter a valid email address" }, { status: 400 });
    const { error } = await sb().from("erp_allowed_emails")
      .upsert({ email, note, added_by: admin.email || admin.name }, { onConflict: "email" });
    if (error) return NextResponse.json({ error: `${error.message} (run supabase/erp_schema.sql)` }, { status: 500 });
    return NextResponse.json({ success: true, email });
  }

  if (action === "access_remove") {
    const email = normaliseEmail(String(body.email ?? ""));
    if (!email) return NextResponse.json({ error: "Missing email" }, { status: 400 });
    if (envAllowedEmails().has(email)) {
      return NextResponse.json({ error: "This email comes from ERP_ALLOWED_EMAILS in the server environment and can't be removed here" }, { status: 400 });
    }
    if (admin.email && normaliseEmail(admin.email) === email) {
      return NextResponse.json({ error: "You can't remove your own access" }, { status: 400 });
    }
    const { error } = await sb().from("erp_allowed_emails").delete().eq("email", email);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ success: true });
  }

  const id = body.id as string;
  if (!id) {
    return NextResponse.json({ error: "Missing user id" }, { status: 400 });
  }

  // ── 1. Profile / subscription / usage update from the Users tab ───────────
  if (action === "update") {
    const data = (body.data ?? {}) as Record<string, unknown>;
    try {
      const profile: Record<string, unknown> = {};
      if (typeof data.name     === "string")  profile.name     = data.name;
      if (typeof data.email    === "string")  profile.email    = data.email;
      if (typeof data.provider === "string")  profile.provider = data.provider;
      if (typeof data.isAdmin  === "boolean") profile.is_admin = data.isAdmin;
      if (Object.keys(profile).length) {
        const { error } = await sb().from("profiles").update({ ...profile, updated_at: new Date().toISOString() }).eq("user_id", id);
        if (error) throw new Error(`profiles: ${error.message}`);
      }
      if (data.subscription && typeof data.subscription === "object") {
        const s = data.subscription as Record<string, unknown>;
        // Only the fields the Users tab edits — Stripe-owned fields change via stripe_update.
        await upsertSubscription(sb(), id, subscriptionPatch({ plan: s.plan, status: s.status, studentVerified: s.studentVerified }));
      }
      if (data.usage && typeof data.usage === "object") {
        await writeUsage(sb(), id, data.usage as Record<string, unknown>);
      }
      return NextResponse.json({ success: true });
    } catch (err) {
      return NextResponse.json({ error: (err as Error).message }, { status: 500 });
    }
  }

  // ── 2. Stripe plan / subscription update ──────────────────────────────────
  if (action === "stripe_update") {
    const sd = body.stripeData as {
      priceId?: string; plan?: string;
      periodStart?: string; periodEnd?: string;
      trialEnd?: string; cancelAtPeriodEnd?: boolean;
    };
    try {
      const stripe  = getStripe();
      const [{ data: profile }, { data: subRow }] = await Promise.all([
        sb().from("profiles").select("name,email").eq("user_id", id).maybeSingle(),
        sb().from("subscriptions").select("plan,stripe_customer_id,stripe_subscription_id").eq("user_id", id).maybeSingle(),
      ]);
      if (!profile) return NextResponse.json({ error: "User not found" }, { status: 404 });

      const sub = {
        plan:                 subRow?.plan as string | undefined,
        stripeCustomerId:     subRow?.stripe_customer_id as string | undefined,
        stripeSubscriptionId: subRow?.stripe_subscription_id as string | undefined,
      };
      const subId    = sub.stripeSubscriptionId;
      let updatedSub: Record<string, unknown> = {};

      if (subId && sd.priceId) {
        const existing = await stripe.subscriptions.retrieve(subId);
        const itemId   = existing.items.data[0]?.id;
        const updateParams: Stripe.SubscriptionUpdateParams = {
          items: [{ id: itemId, price: sd.priceId }],
          proration_behavior: "always_invoice",
        };
        if (sd.trialEnd)                       updateParams.trial_end             = Math.floor(new Date(sd.trialEnd).getTime() / 1000);
        if (sd.cancelAtPeriodEnd !== undefined) updateParams.cancel_at_period_end = sd.cancelAtPeriodEnd;
        const updated = await stripe.subscriptions.update(subId, updateParams);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const u = updated as any;
        updatedSub = {
          stripeSubscriptionId: u.id, stripeCustomerId: u.customer as string,
          plan: sd.plan ?? sub.plan, status: u.status,
          currentPeriodStart: new Date((u.current_period_start ?? u.billing_cycle_anchor ?? 0) * 1000).toISOString(),
          currentPeriodEnd:   new Date((u.current_period_end ?? 0) * 1000).toISOString(),
        };
        if (sd.periodStart) updatedSub.currentPeriodStart = new Date(sd.periodStart).toISOString();
        if (sd.periodEnd)   updatedSub.currentPeriodEnd   = new Date(sd.periodEnd).toISOString();
        if (sd.trialEnd)    updatedSub.trialEndsAt        = new Date(sd.trialEnd).toISOString();

      } else if (sd.plan === "free" && subId) {
        const updated = await stripe.subscriptions.update(subId, { cancel_at_period_end: true });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const upd = updated as any;
        updatedSub = {
          plan: "free", status: upd.status, cancelAtPeriodEnd: true,
          canceledAt: new Date().toISOString(),
          subscriptionEndsAt: new Date((upd.current_period_end ?? 0) * 1000).toISOString(),
        };
      } else if (sd.priceId && sd.priceId !== "__free__") {
        const userEmail = (profile.email as string | null) ?? undefined;
        const userName  = (profile.name  as string | null) ?? undefined;
        let custId = sub.stripeCustomerId;
        if (!custId) {
          const customer = await stripe.customers.create({ email: userEmail, name: userName, metadata: { userId: id, supabaseUserId: id } });
          custId = customer.id;
        }
        const createParams: Record<string, unknown> = {
          customer: custId, items: [{ price: sd.priceId }],
          payment_behavior: "default_incomplete", expand: ["latest_invoice.payment_intent"],
        };
        if (sd.trialEnd)          createParams.trial_end            = Math.floor(new Date(sd.trialEnd).getTime() / 1000);
        if (sd.cancelAtPeriodEnd) createParams.cancel_at_period_end = true;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const created = await (stripe.subscriptions.create as any)(createParams);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const c = created as any;
        updatedSub = {
          stripeCustomerId: custId, stripeSubscriptionId: c.id,
          plan: sd.plan ?? sub.plan, status: c.status,
          currentPeriodStart: new Date((c.current_period_start ?? c.billing_cycle_anchor ?? 0) * 1000).toISOString(),
          currentPeriodEnd:   new Date((c.current_period_end ?? 0) * 1000).toISOString(),
        };
        if (sd.trialEnd) updatedSub.trialEndsAt = new Date(sd.trialEnd).toISOString();
      } else {
        updatedSub = { plan: sd.plan ?? sub.plan };
      }

      // cancelAtPeriodEnd has no column — Stripe is the source of truth for it.
      await upsertSubscription(sb(), id, subscriptionPatch(updatedSub));
      return NextResponse.json({ success: true, subscription: updatedSub });
    } catch (err) {
      console.error("❌ stripe_update error:", err);
      return NextResponse.json({ error: (err as Error).message }, { status: 500 });
    }
  }

  // ── 3. Apply coupon ───────────────────────────────────────────────────────
  if (action === "apply_coupon") {
    const couponCode = body.couponCode as string;
    if (!couponCode) return NextResponse.json({ error: "Missing couponCode" }, { status: 400 });
    try {
      const stripe  = getStripe();
      const { data: subRow } = await sb().from("subscriptions")
        .select("stripe_customer_id,stripe_subscription_id").eq("user_id", id).maybeSingle();
      const custId  = subRow?.stripe_customer_id as string | undefined;
      const subId   = subRow?.stripe_subscription_id as string | undefined;
      if (!custId) return NextResponse.json({ error: "No Stripe customer ID on this user" }, { status: 400 });

      let couponId = couponCode;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let couponObj: any = null;
      try {
        const promoCodes = await stripe.promotionCodes.list({ code: couponCode, active: true, limit: 1 });
        if (promoCodes.data.length > 0) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const couponField = (promoCodes.data[0] as any).coupon;
          couponId  = typeof couponField === "object" && couponField?.id ? (couponField.id as string) : typeof couponField === "string" ? couponField : couponCode;
          couponObj = typeof couponField === "object" ? couponField : null;
        }
      } catch { /* fall through */ }

      // Fetch coupon details if not already resolved via promo code — needed to detect 100% off
      if (!couponObj) {
        try { couponObj = await stripe.coupons.retrieve(couponId); } catch { /* may not exist as coupon ID */ }
      }

      if (subId) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await stripe.subscriptions.update(subId, { discounts: [{ coupon: couponId }] } as any);
      } else {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (stripe.customers.update as any)(custId, { coupon: couponId });
      }

      // If the coupon is 100% off, mark the user as studentVerified so all MRR
      // calculations (both Stripe-based and DB-based) consistently exclude them.
      const isFullyFree = (couponObj?.percent_off ?? 0) >= 100;
      if (isFullyFree) await upsertSubscription(sb(), id, { student_verified: true });
      await upsertUserMeta(sb(), id, { last_applied_coupon: couponCode, last_coupon_applied_at: new Date().toISOString() })
        .catch(e => console.error("[apply_coupon] meta write failed:", e));
      return NextResponse.json({ success: true, applied: couponCode, studentVerified: isFullyFree });
    } catch (err) {
      console.error("❌ apply_coupon error:", err);
      return NextResponse.json({ error: (err as Error).message }, { status: 500 });
    }
  }

  // ── 4. Contact user via email ─────────────────────────────────────────────
  if (action === "contact_email") {
    const { subject, body: emailBody, toEmail } = body as { subject: string; body: string; toEmail: string };
    if (!subject || !emailBody || !toEmail) {
      return NextResponse.json({ error: "Missing subject, body, or toEmail" }, { status: 400 });
    }
    const fromEmail = process.env.ADMIN_FROM_EMAIL ?? "support@preciprocal.com";
    const resendKey = process.env.RESEND_API_KEY;
    try {
      if (resendKey) {
        const res = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: { "Authorization": `Bearer ${resendKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            from: fromEmail, to: [toEmail], subject,
            html: `<p>${emailBody.replace(/\n/g, "<br/>")}</p><hr/><small style="color:#9ca3af">Sent from Preciprocal Admin</small>`,
          }),
        });
        if (!res.ok) throw new Error(`Resend error: ${await res.text()}`);
      } else {
        console.log("📧 [DRAFT — no RESEND_API_KEY]\nTo:", toEmail, "\nSubject:", subject, "\nBody:", emailBody);
      }
      await upsertUserMeta(sb(), id, {
        last_contacted_at: new Date().toISOString(), last_contact_subject: subject, last_contact_sent_by: fromEmail,
      }).catch(e => console.error("[contact_email] meta write failed:", e));
      return NextResponse.json({ success: true, sent: !!resendKey, draft: !resendKey });
    } catch (err) {
      console.error("❌ contact_email error:", err);
      return NextResponse.json({ error: (err as Error).message }, { status: 500 });
    }
  }

  return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
}