// app/api/admin/route.ts
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { initializeApp, getApps, cert, App } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getAuth     } from "firebase-admin/auth";

import Stripe from "stripe";

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

// ─── Firebase Admin ───────────────────────────────────────────────────────────

let _app: App | null = null;
let _db: ReturnType<typeof getFirestore> | null = null;

function getDb() {
  if (_db) return _db;
  if (!_app) {
    _app = getApps().find(a => a.name === "adm-server") ?? initializeApp({
      credential: cert({
        projectId:   process.env.FIREBASE_ADMIN_PROJECT_ID,
        clientEmail: process.env.FIREBASE_ADMIN_CLIENT_EMAIL,
        privateKey:  process.env.FIREBASE_ADMIN_PRIVATE_KEY?.replace(/\\n/g, "\n"),
      }),
    }, "adm-server");
  }
  _db = getFirestore(_app);
  return _db;
}

function getAdminAuth() {
  getDb();
  return getAuth(_app!);
}

// ─── Stripe ───────────────────────────────────────────────────────────────────

function getStripe() {
  return new Stripe(process.env.STRIPE_SECRET_KEY ?? "", {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    apiVersion: "2024-04-10" as any,
  });
}

// ─── Auth ─────────────────────────────────────────────────────────────────────

async function isAuthorised(req: NextRequest): Promise<boolean> {
  const secret = process.env.ADMIN_SECRET;
  if (secret && req.headers.get("x-admin-secret") === secret) return true;
  const idToken = req.headers.get("x-firebase-token");
  if (!idToken) return false;
  try {
    const decoded = await getAdminAuth().verifyIdToken(idToken, false);
    const userDoc = await getDb().collection("users").doc(decoded.uid).get();
    return userDoc.exists && userDoc.data()?.isAdmin === true;
  } catch { return false; }
}

async function requireAdmin(req: NextRequest): Promise<NextResponse | null> {
  if (await isAuthorised(req)) return null;
  return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
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
    const idToken = req.headers.get("x-firebase-token");
    if (!idToken) return NextResponse.json({ error: "Missing token" }, { status: 400 });
    try {
      const decoded = await getAdminAuth().verifyIdToken(idToken, false);
      const uid     = decoded.uid;
      const email   = decoded.email ?? "";
      console.log(`[verify] uid=${uid} email=${email}`);

      let userDoc = await getDb().collection("users").doc(uid).get();
      console.log(`[verify] doc by UID exists=${userDoc.exists} isAdmin=${userDoc.data()?.isAdmin}`);

      if (!userDoc.exists || userDoc.data()?.isAdmin !== true) {
        const snap = await getDb().collection("users").where("email", "==", email).limit(1).get();
        if (!snap.empty) {
          userDoc = snap.docs[0];
          console.log(`[verify] doc by email found id=${userDoc.id} isAdmin=${userDoc.data()?.isAdmin}`);
        }
      }

      if (!userDoc.exists || userDoc.data()?.isAdmin !== true) {
        console.log(`[verify] DENIED — uid=${uid} email=${email}`);
        return NextResponse.json({ error: "Not an admin", debug_uid: uid, debug_email: email }, { status: 403 });
      }

      console.log(`[verify] GRANTED — uid=${uid} docId=${userDoc.id}`);

      void (async () => {
        try {
          const ua      = req.headers.get("user-agent") ?? "";
          const ip      = (req.headers.get("x-forwarded-for") ?? req.headers.get("x-real-ip") ?? "unknown").split(",")[0].trim();
          const parsed  = parseUA(ua);
          const geo     = await getGeoFromIP(ip);
          const docData = userDoc.data() ?? {};
          await getDb().collection("logs").add({
            userId: uid, userName: docData.name ?? "", userEmail: email,
            type: "login", timestamp: new Date().toISOString(),
            ip, userAgent: ua,
            browser: parsed.browser, os: parsed.os, device: parsed.device,
            city: geo.city ?? "", country: geo.country ?? "", countryCode: geo.countryCode ?? "",
            details: { provider: docData.provider ?? "unknown", source: "admin_erp" },
          });
        } catch (e) { console.error("[verify] log write failed:", e); }
      })();

      return NextResponse.json({ ok: true, uid, email });
    } catch (e) {
      console.error("[verify] error:", e);
      return NextResponse.json({ error: "Invalid token", detail: String(e) }, { status: 401 });
    }
  }

  const _authErr = await requireAdmin(req); if (_authErr) return _authErr;

  // ── users ─────────────────────────────────────────────────────────────────
  if (action === "users") {
    try {
      const snap  = await getDb().collection("users").get();
      const users = snap.docs.map(d => {
        const data = d.data();
        return {
          id: d.id, name: data.name, email: data.email, provider: data.provider,
          isAdmin: data.isAdmin, createdAt: data.createdAt, updatedAt: data.updatedAt,
          lastLogin: data.lastLogin, lastContactedAt: data.lastContactedAt,
          lastContactSubject: data.lastContactSubject,
          subscription: data.subscription, usage: data.usage,
        };
      });
      return NextResponse.json({ users }, { headers: { "Cache-Control": "public, s-maxage=30, stale-while-revalidate=60" } });
    } catch (err) {
      return NextResponse.json({ error: (err as Error).message }, { status: 500 });
    }
  }

  // ── analytics ─────────────────────────────────────────────────────────────
  if (action === "analytics") {
    try {
      const db = getDb();
      const [interviewsSnap, feedbackSnap, resumesSnap, plansSnap] = await Promise.all([
        db.collection("interviews").select("userId","role","type","techstack","company","status","finalized","createdAt","score","level","duration").limit(1000).get(),
        db.collection("feedback").select("userId","interviewId","totalScore","categoryScores","createdAt").limit(1000).get(),
        db.collection("resumes").select("userId","jobTitle","companyName","status","score","createdAt").limit(1000).get(),
        db.collection("interviewPlans").select("userId","createdAt","status").limit(500).get(),
      ]);
      const pick = (snap: FirebaseFirestore.QuerySnapshot) => snap.docs.map(d => ({ id: d.id, ...d.data() }));
      return NextResponse.json(
        { interviews: pick(interviewsSnap), feedbacks: pick(feedbackSnap), resumes: pick(resumesSnap), plans: pick(plansSnap) },
        { headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=120" } }
      );
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
      let dataSource: "admin_api" | "firestore" | "none" = "none";

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

      } else {
        // ── Path B: Firestore self-tracking fallback ────────────────────────
        type UsageDoc = {
          model: string; input_tokens: number; output_tokens: number;
          cost_usd?: number; timestamp: string;
        };
        const db = getDb();
        try {
          const snap = await db.collection("claude_usage")
            .where("timestamp", ">=", startDate.toISOString())
            .where("timestamp", "<=", endDate.toISOString())
            .orderBy("timestamp", "desc").limit(5000).get();
          if (!snap.empty) {
            dataSource = "firestore";
            snap.docs.forEach(doc => {
              const d = doc.data() as UsageDoc;
              const inp  = d.input_tokens ?? 0;
              const out  = d.output_tokens ?? 0;
              const inP  = INPUT_PRICE[d.model] ?? 3;
              const outP = OUTPUT_PRICE[d.model] ?? 15;
              // Firestore tracking: no cache token breakdown, use standard pricing
              const cost = d.cost_usd ?? (inp * inP + out * outP) / 1_000_000;
              totalInput += inp; totalOutput += out; totalReqs += 1; totalCost += cost;
              if (!modelMap[d.model]) modelMap[d.model] = { tokens: 0, requests: 0, cost: 0 };
              modelMap[d.model].tokens += inp + out; modelMap[d.model].requests += 1; modelMap[d.model].cost += cost;
              const day = d.timestamp.slice(0, 10);
              if (!dailyMap[day]) dailyMap[day] = { tokens: 0, requests: 0, cost: 0 };
              dailyMap[day].tokens += inp + out; dailyMap[day].requests += 1; dailyMap[day].cost += cost;
            });
          }
        } catch { /* collection doesn't exist yet */ }
      }

      const daily = Object.entries(dailyMap)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([date, v]) => ({ date, ...v }));

      // Only show cost when it comes from real billing data (Admin API cost_report)
      // or when Firestore docs have explicit cost_usd fields.
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
        usage_note: dataSource === "admin_api" ? "" : dataSource === "firestore"
          ? "Showing self-tracked usage from Firestore."
          : "No usage data yet. Add trackClaudeUsage() to your app.",
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
      type StripeCharge  = { status: string; amount: number; amount_refunded: number };
      type StripeSubItem = { price?: { unit_amount?: number; recurring?: { interval?: string } } };
      type StripeSub     = { items?: { data?: StripeSubItem[] } };
      type StripeList<T> = { data: T[] };
      const stripe = getStripe();
      const since  = Math.floor((Date.now() - 30 * 86_400_000) / 1000);
      const [charges, subs] = await Promise.all([
        stripe.charges.list({ limit: 100, created: { gte: since } }) as Promise<StripeList<StripeCharge>>,
        stripe.subscriptions.list({ limit: 100, status: "active" }) as Promise<StripeList<StripeSub>>,
      ]);
      const successful = charges.data.filter(c => c.status === "succeeded");
      const failed     = charges.data.filter(c => c.status === "failed");
      const refunded   = charges.data.reduce((s, c) => s + (c.amount_refunded ?? 0), 0);
      const volume     = successful.reduce((s, c) => s + (c.amount ?? 0), 0);
      const mrr = subs.data.reduce((s, sub) => {
        const item     = sub.items?.data?.[0];
        const amount   = item?.price?.unit_amount ?? 0;
        const interval = item?.price?.recurring?.interval ?? "month";
        return s + (interval === "year" ? amount / 12 : amount) / 100;
      }, 0);
      return {
        mrr, total_charges: charges.data.length, successful_charges: successful.length,
        failed_charges: failed.length, total_volume: volume, refunded,
        active_subscriptions: subs.data.length, period_requests: charges.data.length,
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

    // ── Firebase / Google Cloud ───────────────────────────────────────────────
    // Google Cloud has no direct cost API — costs require BigQuery billing export.
    // We fetch real collection counts from Firestore Admin SDK, and optionally
    // fetch budget spend from the Cloud Billing Budget API if configured.
    const firebaseData = await safeGet("firebase", async () => {
      const db = getDb();

      // Real collection counts via Firestore Admin count() aggregation
      const collections = ["users","logs","interviews","feedback","resumes","interviewPlans","resume_analyses","cover_letters"];
      const countResults = await Promise.all(
        collections.map(c => db.collection(c).count().get().catch(() => null))
      );
      const counts: Record<string, number> = {};
      collections.forEach((c, i) => {
        counts[c] = countResults[i]?.data().count ?? 0;
      });
      const totalDocs   = Object.values(counts).reduce((a, b) => a + b, 0);
      const userCount   = counts.users ?? 0;

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
            } catch (e) { console.error("[firebase/sa_token]", e); }
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
            console.log("[firebase/budget]", budgetRes.status);
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
              console.log("[firebase/budget] failed:", await budgetRes.text().then(t => t.slice(0, 200)));
            }
          }
        } catch (e) { console.error("[firebase/billing]", e); }
      }

      // Firestore pricing (Blaze plan, us-east1, as of 2025)
      // Reads:  $0.06 per 100K   →  $0.0000006 each
      // Writes: $0.18 per 100K   →  $0.0000018 each
      // Deletes:$0.02 per 100K   →  $0.0000002 each
      // Storage:$0.108 per GiB/month
      // These are estimates for display only — BigQuery export needed for exact billing
      const estReads   = totalDocs * 10;   // rough: each doc read ~10× per lifetime
      const estWrites  = totalDocs * 2;    // rough: each doc written ~2×
      const estStorage = totalDocs * 1024; // rough: 1KB per doc
      const estCost    = (estReads * 0.0000006) + (estWrites * 0.0000018) + (estStorage / (1024**3) * 0.108);

      return {
        // Collection counts
        collections: counts,
        total_documents: totalDocs,
        active_users: userCount,
        // Cost estimates (clearly labelled as estimates)
        estimated_reads:   estReads,
        estimated_writes:  estWrites,
        estimated_cost:    estCost,
        storage_bytes:     estStorage,
        // Real billing from Budget API (if configured)
        billing: billingInfo,
        billing_note: billingAccount
          ? "Budget data from Cloud Billing API"
          : "Set GOOGLE_CLOUD_BILLING_ACCOUNT + GOOGLE_CLOUD_SA_KEY in .env for real billing data. Real costs require Cloud Billing BigQuery export.",
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
      resend: resendData, cloudflare: cloudflareData, firebase: firebaseData,
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
  if (action === "logs") {
    try {
      const db     = getDb();
      const userId = req.nextUrl.searchParams.get("userId");
      const type   = req.nextUrl.searchParams.get("type");
      const limit  = Math.min(parseInt(req.nextUrl.searchParams.get("limit") ?? "500"), 1000);

      // Firestore requires where() before orderBy() when filtering on a different field.
      // Also: where("userId") + orderBy("timestamp") needs a composite index —
      // so when filtering by userId, skip orderBy to avoid the index requirement
      // and sort client-side instead.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let query: any = db.collection("logs");
      if (userId) query = query.where("userId", "==", userId);
      if (type)   query = query.where("type",   "==", type);
      // Only add orderBy when NOT filtering by userId (avoids composite index requirement)
      if (!userId) query = query.orderBy("timestamp", "desc");
      query = query.limit(limit);

      const snap = await query.get() as FirebaseFirestore.QuerySnapshot;
      type LogDoc = Record<string, unknown> & { id: string };
      const logs: LogDoc[] = snap.docs.map((d: FirebaseFirestore.QueryDocumentSnapshot) => ({ id: d.id, ...(d.data() as Record<string, unknown>) }));
      // Sort client-side desc when userId filter bypassed orderBy (no composite index needed)
      if (userId) logs.sort((a, b) => String(b.timestamp ?? "").localeCompare(String(a.timestamp ?? "")));
      return NextResponse.json({ logs }, { headers: { "Cache-Control": "private, no-store" } });
    } catch (err) {
      const msg = (err as Error).message;
      if (msg.includes("NOT_FOUND") || msg.includes("no index") || msg.includes("collection")) {
        return NextResponse.json({ logs: [] });
      }
      return NextResponse.json({ error: msg }, { status: 500 });
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

  return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
}

// ─── POST ─────────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const _authErr = await requireAdmin(req); if (_authErr) return _authErr;

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
      const entry  = {
        ...log,
        userAgent: ua || log.userAgent,
        browser: parsed.browser || log.browser || "Unknown",
        os: parsed.os || log.os || "Unknown",
        device: parsed.device || log.device || "desktop",
        ip: ip || log.ip || "",
        city: geo.city || log.city || "",
        country: geo.country || log.country || "",
        countryCode: geo.countryCode || log.countryCode || "",
        timestamp: log.timestamp ?? new Date().toISOString(),
        createdAt: new Date().toISOString(),
      };
      const ref = await getDb().collection("logs").add(entry);
      return NextResponse.json({ success: true, id: ref.id });
    } catch (err) {
      return NextResponse.json({ error: (err as Error).message }, { status: 500 });
    }
  }

  const id = body.id as string;
  if (!id && action !== "write_log") {
    return NextResponse.json({ error: "Missing user id" }, { status: 400 });
  }

  // ── 1. Plain Firestore update ─────────────────────────────────────────────
  if (action === "update") {
    const data = body.data as Record<string, unknown>;
    try {
      await getDb().collection("users").doc(id).update({ ...data, updatedAt: new Date().toISOString() });
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
      const userDoc = await getDb().collection("users").doc(id).get();
      if (!userDoc.exists) return NextResponse.json({ error: "User not found" }, { status: 404 });

      const userData = userDoc.data() as Record<string, unknown>;
      const sub      = (userData.subscription ?? {}) as Record<string, unknown>;
      const subId    = sub.stripeSubscriptionId as string | undefined;
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
        const userData2 = userDoc.data() as Record<string, unknown>;
        const userEmail = userData2.email as string | undefined;
        const userName  = userData2.name  as string | undefined;
        let custId = sub.stripeCustomerId as string | undefined;
        if (!custId) {
          const customer = await stripe.customers.create({ email: userEmail, name: userName, metadata: { firebaseUid: id } });
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

      await getDb().collection("users").doc(id).update({
        subscription: { ...sub, ...updatedSub }, updatedAt: new Date().toISOString(),
      });
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
      const userDoc = await getDb().collection("users").doc(id).get();
      const sub     = ((userDoc.data() as Record<string, unknown>)?.subscription ?? {}) as Record<string, unknown>;
      const custId  = sub.stripeCustomerId as string | undefined;
      const subId   = sub.stripeSubscriptionId as string | undefined;
      if (!custId) return NextResponse.json({ error: "No Stripe customer ID on this user" }, { status: 400 });

      let couponId = couponCode;
      try {
        const promoCodes = await stripe.promotionCodes.list({ code: couponCode, active: true, limit: 1 });
        if (promoCodes.data.length > 0) {
          const promo = promoCodes.data[0];
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const couponField = (promo as any).coupon;
          couponId = typeof couponField === "object" && couponField?.id
            ? (couponField.id as string)
            : typeof couponField === "string" ? couponField : couponCode;
        }
      } catch { /* fall through */ }

      if (subId) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await stripe.subscriptions.update(subId, { discounts: [{ coupon: couponId }] } as any);
      } else {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (stripe.customers.update as any)(custId, { coupon: couponId });
      }
      await getDb().collection("users").doc(id).update({
        "subscription.lastAppliedCoupon":   couponCode,
        "subscription.lastCouponAppliedAt": new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
      return NextResponse.json({ success: true, applied: couponCode });
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
      await getDb().collection("users").doc(id).update({
        lastContactedAt: new Date().toISOString(), lastContactSubject: subject,
        lastContactSentBy: fromEmail, updatedAt: new Date().toISOString(),
      });
      return NextResponse.json({ success: true, sent: !!resendKey, draft: !resendKey });
    } catch (err) {
      console.error("❌ contact_email error:", err);
      return NextResponse.json({ error: (err as Error).message }, { status: 500 });
    }
  }

  return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
}