"use client";
// components/admin/UsageTab.tsx

import { useState, useEffect, useCallback, useMemo, useRef, useContext } from "react";
import { Card, SL, useIsMobile, AdminTokenContext } from "./admin-shared";

// ─── Types ────────────────────────────────────────────────────────────────────

interface DailyPoint { date: string; tokens: number; requests: number; cost: number }
interface ModelStat  { model: string; tokens: number; requests: number; cost: number }

interface OpenAIUsage {
  total_tokens: number; prompt_tokens: number; completion_tokens: number;
  total_requests: number; cost_usd: number; period: string;
  daily: DailyPoint[];
  models: ModelStat[];
}
interface ClaudeUsage {
  total_tokens: number; input_tokens: number; output_tokens: number;
  total_requests: number;
  cost_usd: number | null;
  cost_is_estimated?: boolean;
  cost_real?: boolean;
  period: string;
  credit_balance: number | null;
  spend_limit:    number | null;
  usage_note?:    string;
  has_tracking?:  boolean;
  data_source?:   "admin_api" | "firestore" | "none";
  daily?: DailyPoint[];
  model_daily?: Record<string, DailyPoint[]>;
  models: ModelStat[];
}
interface StripeUsage {
  mrr: number; total_charges: number; successful_charges: number;
  failed_charges: number; total_volume: number; refunded: number;
  active_subscriptions: number; period_requests: number;
  pack_purchases?: number; pack_revenue?: number;   // one-time credit packs (cents), last 30 days
}
interface ResendUsage {
  emails_sent: number; emails_delivered: number; emails_bounced: number;
  emails_complained: number; period: string;
}
interface CloudflareUsage {
  requests: number; bandwidth_bytes: number; threats: number;
  cached_requests: number; period: string;
}
interface SupabaseUsage {
  tables:       Record<string, number>;
  total_rows:   number;
  active_users: number;
  project_ref:  string;
  billing: {
    budget_amount?: number;
    budget_spent?:  number;
    budget_name?:   string;
    currency?:      string;
    budget_period?: string;
  } | null;
  billing_note: string;
  period: string;
}
interface GoogleAIUsage {
  total_requests: number; input_tokens: number; output_tokens: number;
  cost_usd: number; models: { model: string; requests: number }[]; period: string;
}
interface AllUsage {
  openai?:      OpenAIUsage    | null;
  claude?:      ClaudeUsage    | null;
  stripe?:      StripeUsage    | null;
  resend?:      ResendUsage    | null;
  cloudflare?:  CloudflareUsage| null;
  supabase?:    SupabaseUsage  | null;
  googleai?:    GoogleAIUsage  | null;
  errors:       Record<string, string>;
  fetchedAt:    string;
  fromCache?:   boolean;
  cachedAt?:    string;
}

interface ServiceLoadingState {
  claude: boolean; openai: boolean; googleai: boolean; stripe: boolean;
  resend: boolean; cloudflare: boolean; supabase: boolean;
}

// ─── Client cache ─────────────────────────────────────────────────────────────
const _cache = new Map<string, { data: AllUsage; ts: number }>();
const TTL = 5 * 60 * 1000;
const _now = new Date();
const DEFAULT_MONTH = `${_now.getFullYear()}-${String(_now.getMonth() + 1).padStart(2, "0")}`;

// ─── Helpers ──────────────────────────────────────────────────────────────────

// Inline so it can't break — Wikimedia blocks hotlinking the OpenAI SVG (ERR_BLOCKED_BY_ORB)
function OpenAIIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="#ededed" role="img" aria-label="OpenAI">
      <path d="M22.2819 9.8211a5.9847 5.9847 0 0 0-.5157-4.9108 6.0462 6.0462 0 0 0-6.5098-2.9A6.0651 6.0651 0 0 0 4.9807 4.1818a5.9847 5.9847 0 0 0-3.9977 2.9 6.0462 6.0462 0 0 0 .7427 7.0966 5.98 5.98 0 0 0 .511 4.9107 6.051 6.051 0 0 0 6.5146 2.9001A5.9847 5.9847 0 0 0 13.2599 24a6.0557 6.0557 0 0 0 5.7718-4.2058 5.9894 5.9894 0 0 0 3.9977-2.9001 6.0557 6.0557 0 0 0-.7475-7.0729zm-9.022 12.6081a4.4755 4.4755 0 0 1-2.8764-1.0408l.1419-.0804 4.7783-2.7582a.7948.7948 0 0 0 .3927-.6813v-6.7369l2.02 1.1686a.071.071 0 0 1 .038.052v5.5826a4.504 4.504 0 0 1-4.4945 4.4944zm-9.6607-4.1254a4.4708 4.4708 0 0 1-.5346-3.0137l.142.0852 4.783 2.7582a.7712.7712 0 0 0 .7806 0l5.8428-3.3685v2.3324a.0804.0804 0 0 1-.0332.0615L9.74 19.9502a4.4992 4.4992 0 0 1-6.1408-1.6464zM2.3408 7.8956a4.485 4.485 0 0 1 2.3655-1.9728V11.6a.7664.7664 0 0 0 .3879.6765l5.8144 3.3543-2.0201 1.1685a.0757.0757 0 0 1-.071 0l-4.8303-2.7865A4.504 4.504 0 0 1 2.3408 7.872zm16.5963 3.8558L13.1038 8.364 15.1192 7.2a.0757.0757 0 0 1 .071 0l4.8303 2.7913a4.4944 4.4944 0 0 1-.6765 8.1042v-5.6772a.79.79 0 0 0-.407-.667zm2.0107-3.0231l-.142-.0852-4.7735-2.7818a.7759.7759 0 0 0-.7854 0L9.409 9.2297V6.8974a.0662.0662 0 0 1 .0284-.0615l4.8303-2.7866a4.4992 4.4992 0 0 1 6.6802 4.66zM8.3065 12.863l-2.02-1.1638a.0804.0804 0 0 1-.038-.0567V6.0742a4.4992 4.4992 0 0 1 7.3757-3.4537l-.142.0805L8.704 5.459a.7948.7948 0 0 0-.3927.6813zm1.0976-2.3654l2.602-1.4998 2.6069 1.4998v2.9994l-2.5974 1.4997-2.6067-1.4997Z" />
    </svg>
  );
}

function fmtNum(n: number): string {
  if (!isFinite(n) || isNaN(n)) return "0";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000)     return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}
function fmtBytes(b: number): string {
  if (b >= 1e9) return `${(b / 1e9).toFixed(2)} GB`;
  if (b >= 1e6) return `${(b / 1e6).toFixed(1)} MB`;
  if (b >= 1e3) return `${(b / 1e3).toFixed(1)} KB`;
  return `${b} B`;
}
function fmtCost(usd: number | null | undefined): string {
  const n = usd ?? 0;
  if (!isFinite(n) || isNaN(n)) return "$0.00";
  return `$${n.toFixed(2)}`;
}
function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
function buildMonthOptions() {
  const opts: { value: string; label: string }[] = [];
  const now = new Date();
  for (let i = 0; i < 13; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const val = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    opts.push({ value: val, label: d.toLocaleDateString("en-US", { month: "short", year: "numeric" }) });
  }
  return opts;
}
const MONTH_OPTIONS = buildMonthOptions();
const SKELETON_BAR_HEIGHTS = [38, 52, 29, 61, 44, 33, 56, 47, 22, 64, 41, 35, 58, 26, 50, 43, 30, 62, 48, 37];

// ─── Skeleton shimmer ─────────────────────────────────────────────────────────

function SkeletonLine({ w = "100%", h = 10, className = "" }: { w?: string | number; h?: number; className?: string }) {
  return (
    <div
      className={`skeleton rounded ${className}`}
      style={{ width: w, height: h }}
    />
  );
}

function CardSkeleton({ name, icon, color }: { name: string; icon: React.ReactNode; color: string }) {
  return (
    <Card>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0 bg-[#111] border border-[#2a2a2a]">
            {icon}
          </div>
          <div className="flex flex-col gap-1.5">
            <div className="text-[14px] font-bold text-[#ededed]">{name}</div>
            <div className="flex items-center gap-1.5">
              <div className="w-1.5 h-1.5 rounded-full skeleton" />
              <SkeletonLine w={70} h={8} />
            </div>
          </div>
        </div>
        <div
          className="w-4 h-4 rounded-full border-2 border-[#2a2a2a] animate-spin shrink-0"
          style={{ borderTopColor: color }}
        />
      </div>
      <div className="grid grid-cols-2 gap-2 mb-4">
        {[0, 1].map(i => (
          <div key={i} className="bg-[#111] rounded-lg p-2.5 flex flex-col items-center gap-1.5">
            <SkeletonLine w="60%" h={20} />
            <SkeletonLine w="50%" h={8} />
          </div>
        ))}
      </div>
      {[0, 1, 2].map(i => (
        <div key={i} className="flex items-center justify-between py-1.5 border-b border-[#111] last:border-0">
          <SkeletonLine w="35%" h={9} />
          <SkeletonLine w="25%" h={9} />
        </div>
      ))}
      <div className="mt-4">
        <SkeletonLine w="40%" h={8} className="mb-2" />
        <div className="flex items-end gap-0.5 h-16 w-full">
          {Array.from({ length: 20 }).map((_, i) => (
            <div
              key={i}
              className="flex-1 rounded-t-sm skeleton"
              style={{
                height: `${SKELETON_BAR_HEIGHTS[i % SKELETON_BAR_HEIGHTS.length]}px`,
                background: color + "30",
              }}
            />
          ))}
        </div>
      </div>
    </Card>
  );
}

// ─── Shared primitives ────────────────────────────────────────────────────────

function StatusPill({ status }: { status: "connected" | "error" | "unconfigured" }) {
  const map = {
    connected:    { cls: "bg-[rgba(62,207,142,0.08)] text-[#3ecf8e] border-[rgba(62,207,142,0.2)]",  dot: "bg-[#3ecf8e]",  label: "Connected"      },
    error:        { cls: "bg-[rgba(255,68,68,0.08)] text-[#f44] border-[rgba(255,68,68,0.2)]",        dot: "bg-[#f44]",     label: "Error"          },
    unconfigured: { cls: "bg-[#111] text-[#555] border-[#2a2a2a]",                                    dot: "bg-[#333]",     label: "Not configured" },
  }[status];
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold border ${map.cls}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${map.dot}`} />
      {map.label}
    </span>
  );
}

function StatRow({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="flex items-center justify-between py-1.5 border-b border-[#111] last:border-0">
      <span className="text-[12px] text-[#888]">{label}</span>
      <div className="text-right">
        <span className="text-[13px] font-bold text-[#ededed]">{value}</span>
        {sub && <div className="text-[11px] text-[#555]">{sub}</div>}
      </div>
    </div>
  );
}

function BigStats({ items }: { items: { label: string; value: string; color: string }[] }) {
  return (
    <div className="grid gap-2 mb-3" style={{ gridTemplateColumns: `repeat(${items.length}, 1fr)` }}>
      {items.map(s => (
        <div key={s.label} className="bg-[#111] border border-[#1a1a1a] rounded-lg p-2.5 text-center">
          <div className="text-[18px] font-extrabold leading-tight" style={{ color: s.color }}>{s.value}</div>
          <div className="text-[11px] text-[#888] leading-tight mt-0.5">{s.label}</div>
        </div>
      ))}
    </div>
  );
}

function MiniBarChart({ data, color, valueKey = "tokens" }: {
  data: DailyPoint[]; color: string; valueKey?: "tokens" | "requests" | "cost";
}) {
  if (!data.length) return null;
  const vals = data.map(d => d[valueKey] ?? 0);
  const max  = Math.max(...vals, 1);
  const fmt  = valueKey === "cost" ? fmtCost : fmtNum;
  return (
    <div className="mt-3">
      <div className="flex items-end gap-0.5 h-16 w-full">
        {data.map((d, i) => {
          const h = Math.max(2, Math.round((vals[i] / max) * 64));
          const isLast = i === data.length - 1;
          return (
            <div key={d.date} className="flex-1 flex flex-col items-center group relative" style={{ height: 64 }}>
              <div className="absolute bottom-0 w-full rounded-t-sm"
                style={{ height: `${h}px`, background: isLast ? color : color + "70" }} />
              <div className="absolute bottom-full mb-1 left-1/2 -translate-x-1/2 bg-[#1a1a1a] border border-[#2a2a2a] text-[#ededed] text-[11px] px-1.5 py-0.5 rounded whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none z-20">
                {fmtDate(d.date)}: {fmt(vals[i])}
              </div>
            </div>
          );
        })}
      </div>
      {data.length >= 3 && (
        <div className="flex justify-between mt-0.5">
          <span className="text-[11px] text-[#333]">{fmtDate(data[0].date)}</span>
          <span className="text-[11px] text-[#333]">{fmtDate(data[Math.floor(data.length / 2)].date)}</span>
          <span className="text-[11px] text-[#333]">{fmtDate(data[data.length - 1].date)}</span>
        </div>
      )}
    </div>
  );
}

function ModelBar({ model, tokens, totalTokens, cost, requests, color }: {
  model: string; tokens: number; totalTokens: number; cost: number; requests: number; color: string;
}) {
  const pct = totalTokens > 0 ? Math.round((tokens / totalTokens) * 100) : 0;
  return (
    <div className="mb-1.5 last:mb-0">
      <div className="flex justify-between text-[11px] mb-0.5">
        <span className="text-[#888] font-mono truncate max-w-[160px]" title={model}>{model}</span>
        <div className="flex gap-2 shrink-0 text-[#555]">
          <span>{fmtNum(requests)} req</span>
          <span>{fmtCost(cost)}</span>
          <span className="font-bold text-[#ededed]">{fmtNum(tokens)}</span>
        </div>
      </div>
      <div className="h-1 bg-[#1a1a1a] rounded-full overflow-hidden">
        <div className="h-full rounded-full" style={{ width: `${pct}%`, background: color }} />
      </div>
    </div>
  );
}

function CardLoadingDot({ color }: { color: string }) {
  return (
    <div
      className="w-3.5 h-3.5 rounded-full border-2 border-[#2a2a2a] animate-spin shrink-0"
      style={{ borderTopColor: color }}
    />
  );
}

function APICard({
  name, icon, color, status, error, loading, children, headerExtra,
}: {
  name: string; icon: React.ReactNode; color: string;
  status: "connected" | "error" | "unconfigured";
  error?: string; loading: boolean; children?: React.ReactNode;
  headerExtra?: React.ReactNode;
}) {
  return (
    <Card>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0 bg-[#111] border border-[#2a2a2a]">
            {icon}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <div className="text-[14px] font-bold text-[#ededed]">{name}</div>
              {loading && <CardLoadingDot color={color} />}
            </div>
            {!loading && <StatusPill status={status} />}
            {loading  && <div className="text-[11px] text-[#555] mt-0.5">Loading…</div>}
          </div>
        </div>
        {headerExtra && <div className="shrink-0">{headerExtra}</div>}
      </div>

      {loading ? (
        <div className="space-y-2 py-2">
          <div className="grid grid-cols-2 gap-2 mb-1">
            {[0, 1].map(i => (
              <div key={i} className="bg-[#111] rounded-lg p-2.5 flex flex-col items-center gap-1.5">
                <SkeletonLine w="60%" h={18} />
                <SkeletonLine w="50%" h={8} />
              </div>
            ))}
          </div>
          {[0, 1, 2].map(i => (
            <div key={i} className="flex items-center justify-between py-1">
              <SkeletonLine w="38%" h={9} />
              <SkeletonLine w="22%" h={9} />
            </div>
          ))}
        </div>
      ) : status === "unconfigured" ? (
        <div className="text-[13px] text-[#555] py-3 text-center">API key not set in environment</div>
      ) : status === "error" ? (
        <div className="text-[13px] text-[#f44] py-2 bg-[rgba(255,68,68,0.06)] border border-[rgba(255,68,68,0.15)] rounded-lg px-3 break-all">{error}</div>
      ) : children}
    </Card>
  );
}

function ExpandToggle({ expanded, onToggle }: { expanded: boolean; onToggle: () => void }) {
  return (
    <button onClick={onToggle}
      className="mt-2 w-full flex items-center justify-center gap-1 text-[11px] text-[#555] hover:text-[#888] border-none bg-transparent cursor-pointer py-1 transition-colors">
      <svg width="10" height="10" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"
        style={{ transform: expanded ? "rotate(180deg)" : "none", transition: "transform .15s" }}>
        <polyline points="6 9 12 15 18 9" />
      </svg>
      {expanded ? "Show less" : "Show more"}
    </button>
  );
}

// ─── Custom themed dropdown ───────────────────────────────────────────────────

function CustomSelect({ value, onChange, options, className = "", prefix }: {
  value: string; onChange: (v: string) => void;
  options: { value: string; label: string }[];
  className?: string; prefix?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const selected = options.find(o => o.value === value);

  return (
    <div ref={ref} className={`relative shrink-0 ${className}`}>
      <button onClick={() => setOpen(o => !o)}
        className="flex items-center gap-1.5 px-2.5 py-1.5 text-[12px] text-[#888] bg-[#0a0a0a] border border-[#2a2a2a] rounded-lg cursor-pointer hover:border-[#555] hover:text-[#ededed] transition-colors w-full text-left font-[inherit] whitespace-nowrap">
        {prefix && <span className="shrink-0">{prefix}</span>}
        <span className="flex-1 truncate">{selected?.label ?? value}</span>
        <svg width="9" height="9" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"
          style={{ flexShrink: 0, transform: open ? "rotate(180deg)" : "none", transition: "transform 0.12s" }}>
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
      {open && (
        <div className="absolute top-[calc(100%+4px)] left-0 min-w-full bg-[#0a0a0a] border border-[#2a2a2a] rounded-lg overflow-hidden z-50"
          style={{ boxShadow: "0 8px 24px rgba(0,0,0,0.5)" }}>
          {options.map(o => (
            <button key={o.value} onClick={() => { onChange(o.value); setOpen(false); }}
              className={`w-full text-left px-3 py-2 text-[12px] cursor-pointer transition-colors border-none font-[inherit] block whitespace-nowrap ${
                o.value === value ? "bg-[#1a1a1a] text-[#ededed]" : "bg-transparent text-[#888] hover:bg-[#111] hover:text-[#ededed]"
              }`}>
              {o.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Individual cards ─────────────────────────────────────────────────────────

function ClaudeCard({ data, error, loading }: {
  data?: ClaudeUsage | null; error?: string; loading: boolean;
}) {
  const [selectedModel, setSelectedModel] = useState("all");
  const [expanded, setExpanded] = useState(false);
  const status     = !data && !error ? "unconfigured" : error ? "error" : "connected";
  const realModels = (data?.models ?? []).filter(m => m.model && m.tokens > 0);
  const hasTokens  = (data?.total_tokens ?? 0) > 0;

  const tt  = data?.total_tokens  ?? 0;
  const inp = data?.input_tokens  ?? 0;
  const out = data?.output_tokens ?? 0;
  const inR = tt > 0 ? inp / tt : 0.6;
  const outR = tt > 0 ? out / tt : 0.4;
  const fm  = realModels.find(m => m.model === selectedModel);
  const mTok = fm?.tokens ?? 0;

  const dispTok  = selectedModel === "all" ? tt      : mTok;
  const dispInp  = selectedModel === "all" ? inp     : Math.round(mTok * inR);
  const dispOut  = selectedModel === "all" ? out     : Math.round(mTok * outR);
  const dispReq  = selectedModel === "all" ? (data?.total_requests ?? 0) : (fm?.requests ?? 0);
  const dispCost = selectedModel === "all" ? (data?.cost_usd ?? null)    : (fm?.cost ?? null);
  const daily    = selectedModel === "all" ? (data?.daily ?? []) : (data?.model_daily?.[selectedModel] ?? []);
  const spendPct = data?.spend_limit ? Math.min(100, Math.round(((data.cost_usd ?? 0) / data.spend_limit) * 100)) : null;

  const headerExtra = realModels.length > 1 && !loading ? (
    <CustomSelect
      value={selectedModel}
      onChange={setSelectedModel}
      options={[
        { value: "all", label: "All models" },
        ...realModels.map(m => ({ value: m.model, label: m.model.replace("claude-", "").replace(/-20\d{6}$/, "") })),
      ]}
      className="max-w-30"
    />
  ) : null;

  return (
    <APICard name="Claude" color="#D97706" status={status} error={error} loading={loading}
      headerExtra={headerExtra}
      icon={<img src="https://cdn.simpleicons.org/anthropic/D97706" width="20" height="20" alt="Anthropic" />}>
      {data && (
        <>
          <BigStats items={[
            { label: "Total tokens", value: fmtNum(dispTok),                                    color: "#D97706" },
            { label: "Billed",       value: data.cost_usd === null ? "—" : fmtCost(dispCost),   color: "#f5a623" },
          ]} />
          {data.cost_usd === null && (
            <div className="mb-2 px-3 py-2 bg-[#111] border border-[#2a2a2a] rounded-lg">
              <div className="text-[12px] font-bold text-[#888] mb-0.5">Cost unavailable</div>
              <div className="text-[11px] text-[#555] leading-relaxed">
                Add <code className="bg-[#1a1a1a] px-1 rounded font-mono">ANTHROPIC_ADMIN_KEY=sk-ant-admin...</code> to your <code className="bg-[#1a1a1a] px-1 rounded font-mono">.env</code> to see real billed costs from the Anthropic billing API.
              </div>
            </div>
          )}

          {data.credit_balance !== null && selectedModel === "all" && (
            <div className="flex items-center justify-between py-1.5 mb-1 bg-[rgba(245,166,35,0.06)] border border-[rgba(245,166,35,0.15)] rounded-lg px-2.5">
              <span className="text-[12px] text-[#f5a623] font-medium">Credit balance</span>
              <span className="text-[14px] font-bold text-[#f5a623]">${(data.credit_balance ?? 0).toFixed(2)}</span>
            </div>
          )}

          {spendPct !== null && data.spend_limit != null && selectedModel === "all" && (
            <div className="mb-2">
              <div className="flex justify-between text-[11px] text-[#555] mb-1">
                <span>Limit ${data.spend_limit.toFixed(0)}/mo</span>
                <span>{spendPct}% used</span>
              </div>
              <div className="h-1.5 bg-[#1a1a1a] rounded-full overflow-hidden">
                <div className="h-full rounded-full"
                  style={{ width: `${spendPct}%`, background: spendPct > 80 ? "#f44" : spendPct > 50 ? "#f5a623" : "#3ecf8e" }} />
              </div>
            </div>
          )}

          <StatRow label="Requests"      value={fmtNum(dispReq)}  sub={data.period} />
          <StatRow label="Input tokens"  value={fmtNum(dispInp)} />
          <StatRow label="Output tokens" value={fmtNum(dispOut)} />
          {dispReq > 0 && dispCost !== null && <StatRow label="Avg cost / req" value={fmtCost(dispCost / dispReq)} />}

          {daily.length > 0 && hasTokens && (
            <>
              <div className="text-[11px] text-[#555] mt-3 mb-1">
                Daily tokens · {selectedModel !== "all" ? selectedModel.replace("claude-", "").replace(/-\d{8}$/, "") : "all models"} · {daily.length}d
              </div>
              <MiniBarChart data={daily} color="#D97706" valueKey="tokens" />
            </>
          )}

          <ExpandToggle expanded={expanded} onToggle={() => setExpanded(e => !e)} />
          {expanded && (
            <div className="mt-2 pt-2 border-t border-[#111]">
              {daily.length > 0 && daily.some(d => d.cost > 0) && (
                <>
                  <div className="text-[11px] text-[#555] mb-1">Daily cost</div>
                  <MiniBarChart data={daily} color="#f5a623" valueKey="cost" />
                </>
              )}
              {selectedModel === "all" && realModels.length > 0 && hasTokens && (
                <div className="mt-3">
                  <div className="text-[11px] text-[#555] mb-1.5">By model</div>
                  {realModels.slice(0, 6).map(m => (
                    <ModelBar key={m.model}
                      model={m.model.replace("claude-", "").replace(/-20\d{6}$/, "")}
                      tokens={m.tokens} totalTokens={dispTok}
                      cost={m.cost} requests={m.requests} color="#D97706" />
                  ))}
                </div>
              )}
              <div className="mt-3">
                <StatRow label="I/O ratio" value={`${Math.round((dispInp / Math.max(dispTok, 1)) * 100)}% in / ${Math.round((dispOut / Math.max(dispTok, 1)) * 100)}% out`} />
                {dispCost !== null && dispReq > 0 && <StatRow label="Avg cost / req" value={fmtCost(dispCost / dispReq)} />}
                <StatRow label="Avg tokens / req" value={dispReq > 0 ? fmtNum(Math.round(dispTok / dispReq)) : "—"} />
                {daily.length > 0 && <StatRow label="Active days" value={String(daily.filter(d => d.tokens > 0).length)} sub={`of ${daily.length}`} />}
                {daily.length > 0 && <StatRow label="Peak day"    value={fmtNum(Math.max(...daily.map(d => d.tokens)))} />}
              </div>
              {!data.has_tracking && data.data_source !== "admin_api" && (
                <div className="mt-3 px-3 py-2.5 bg-[rgba(0,112,243,0.06)] border border-[rgba(0,112,243,0.15)] rounded-lg">
                  <div className="text-[12px] font-bold text-[#0070f3] mb-1">API key valid ✓ - add usage tracking</div>
                  <div className="text-[12px] text-[#0070f3]/80 leading-relaxed">
                    Call <code className="bg-[rgba(0,112,243,0.1)] px-1 rounded font-mono">trackClaudeUsage()</code> in your app - see <code className="bg-[rgba(0,112,243,0.1)] px-1 rounded font-mono">lib/trackClaudeUsage.ts</code>
                  </div>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </APICard>
  );
}

function OpenAICard({ data, error, loading }: {
  data?: OpenAIUsage | null; error?: string; loading: boolean;
}) {
  const [selectedModel, setSelectedModel] = useState("all");
  const [expanded, setExpanded] = useState(false);
  const status     = !data && !error ? "unconfigured" : error ? "error" : "connected";
  const realModels = (data?.models ?? []).filter(m => m.model && m.model !== "unknown" && m.tokens > 0);
  const hasTokens  = (data?.total_tokens ?? 0) > 0;

  const tt  = data?.total_tokens ?? 0;
  const prm = data?.prompt_tokens ?? 0;
  const cmp = data?.completion_tokens ?? 0;
  const pR  = tt > 0 ? prm / tt : 0.6;
  const cR  = tt > 0 ? cmp / tt : 0.4;
  const fm  = realModels.find(m => m.model === selectedModel);
  const mTok = fm?.tokens ?? 0;

  const dispTok  = selectedModel === "all" ? tt      : mTok;
  const dispReq  = selectedModel === "all" ? (data?.total_requests ?? 0) : (fm?.requests ?? 0);
  const dispCost = selectedModel === "all" ? (data?.cost_usd ?? 0)       : (fm?.cost ?? 0);
  const dispPrm  = selectedModel === "all" ? prm     : Math.round(mTok * pR);
  const dispCmp  = selectedModel === "all" ? cmp     : Math.round(mTok * cR);
  const daily    = data?.daily ?? [];

  const headerExtra = realModels.length > 1 && !loading ? (
    <CustomSelect
      value={selectedModel}
      onChange={setSelectedModel}
      options={[
        { value: "all", label: "All models" },
        ...realModels.map(m => ({ value: m.model, label: m.model.replace(/^gpt-/, "").replace(/-\d{4}-\d{2}-\d{2}$/, "") })),
      ]}
      className="max-w-30"
    />
  ) : null;

  return (
    <APICard name="OpenAI" color="#10A37F" status={status} error={error} loading={loading}
      headerExtra={headerExtra}
      icon={<OpenAIIcon />}>
      {data && (
        <>
          <BigStats items={[
            { label: "Total tokens", value: fmtNum(dispTok),   color: "#10A37F" },
            { label: "Billed",       value: fmtCost(dispCost), color: "#3ecf8e" },
          ]} />

          <StatRow label="Requests"          value={fmtNum(dispReq)}  sub={data.period} />
          <StatRow label="Prompt tokens"     value={fmtNum(dispPrm)} />
          <StatRow label="Completion tokens" value={fmtNum(dispCmp)} />
          {dispReq > 0 && <StatRow label="Avg cost / req" value={fmtCost(dispCost / dispReq)} />}

          {daily.length > 0 && hasTokens && (
            <>
              <div className="text-[11px] text-[#555] mt-3 mb-1">Daily tokens · {daily.length}d</div>
              <MiniBarChart data={daily} color="#10A37F" valueKey="tokens" />
            </>
          )}

          <ExpandToggle expanded={expanded} onToggle={() => setExpanded(e => !e)} />
          {expanded && (
            <div className="mt-2 pt-2 border-t border-[#111]">
              {daily.length > 0 && daily.some(d => d.cost > 0) && (
                <>
                  <div className="text-[11px] text-[#555] mb-1">Daily cost</div>
                  <MiniBarChart data={daily} color="#3ecf8e" valueKey="cost" />
                </>
              )}
              {selectedModel === "all" && realModels.length > 0 && hasTokens && (
                <div className="mt-3">
                  <div className="text-[11px] text-[#555] mb-1.5">By model</div>
                  {realModels.slice(0, 6).map(m => (
                    <ModelBar key={m.model}
                      model={m.model.replace(/^gpt-/, "").replace(/-\d{4}-\d{2}-\d{2}$/, "")}
                      tokens={m.tokens} totalTokens={dispTok}
                      cost={m.cost} requests={m.requests} color="#10A37F" />
                  ))}
                </div>
              )}
              <div className="mt-3">
                <StatRow label="P/C ratio" value={`${Math.round((dispPrm / Math.max(dispTok, 1)) * 100)}% prompt / ${Math.round((dispCmp / Math.max(dispTok, 1)) * 100)}% completion`} />
                <StatRow label="Avg tokens / req" value={dispReq > 0 ? fmtNum(Math.round(dispTok / dispReq)) : "—"} />
                {daily.length > 0 && <StatRow label="Active days" value={String(daily.filter(d => d.tokens > 0).length)} sub={`of ${daily.length}`} />}
                {daily.length > 0 && <StatRow label="Peak day"    value={fmtNum(Math.max(...daily.map(d => d.tokens)))} />}
              </div>
            </div>
          )}
        </>
      )}
    </APICard>
  );
}

function GoogleAICard({ data, error, loading }: { data?: GoogleAIUsage | null; error?: string; loading: boolean }) {
  const status = !data && !error ? "unconfigured" : error ? "error" : "connected";
  return (
    <APICard name="Gemini" color="#4285F4" status={status} error={error} loading={loading}
      icon={<img src="https://cdn.simpleicons.org/googlegemini/4285F4" width="20" height="20" alt="Google Gemini" />}>
      {data && (
        <>
          <BigStats items={[
            { label: "Requests", value: fmtNum(data.total_requests), color: "#4285F4" },
            { label: "Billed",   value: fmtCost(data.cost_usd),      color: "#0070f3" },
          ]} />
          <StatRow label="Input tokens"  value={fmtNum(data.input_tokens)}  sub={data.period} />
          <StatRow label="Output tokens" value={fmtNum(data.output_tokens)} />
          <div className="mt-2 p-2.5 bg-[rgba(0,112,243,0.06)] border border-[rgba(0,112,243,0.12)] rounded-lg">
            <div className="text-[11px] font-bold text-[#0070f3] mb-1">No usage API available</div>
            <div className="text-[11px] text-[#0070f3]/70 leading-relaxed">Google AI Studio doesn&apos;t expose a public usage API. Key validated ✓</div>
          </div>
          {data.models.length > 0 && (
            <div className="mt-2">
              <div className="text-[11px] text-[#555] mb-1">Available models</div>
              {data.models.slice(0, 4).map(m => (
                <div key={m.model} className="flex items-center justify-between py-1 border-b border-[#111] last:border-0">
                  <span className="text-[11px] text-[#888] font-mono truncate max-w-[180px]">{m.model.replace("models/", "")}</span>
                  <span className="text-[11px] text-[#3ecf8e] font-bold">✓</span>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </APICard>
  );
}

function StripeCard({ data, error, loading }: { data?: StripeUsage | null; error?: string; loading: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const status = !data && !error ? "unconfigured" : error ? "error" : "connected";
  const successRate = data ? Math.round((data.successful_charges / Math.max(data.total_charges, 1)) * 100) : 0;
  return (
    <APICard name="Stripe" color="#635BFF" status={status} error={error} loading={loading}
      icon={<img src="https://cdn.simpleicons.org/stripe/635BFF" width="20" height="20" alt="Stripe" />}>
      {data && (
        <>
          <BigStats items={[
            { label: "MRR",    value: `$${data.mrr.toFixed(2)}`,                  color: "#635BFF" },
            { label: "Volume", value: `$${(data.total_volume / 100).toFixed(2)}`, color: "#0070f3" },
          ]} />
          <StatRow label="Active subscriptions" value={String(data.active_subscriptions)} />
          {data.pack_purchases !== undefined && (
            <StatRow label="Credit packs (30d)" value={`$${((data.pack_revenue ?? 0) / 100).toFixed(2)}`} sub={`${data.pack_purchases} sold`} />
          )}
          <StatRow label="Successful charges"   value={String(data.successful_charges)} sub="last 30d" />
          <StatRow label="Failed charges"       value={String(data.failed_charges)} />
          <StatRow label="Refunded"             value={`$${(data.refunded / 100).toFixed(2)}`} />

          <ExpandToggle expanded={expanded} onToggle={() => setExpanded(e => !e)} />
          {expanded && (
            <div className="mt-2 pt-2 border-t border-[#111]">
              <StatRow label="Success rate"    value={`${successRate}%`} />
              <StatRow label="Total charges"   value={String(data.total_charges)} />
              <StatRow label="Net revenue"     value={`$${((data.total_volume - data.refunded) / 100).toFixed(2)}`} />
              <StatRow label="Annual run rate" value={`$${(data.mrr * 12).toFixed(2)}`} />
              <div className="mt-2">
                <div className="text-[11px] text-[#555] mb-1">Charge success rate</div>
                <div className="h-2 bg-[#1a1a1a] rounded-full overflow-hidden flex">
                  <div className="h-full bg-[#3ecf8e] rounded-l-full" style={{ width: `${successRate}%` }} />
                  <div className="h-full bg-[rgba(255,68,68,0.3)] flex-1" />
                </div>
                <div className="flex justify-between text-[11px] mt-0.5 text-[#555]">
                  <span>Success ({successRate}%)</span>
                  <span>Failed ({100 - successRate}%)</span>
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </APICard>
  );
}

function ResendCard({ data, error, loading }: { data?: ResendUsage | null; error?: string; loading: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const rate       = data ? Math.round((data.emails_delivered / Math.max(data.emails_sent, 1)) * 100) : 0;
  const bounceRate = data ? Math.round((data.emails_bounced  / Math.max(data.emails_sent, 1)) * 100) : 0;
  const status = !data && !error ? "unconfigured" : error ? "error" : "connected";
  return (
    <APICard name="Resend" color="#ededed" status={status} error={error} loading={loading}
      icon={<img src="https://cdn.simpleicons.org/resend/ededed" width="20" height="20" alt="Resend" />}>
      {data && (
        <>
          <BigStats items={[
            { label: "Sent",     value: fmtNum(data.emails_sent), color: "#ededed" },
            { label: "Delivery", value: `${rate}%`,               color: rate > 95 ? "#3ecf8e" : rate > 80 ? "#f5a623" : "#f44" },
          ]} />
          <StatRow label="Delivered"       value={fmtNum(data.emails_delivered)} sub={`${rate}% rate · ${data.period}`} />
          <StatRow label="Bounced"         value={String(data.emails_bounced)}   sub={`${bounceRate}% bounce`} />
          <StatRow label="Spam complaints" value={String(data.emails_complained)} />

          <ExpandToggle expanded={expanded} onToggle={() => setExpanded(e => !e)} />
          {expanded && (
            <div className="mt-2 pt-2 border-t border-[#111]">
              <StatRow label="Unaccounted" value={String(data.emails_sent - data.emails_delivered - data.emails_bounced - data.emails_complained)} />
              <div className="mt-2">
                <div className="text-[11px] text-[#555] mb-1.5">Email funnel</div>
                {[
                  { label: "Sent",       val: data.emails_sent,       pct: 100,        color: "#ededed" },
                  { label: "Delivered",  val: data.emails_delivered,   pct: rate,       color: "#3ecf8e" },
                  { label: "Bounced",    val: data.emails_bounced,     pct: bounceRate, color: "#f44"    },
                  { label: "Complained", val: data.emails_complained,  pct: Math.round(data.emails_complained / Math.max(data.emails_sent, 1) * 100), color: "#f5a623" },
                ].map(row => (
                  <div key={row.label} className="mb-1.5 last:mb-0">
                    <div className="flex justify-between text-[11px] mb-0.5">
                      <span className="text-[#888]">{row.label}</span>
                      <span className="font-bold text-[#ededed]">{row.val} <span className="text-[#555] font-normal">({row.pct}%)</span></span>
                    </div>
                    <div className="h-1 bg-[#1a1a1a] rounded-full overflow-hidden">
                      <div className="h-full rounded-full" style={{ width: `${row.pct}%`, background: row.color }} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </APICard>
  );
}

function CloudflareCard({ data, error, loading }: { data?: CloudflareUsage | null; error?: string; loading: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const cacheRate = data ? Math.round((data.cached_requests / Math.max(data.requests, 1)) * 100) : 0;
  const status = !data && !error ? "unconfigured" : error ? "error" : "connected";
  return (
    <APICard name="Cloudflare" color="#F6821F" status={status} error={error} loading={loading}
      icon={<img src="https://cdn.simpleicons.org/cloudflare/F6821F" width="20" height="20" alt="Cloudflare" />}>
      {data && (
        <>
          <BigStats items={[
            { label: "Requests",   value: fmtNum(data.requests), color: "#F6821F" },
            { label: "Cache rate", value: `${cacheRate}%`,       color: cacheRate > 70 ? "#3ecf8e" : "#f5a623" },
          ]} />
          <StatRow label="Bandwidth"       value={fmtBytes(data.bandwidth_bytes)} sub={data.period} />
          <StatRow label="Cached requests" value={fmtNum(data.cached_requests)} />
          <StatRow label="Threats blocked" value={String(data.threats)} />

          <ExpandToggle expanded={expanded} onToggle={() => setExpanded(e => !e)} />
          {expanded && (
            <div className="mt-2 pt-2 border-t border-[#111]">
              <StatRow label="Uncached requests" value={fmtNum(data.requests - data.cached_requests)} />
              <StatRow label="Bandwidth saved"   value={fmtBytes(Math.round(data.bandwidth_bytes * (cacheRate / 100)))} />
              <div className="mt-2">
                <div className="text-[11px] text-[#555] mb-1">Cache hit / miss split</div>
                <div className="h-2 bg-[#1a1a1a] rounded-full overflow-hidden flex">
                  <div className="h-full bg-[#3ecf8e] rounded-l-full" style={{ width: `${cacheRate}%` }} />
                  <div className="h-full bg-[rgba(245,166,35,0.3)] flex-1" />
                </div>
                <div className="flex justify-between text-[11px] mt-0.5 text-[#555]">
                  <span>Cached ({cacheRate}%)</span>
                  <span>Uncached ({100 - cacheRate}%)</span>
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </APICard>
  );
}

function SupabaseCard({ data, error, loading }: { data?: SupabaseUsage | null; error?: string; loading: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const status = !data && !error ? "unconfigured" : error ? "error" : "connected";
  const cols = Object.entries(data?.tables ?? {}).filter(([, v]) => v > 0).sort(([, a], [, b]) => b - a);
  return (
    <APICard name="Supabase" color="#3ECF8E" status={status} error={error} loading={loading}
      icon={<img src="https://cdn.simpleicons.org/supabase/3ECF8E" width="20" height="20" alt="Supabase" />}>
      {data && (
        <>
          <BigStats items={[
            { label: "Users",      value: fmtNum(data.active_users), color: "#3ecf8e" },
            { label: "Total rows", value: fmtNum(data.total_rows),   color: "#ededed" },
          ]} />

          <StatRow label="Project" value={data.project_ref || "—"} />
          {data.billing?.budget_amount != null && (
            <StatRow label="GCP budget" value={`${data.billing.currency ?? "USD"} ${data.billing.budget_amount}`} sub={data.billing.budget_name} />
          )}

          <ExpandToggle expanded={expanded} onToggle={() => setExpanded(e => !e)} />
          {expanded && (
            <div className="mt-2 pt-2 border-t border-[#111]">
              {cols.length > 0 && (
                <div className="mt-1">
                  <div className="text-[11px] text-[#555] mb-1.5">Tables</div>
                  {cols.slice(0, 11).map(([name, count]) => {
                    const pct = data.total_rows > 0 ? Math.round((count / data.total_rows) * 100) : 0;
                    return (
                      <div key={name} className="mb-1.5 last:mb-0">
                        <div className="flex justify-between text-[11px] mb-0.5">
                          <span className="text-[#888] font-mono">{name}</span>
                          <span className="font-bold text-[#ededed]">{fmtNum(count)} <span className="text-[#555] font-normal">({pct}%)</span></span>
                        </div>
                        <div className="h-1 bg-[#1a1a1a] rounded-full overflow-hidden">
                          <div className="h-full rounded-full bg-[#3ecf8e]" style={{ width: `${pct}%` }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
              <div className="mt-3 text-[11px] text-[#555] bg-[#111] border border-[#1a1a1a] rounded-lg px-2.5 py-2 leading-relaxed">
                {data.billing_note}
              </div>
            </div>
          )}
        </>
      )}
    </APICard>
  );
}

// ─── Summary bar ──────────────────────────────────────────────────────────────

function SummaryBar({ usage }: { usage: AllUsage }) {
  const aiCost = (usage.claude?.cost_usd ?? 0) + (usage.openai?.cost_usd ?? 0) + (usage.googleai?.cost_usd ?? 0);
  const connected = ["claude","openai","googleai","stripe","resend","cloudflare","supabase"].filter(k => (usage as unknown as Record<string,unknown>)[k]).length;
  const errors    = Object.keys(usage.errors ?? {}).length;
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
      {[
        { label: "Services connected",  value: `${connected} / 7`,                    color: "#0070f3" },
        { label: "Total AI cost (mo.)", value: fmtCost(aiCost),                        color: "#3ecf8e" },
        { label: "Emails sent",         value: fmtNum(usage.resend?.emails_sent ?? 0), color: "#f5a623" },
        { label: "Config errors",       value: String(errors), color: errors > 0 ? "#f44" : "#3ecf8e" },
      ].map(s => (
        <div key={s.label} className="bg-[#0a0a0a] border border-[#1a1a1a] rounded-xl p-4">
          <div className="text-[11px] font-bold text-[#555] uppercase tracking-widest mb-1">{s.label}</div>
          <div className="text-2xl font-extrabold" style={{ color: s.color }}>{s.value}</div>
        </div>
      ))}
    </div>
  );
}

function SummaryBarSkeleton() {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
      {[0, 1, 2, 3].map(i => (
        <div key={i} className="bg-[#0a0a0a] border border-[#1a1a1a] rounded-xl p-4 space-y-2">
          <SkeletonLine w="55%" h={8} />
          <SkeletonLine w="40%" h={24} />
        </div>
      ))}
    </div>
  );
}

// ─── Category / status filter ─────────────────────────────────────────────────

type Category     = "all" | "ai" | "payments" | "infra";
type StatusFilter = "all" | "connected" | "error";
type ServiceKey   = "claude" | "openai" | "googleai" | "stripe" | "resend" | "cloudflare" | "supabase";

interface ServiceMeta { key: ServiceKey; name: string; category: "ai" | "payments" | "infra"; color: string; icon: React.ReactNode }

const SERVICES: ServiceMeta[] = [
  { key: "claude",     name: "Claude",     category: "ai",       color: "#D97706", icon: <img src="https://cdn.simpleicons.org/anthropic/D97706"  width="20" height="20" alt="" /> },
  { key: "openai",     name: "OpenAI",     category: "ai",       color: "#10A37F", icon: <OpenAIIcon /> },
  { key: "googleai",   name: "Gemini",     category: "ai",       color: "#4285F4", icon: <img src="https://cdn.simpleicons.org/googlegemini/4285F4" width="20" height="20" alt="" /> },
  { key: "stripe",     name: "Stripe",     category: "payments", color: "#635BFF", icon: <img src="https://cdn.simpleicons.org/stripe/635BFF"      width="20" height="20" alt="" /> },
  { key: "resend",     name: "Resend",     category: "payments", color: "#ededed", icon: <img src="https://cdn.simpleicons.org/resend/ededed"      width="20" height="20" alt="" /> },
  { key: "cloudflare", name: "Cloudflare", category: "infra",    color: "#F6821F", icon: <img src="https://cdn.simpleicons.org/cloudflare/F6821F"  width="20" height="20" alt="" /> },
  { key: "supabase",   name: "Supabase",   category: "infra",    color: "#3ECF8E", icon: <img src="https://cdn.simpleicons.org/supabase/3ECF8E"    width="20" height="20" alt="" /> },
];

function getStatus(usage: AllUsage | null, key: ServiceKey): "connected" | "error" | "unconfigured" {
  if (!usage) return "unconfigured";
  if (usage.errors?.[key]) return "error";
  if ((usage as unknown as Record<string,unknown>)[key]) return "connected";
  return "unconfigured";
}

// ─── Main UsageTab ─────────────────────────────────────────────────────────────

export default function UsageTab({ token: tokenProp }: { token?: string }) {
  const ctxToken = useContext(AdminTokenContext);
  const token = tokenProp || ctxToken;
  const [usage,         setUsage]         = useState<AllUsage | null>(null);
  const [loading,       setLoading]       = useState(true);
  const [svcLoading, setSvcLoading] = useState<ServiceLoadingState>({
    claude: true, openai: true, googleai: true, stripe: true,
    resend: true, cloudflare: true, supabase: true,
  });
  const [error,         setError]         = useState("");
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);
  const [fromCache,     setFromCache]     = useState(false);
  const [category,      setCategory]      = useState<Category>("all");
  const [statusFilter,  setStatusFilter]  = useState<StatusFilter>("all");
  const [search,        setSearch]        = useState("");
  const [month, setMonth] = useState(DEFAULT_MONTH);
  const isMobile = useIsMobile();

  const authHeaders: Record<string, string> = token ? { "x-admin-token": token } : {};

  const resetSvcLoading = (val: boolean) =>
    setSvcLoading({ claude: val, openai: val, googleai: val, stripe: val, resend: val, cloudflare: val, supabase: val });

  const load = useCallback((force = false) => {
    const key = `main:${month}`;
    const hit = _cache.get(key);
    if (!force && hit && Date.now() - hit.ts < TTL) {
      setUsage(hit.data);
      setFromCache(true);
      setLastRefreshed(new Date(hit.ts));
      setLoading(false);
      resetSvcLoading(false);
      return;
    }

    if (!token) return;
    setLoading(true);
    setError("");
    setSvcLoading(s => ({ ...s, claude: true, googleai: true, stripe: true, resend: true, cloudflare: true, supabase: true }));

    fetch(`/api/admin?action=usage&claudeMonth=${month}${force ? "&refresh=1" : ""}`, { headers: authHeaders })
      .then(r => r.json() as Promise<AllUsage & { error?: string }>)
      .then(json => {
        if (json.error) throw new Error(json.error);
        _cache.set(key, { data: json, ts: Date.now() });
        setUsage(prev => ({ ...json, openai: json.openai ?? prev?.openai ?? null }));
        setFromCache(json.fromCache ?? false);
        setLastRefreshed(new Date());
        setLoading(false);
        setSvcLoading(s => ({ ...s, claude: false, googleai: false, stripe: false, resend: false, cloudflare: false, supabase: false }));
      })
      .catch(e => {
        setError((e as Error).message);
        setLoading(false);
        setSvcLoading(s => ({ ...s, claude: false, googleai: false, stripe: false, resend: false, cloudflare: false, supabase: false }));
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, month]);

  const loadOpenAI = useCallback((force = false) => {
    const key = `openai:${month}`;
    const hit = _cache.get(key);
    if (!force && hit && Date.now() - hit.ts < TTL) {
      setUsage(prev => prev ? { ...prev, openai: (hit.data as AllUsage).openai ?? prev.openai } : prev);
      setSvcLoading(s => ({ ...s, openai: false }));
      return;
    }
    setSvcLoading(s => ({ ...s, openai: true }));
    fetch(`/api/admin?action=usage_openai&openaiMonth=${month}${force ? "&refresh=1" : ""}`, { headers: authHeaders })
      .then(r => r.json() as Promise<{ openai?: AllUsage["openai"]; errors?: Record<string, string> }>)
      .then(json => {
        _cache.set(key, { data: json as unknown as AllUsage, ts: Date.now() });
        setUsage(prev => prev
          ? { ...prev, openai: json.openai ?? null, errors: { ...(prev.errors ?? {}), ...(json.errors ?? {}) } }
          : { openai: json.openai ?? null, errors: json.errors ?? {}, fetchedAt: new Date().toISOString() } as AllUsage
        );
        setSvcLoading(s => ({ ...s, openai: false }));
      })
      .catch(() => setSvcLoading(s => ({ ...s, openai: false })));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, month]);

  useEffect(() => {
    void Promise.all([
      Promise.resolve().then(() => load()),
      Promise.resolve().then(() => loadOpenAI()),
    ]);
  }, [load, loadOpenAI]);

  useEffect(() => {
    const id = setInterval(() => { load(false); loadOpenAI(false); }, 5 * 60 * 1000);
    return () => clearInterval(id);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [month]);

  const visibleServices = useMemo(() => {
    return SERVICES.filter(s => {
      if (category !== "all" && s.category !== category) return false;
      if (statusFilter !== "all") {
        const st = getStatus(usage, s.key);
        if (statusFilter === "connected" && st !== "connected") return false;
        if (statusFilter === "error"     && st !== "error")     return false;
      }
      if (search.trim() && !s.name.toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    });
  }, [category, statusFilter, search, usage]);

  const isInitialLoad = loading && !usage;
  const isRefreshing  = loading && !!usage;

  return (
    <div className="flex-1 overflow-y-auto p-4 md:p-6 bg-black">

      {/* Header */}
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <div>
          <SL>API Usage · All Services</SL>
          <div className="flex items-center gap-2 mt-0.5">
            {lastRefreshed && (
              <span className="text-[12px] text-[#888]">
                {fromCache ? "Cached" : "Fetched"} {lastRefreshed.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
              </span>
            )}
            {fromCache && (
              <span className="text-[11px] bg-[#1a1a1a] text-[#888] px-1.5 py-0.5 rounded-full font-medium">from cache</span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => { load(true); loadOpenAI(true); }} disabled={loading}
            className="flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-semibold text-[#888] border border-[#2a2a2a] rounded-lg hover:text-[#ededed] hover:border-[#555] cursor-pointer bg-transparent disabled:opacity-50 transition-colors">
            <svg width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"
              style={{ animation: isRefreshing ? "spin .7s linear infinite" : "none" }}>
              <path d="M23 4v6h-6M1 20v-6h6M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/>
            </svg>
            Refresh all
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-4 p-4 bg-[rgba(255,68,68,0.06)] border border-[rgba(255,68,68,0.2)] rounded-xl text-[14px] text-[#f44]">{error}</div>
      )}

      {isInitialLoad ? <SummaryBarSkeleton /> : usage && <SummaryBar usage={usage} />}

      {/* Filter bar */}
      <div className="flex flex-wrap gap-2 mb-4">
        <div className="flex items-center gap-2 bg-[#0a0a0a] border border-[#2a2a2a] rounded-lg px-3 py-1.5 flex-1 min-w-40">
          <svg width="12" height="12" fill="none" stroke="#555" strokeWidth="2" viewBox="0 0 24 24">
            <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search service…"
            className="text-[13px] bg-transparent border-none outline-none text-[#ededed] placeholder:text-[#444] flex-1 min-w-0 font-[inherit]" />
          {search && (
            <button onClick={() => setSearch("")} className="text-[#333] hover:text-[#888] border-none bg-transparent cursor-pointer text-[13px] transition-colors">✕</button>
          )}
        </div>
        <div className="flex gap-1 bg-[#0a0a0a] border border-[#1a1a1a] rounded-lg p-0.5">
          {(["all", "ai", "payments", "infra"] as Category[]).map(c => (
            <button key={c} onClick={() => setCategory(c)}
              className={`px-2.5 py-1 rounded text-[12px] font-semibold border-none cursor-pointer transition-colors whitespace-nowrap capitalize ${
                category === c ? "bg-[#1a1a1a] text-[#ededed]" : "bg-transparent text-[#555] hover:text-[#888]"
              }`}>
              {c === "ai" ? "🤖 AI" : c === "payments" ? "💳 Payments" : c === "infra" ? "🛠 Infra" : "All"}
            </button>
          ))}
        </div>
        <CustomSelect
          value={statusFilter}
          onChange={v => setStatusFilter(v as StatusFilter)}
          options={[
            { value: "all", label: "All statuses" },
            { value: "connected", label: "Connected only" },
            { value: "error", label: "Errors only" },
          ]}
        />
        <CustomSelect
          value={month}
          onChange={setMonth}
          options={MONTH_OPTIONS}
          prefix={<svg width="11" height="11" fill="none" stroke="#555" strokeWidth="2" viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>}
        />
      </div>

      {!isInitialLoad && (
        <div className="text-[12px] text-[#555] mb-3">
          Showing {visibleServices.length} of {SERVICES.length} services
          {search && ` · matching "${search}"`}
        </div>
      )}

      {/* Cards grid */}
      {visibleServices.length === 0 && !isInitialLoad ? (
        <div className="text-center py-16 text-[#555]">
          <svg width="32" height="32" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24" className="mx-auto mb-2 opacity-30">
            <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
          <p className="text-[14px]">No services match your filters</p>
        </div>
      ) : (
        <div className={`grid gap-4 items-stretch ${isMobile ? "grid-cols-1" : "grid-cols-2 xl:grid-cols-3"}`}>
          {visibleServices.map(s => {
            if (isInitialLoad) {
              return <CardSkeleton key={s.key} name={s.name} icon={s.icon} color={s.color} />;
            }

            const props = {
              data:    (usage as unknown as Record<string, unknown>)?.[s.key] as never,
              error:   usage?.errors?.[s.key],
              loading: svcLoading[s.key],
            };
            switch (s.key) {
              case "claude":     return <ClaudeCard     key={s.key} {...props} />;
              case "openai":     return <OpenAICard     key={s.key} {...props} />;
              case "googleai":   return <GoogleAICard   key={s.key} {...props} />;
              case "stripe":     return <StripeCard     key={s.key} {...props} />;
              case "resend":     return <ResendCard     key={s.key} {...props} />;
              case "cloudflare": return <CloudflareCard key={s.key} {...props} />;
              case "supabase":   return <SupabaseCard   key={s.key} {...props} />;
            }
          })}
        </div>
      )}

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
