"use client";
// components/admin/UsageTab.tsx

import { useState, useEffect, useCallback, useMemo } from "react";
import { Card, SL, useIsMobile } from "./admin-shared";

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
  cost_usd: number | null;       // null when no Admin key — never fake
  cost_is_estimated?: boolean;   // always false now
  cost_real?: boolean;           // true only when from cost_report API
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
}
interface ResendUsage {
  emails_sent: number; emails_delivered: number; emails_bounced: number;
  emails_complained: number; period: string;
}
interface CloudflareUsage {
  requests: number; bandwidth_bytes: number; threats: number;
  cached_requests: number; period: string;
}
interface FirebaseUsage {
  collections:      Record<string, number>;
  total_documents:  number;
  active_users:     number;
  estimated_reads:  number;
  estimated_writes: number;
  estimated_cost:   number;
  storage_bytes:    number;
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
  firebase?:    FirebaseUsage  | null;
  googleai?:    GoogleAIUsage  | null;
  errors:       Record<string, string>;
  fetchedAt:    string;
  fromCache?:   boolean;
  cachedAt?:    string;
}

// ─── Client cache ─────────────────────────────────────────────────────────────
const _cache = new Map<string, { data: AllUsage; ts: number }>();
const TTL = 5 * 60 * 1000;
const _now = new Date();
const DEFAULT_MONTH = `${_now.getFullYear()}-${String(_now.getMonth() + 1).padStart(2, "0")}`;

// ─── Helpers ──────────────────────────────────────────────────────────────────

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

// ─── Shared primitives ────────────────────────────────────────────────────────

function StatusPill({ status }: { status: "connected" | "error" | "unconfigured" }) {
  const map = {
    connected:    { cls: "bg-green-50 text-green-700 border-green-200",  dot: "bg-green-500",  label: "Connected"       },
    error:        { cls: "bg-red-50 text-red-700 border-red-200",        dot: "bg-red-500",    label: "Error"           },
    unconfigured: { cls: "bg-gray-50 text-gray-400 border-gray-200",     dot: "bg-gray-300",   label: "Not configured"  },
  }[status];
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold border ${map.cls}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${map.dot}`} />
      {map.label}
    </span>
  );
}

function StatRow({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="flex items-center justify-between py-1.5 border-b border-gray-50 last:border-0">
      <span className="text-[11px] text-gray-500">{label}</span>
      <div className="text-right">
        <span className="text-[12px] font-bold text-gray-900">{value}</span>
        {sub && <div className="text-[10px] text-gray-400">{sub}</div>}
      </div>
    </div>
  );
}

function BigStats({ items }: { items: { label: string; value: string; color: string }[] }) {
  return (
    <div className="grid gap-2 mb-3" style={{ gridTemplateColumns: `repeat(${items.length}, 1fr)` }}>
      {items.map(s => (
        <div key={s.label} className="bg-gray-50 rounded-lg p-2.5 text-center">
          <div className="text-[18px] font-extrabold leading-tight" style={{ color: s.color }}>{s.value}</div>
          <div className="text-[10px] text-gray-400 leading-tight mt-0.5">{s.label}</div>
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
              <div className="absolute bottom-full mb-1 left-1/2 -translate-x-1/2 bg-gray-900 text-white text-[9px] px-1.5 py-0.5 rounded whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none z-20">
                {fmtDate(d.date)}: {fmt(vals[i])}
              </div>
            </div>
          );
        })}
      </div>
      {data.length >= 3 && (
        <div className="flex justify-between mt-0.5">
          <span className="text-[9px] text-gray-300">{fmtDate(data[0].date)}</span>
          <span className="text-[9px] text-gray-300">{fmtDate(data[Math.floor(data.length / 2)].date)}</span>
          <span className="text-[9px] text-gray-300">{fmtDate(data[data.length - 1].date)}</span>
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
      <div className="flex justify-between text-[10px] mb-0.5">
        <span className="text-gray-500 font-mono truncate max-w-[160px]" title={model}>{model}</span>
        <div className="flex gap-2 shrink-0 text-gray-400">
          <span>{fmtNum(requests)} req</span>
          <span>{fmtCost(cost)}</span>
          <span className="font-bold text-gray-700">{fmtNum(tokens)}</span>
        </div>
      </div>
      <div className="h-1 bg-gray-100 rounded-full overflow-hidden">
        <div className="h-full rounded-full" style={{ width: `${pct}%`, background: color }} />
      </div>
    </div>
  );
}

// APICard wrapper — matches original aesthetic exactly
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
          <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0 bg-white border border-gray-100 shadow-sm">
            {icon}
          </div>
          <div>
            <div className="text-[13px] font-bold text-gray-900">{name}</div>
            {!loading && <StatusPill status={status} />}
            {loading  && <div className="text-[10px] text-gray-400">Loading…</div>}
          </div>
        </div>
        {headerExtra && <div className="shrink-0">{headerExtra}</div>}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-6">
          <div className="w-5 h-5 rounded-full border-2 border-gray-100 border-t-indigo-500 animate-spin" />
        </div>
      ) : status === "unconfigured" ? (
        <div className="text-[12px] text-gray-400 py-3 text-center">API key not set in environment</div>
      ) : status === "error" ? (
        <div className="text-[12px] text-red-500 py-2 bg-red-50 rounded-lg px-3 break-all">{error}</div>
      ) : children}
    </Card>
  );
}

// Expand/collapse toggle for detail rows
function ExpandToggle({ expanded, onToggle }: { expanded: boolean; onToggle: () => void }) {
  return (
    <button onClick={onToggle}
      className="mt-2 w-full flex items-center justify-center gap-1 text-[10px] text-gray-400 hover:text-gray-600 border-none bg-transparent cursor-pointer py-1">
      <svg width="10" height="10" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"
        style={{ transform: expanded ? "rotate(180deg)" : "none", transition: "transform .15s" }}>
        <polyline points="6 9 12 15 18 9" />
      </svg>
      {expanded ? "Show less" : "Show more"}
    </button>
  );
}

// ─── Individual cards ─────────────────────────────────────────────────────────

function ClaudeCard({ data, error, loading, month, onMonthChange }: {
  data?: ClaudeUsage | null; error?: string; loading: boolean;
  month: string; onMonthChange: (m: string) => void;
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

  const headerExtra = (
    <div className="flex items-center gap-1.5">
      {realModels.length > 1 && (
        <select value={selectedModel} onChange={e => setSelectedModel(e.target.value)}
          className="text-[11px] border border-gray-200 rounded-lg px-2 py-1 bg-white text-gray-600 outline-none cursor-pointer font-[inherit] max-w-[110px] truncate">
          <option value="all">All models</option>
          {realModels.map(m => (
            <option key={m.model} value={m.model}>
              {m.model.replace("claude-", "").replace(/-20\d{6}$/, "")}
            </option>
          ))}
        </select>
      )}
      <select value={month} onChange={e => onMonthChange(e.target.value)}
        className="text-[11px] border border-gray-200 rounded-lg px-2 py-1 bg-white text-gray-600 outline-none cursor-pointer font-[inherit]">
        {MONTH_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  );

  return (
    <APICard name="Claude (Anthropic)" color="#D97706" status={status} error={error} loading={loading}
      headerExtra={headerExtra}
      icon={<img src="https://cdn.simpleicons.org/anthropic/D97706" width="20" height="20" alt="Anthropic" />}>
      {data && (
        <>
          <BigStats items={[
            { label: "Total tokens", value: fmtNum(dispTok),                                                          color: "#D97706" },
            { label: "Billed",
              value: data.cost_usd === null ? "—" : fmtCost(dispCost),
              color: "#92400E" },
          ]} />
          {data.cost_usd === null && (
            <div className="mb-2 px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg">
              <div className="text-[11px] font-bold text-gray-600 mb-0.5">Cost unavailable</div>
              <div className="text-[10px] text-gray-500 leading-relaxed">
                Add <code className="bg-gray-100 px-1 rounded font-mono">ANTHROPIC_ADMIN_KEY=sk-ant-admin...</code> to your <code className="bg-gray-100 px-1 rounded font-mono">.env</code> to see real billed costs from the Anthropic billing API.
              </div>
            </div>
          )}

          {/* Credit balance */}
          {data.credit_balance !== null && selectedModel === "all" && (
            <div className="flex items-center justify-between py-1.5 mb-1 bg-amber-50 rounded-lg px-2.5">
              <span className="text-[11px] text-amber-700 font-medium">Credit balance</span>
              <span className="text-[13px] font-bold text-amber-700">${(data.credit_balance ?? 0).toFixed(2)}</span>
            </div>
          )}

          {/* Spend limit bar */}
          {spendPct !== null && data.spend_limit != null && selectedModel === "all" && (
            <div className="mb-2">
              <div className="flex justify-between text-[10px] text-gray-400 mb-1">
                <span>Limit ${data.spend_limit.toFixed(0)}/mo</span>
                <span>{spendPct}% used</span>
              </div>
              <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                <div className="h-full rounded-full"
                  style={{ width: `${spendPct}%`, background: spendPct > 80 ? "#EF4444" : spendPct > 50 ? "#F59E0B" : "#10B981" }} />
              </div>
            </div>
          )}

          <StatRow label="Requests"      value={fmtNum(dispReq)}  sub={data.period} />
          <StatRow label="Input tokens"  value={fmtNum(dispInp)} />
          <StatRow label="Output tokens" value={fmtNum(dispOut)} />
          {dispReq > 0 && dispCost !== null && <StatRow label="Avg cost / req" value={fmtCost(dispCost / dispReq)} />}

          {/* Daily bar chart */}
          {daily.length > 0 && hasTokens && (
            <>
              <div className="text-[10px] text-gray-400 mt-3 mb-1">
                Daily tokens · {selectedModel !== "all" ? selectedModel.replace("claude-", "").replace(/-\d{8}$/, "") : "all models"} · {daily.length}d
              </div>
              <MiniBarChart data={daily} color="#D97706" valueKey="tokens" />
            </>
          )}

          {/* Expandable detail */}
          <ExpandToggle expanded={expanded} onToggle={() => setExpanded(e => !e)} />
          {expanded && (
            <div className="mt-2 pt-2 border-t border-gray-100">
              {/* Daily cost chart */}
              {daily.length > 0 && daily.some(d => d.cost > 0) && (
                <>
                  <div className="text-[10px] text-gray-400 mb-1">Daily cost</div>
                  <MiniBarChart data={daily} color="#92400E" valueKey="cost" />
                </>
              )}
              {/* Per-model breakdown */}
              {selectedModel === "all" && realModels.length > 0 && hasTokens && (
                <div className="mt-3">
                  <div className="text-[10px] text-gray-400 mb-1.5">By model</div>
                  {realModels.slice(0, 6).map(m => (
                    <ModelBar key={m.model}
                      model={m.model.replace("claude-", "").replace(/-20\d{6}$/, "")}
                      tokens={m.tokens} totalTokens={dispTok}
                      cost={m.cost} requests={m.requests} color="#D97706" />
                  ))}
                </div>
              )}
              {/* Extra stats */}
              <div className="mt-3">
                <StatRow label="I/O ratio" value={`${Math.round((dispInp / Math.max(dispTok, 1)) * 100)}% in / ${Math.round((dispOut / Math.max(dispTok, 1)) * 100)}% out`} />
              {dispCost !== null && dispReq > 0 && <StatRow label="Avg cost / req" value={fmtCost(dispCost / dispReq)} />}
                <StatRow label="Avg tokens / req" value={dispReq > 0 ? fmtNum(Math.round(dispTok / dispReq)) : "—"} />
                {daily.length > 0 && <StatRow label="Active days" value={String(daily.filter(d => d.tokens > 0).length)} sub={`of ${daily.length}`} />}
                {daily.length > 0 && <StatRow label="Peak day"    value={fmtNum(Math.max(...daily.map(d => d.tokens)))} />}
              </div>
              {/* Setup hint */}
              {!data.has_tracking && data.data_source !== "admin_api" && (
                <div className="mt-3 px-3 py-2.5 bg-indigo-50 border border-indigo-200 rounded-lg">
                  <div className="text-[11px] font-bold text-indigo-800 mb-1">API key valid ✓ — add usage tracking</div>
                  <div className="text-[11px] text-indigo-700 leading-relaxed">
                    Call <code className="bg-indigo-100 px-1 rounded font-mono">trackClaudeUsage()</code> in your app — see <code className="bg-indigo-100 px-1 rounded font-mono">lib/trackClaudeUsage.ts</code>
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

function OpenAICard({ data, error, loading, month, onMonthChange, refreshing = false }: {
  data?: OpenAIUsage | null; error?: string; loading: boolean;
  month: string; onMonthChange: (m: string) => void; refreshing?: boolean;
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

  const headerExtra = (
    <div className="flex items-center gap-1.5">
      {refreshing && (
        <svg width="10" height="10" fill="none" stroke="#6366F1" strokeWidth="2" viewBox="0 0 24 24" style={{ animation: "spin .7s linear infinite" }}>
          <path d="M23 4v6h-6M1 20v-6h6M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/>
        </svg>
      )}
      {realModels.length > 1 && (
        <select value={selectedModel} onChange={e => setSelectedModel(e.target.value)}
          className="text-[11px] border border-gray-200 rounded-lg px-2 py-1 bg-white text-gray-600 outline-none cursor-pointer font-[inherit] max-w-[110px] truncate">
          <option value="all">All models</option>
          {realModels.map(m => (
            <option key={m.model} value={m.model}>
              {m.model.replace(/^gpt-/, "").replace(/-\d{4}-\d{2}-\d{2}$/, "")}
            </option>
          ))}
        </select>
      )}
      <select value={month} onChange={e => onMonthChange(e.target.value)}
        className="text-[11px] border border-gray-200 rounded-lg px-2 py-1 bg-white text-gray-600 outline-none cursor-pointer font-[inherit]">
        {MONTH_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  );

  return (
    <APICard name="OpenAI" color="#10A37F" status={status} error={error} loading={loading}
      headerExtra={headerExtra}
      icon={<img src="https://upload.wikimedia.org/wikipedia/commons/4/4d/OpenAI_Logo.svg" width="20" height="20" alt="OpenAI" />}>
      {data && (
        <>
          <BigStats items={[
            { label: "Total tokens", value: fmtNum(dispTok),   color: "#10A37F" },
            { label: "Billed",       value: fmtCost(dispCost), color: "#065F46" },
          ]} />

          <StatRow label="Requests"          value={fmtNum(dispReq)}  sub={data.period} />
          <StatRow label="Prompt tokens"     value={fmtNum(dispPrm)} />
          <StatRow label="Completion tokens" value={fmtNum(dispCmp)} />
          {dispReq > 0 && <StatRow label="Avg cost / req" value={fmtCost(dispCost / dispReq)} />}

          {daily.length > 0 && hasTokens && (
            <>
              <div className="text-[10px] text-gray-400 mt-3 mb-1">Daily tokens · {daily.length}d</div>
              <MiniBarChart data={daily} color="#10A37F" valueKey="tokens" />
            </>
          )}

          <ExpandToggle expanded={expanded} onToggle={() => setExpanded(e => !e)} />
          {expanded && (
            <div className="mt-2 pt-2 border-t border-gray-100">
              {daily.length > 0 && daily.some(d => d.cost > 0) && (
                <>
                  <div className="text-[10px] text-gray-400 mb-1">Daily cost</div>
                  <MiniBarChart data={daily} color="#065F46" valueKey="cost" />
                </>
              )}
              {selectedModel === "all" && realModels.length > 0 && hasTokens && (
                <div className="mt-3">
                  <div className="text-[10px] text-gray-400 mb-1.5">By model</div>
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
    <APICard name="Google AI (Gemini)" color="#4285F4" status={status} error={error} loading={loading}
      icon={<img src="https://cdn.simpleicons.org/googlegemini/4285F4" width="20" height="20" alt="Google Gemini" />}>
      {data && (
        <>
          <BigStats items={[
            { label: "Requests",  value: fmtNum(data.total_requests), color: "#4285F4" },
            { label: "Billed",     value: fmtCost(data.cost_usd),      color: "#1A56DB" },
          ]} />
          <StatRow label="Input tokens"  value={fmtNum(data.input_tokens)}  sub={data.period} />
          <StatRow label="Output tokens" value={fmtNum(data.output_tokens)} />
          <div className="mt-2 p-2.5 bg-blue-50 border border-blue-100 rounded-lg">
            <div className="text-[10px] font-bold text-blue-700 mb-1">No usage API available</div>
            <div className="text-[10px] text-blue-600 leading-relaxed">Google AI Studio doesn&apos;t expose a public usage API. Key validated ✓</div>
          </div>
          {data.models.length > 0 && (
            <div className="mt-2">
              <div className="text-[10px] text-gray-400 mb-1">Available models</div>
              {data.models.slice(0, 4).map(m => (
                <div key={m.model} className="flex items-center justify-between py-1 border-b border-gray-50 last:border-0">
                  <span className="text-[10px] text-gray-500 font-mono truncate max-w-[180px]">{m.model.replace("models/", "")}</span>
                  <span className="text-[10px] text-green-600 font-bold">✓</span>
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
            { label: "Volume", value: `$${(data.total_volume / 100).toFixed(2)}`, color: "#4F46E5" },
          ]} />
          <StatRow label="Active subscriptions" value={String(data.active_subscriptions)} />
          <StatRow label="Successful charges"   value={String(data.successful_charges)} sub="last 30d" />
          <StatRow label="Failed charges"       value={String(data.failed_charges)} />
          <StatRow label="Refunded"             value={`$${(data.refunded / 100).toFixed(2)}`} />

          <ExpandToggle expanded={expanded} onToggle={() => setExpanded(e => !e)} />
          {expanded && (
            <div className="mt-2 pt-2 border-t border-gray-100">
              <StatRow label="Success rate"   value={`${successRate}%`} />
              <StatRow label="Total charges"  value={String(data.total_charges)} />
              <StatRow label="Net revenue"    value={`$${((data.total_volume - data.refunded) / 100).toFixed(2)}`} />
              <StatRow label="Annual run rate" value={`$${(data.mrr * 12).toFixed(2)}`} />
              {/* Charge success/fail bar */}
              <div className="mt-2">
                <div className="text-[10px] text-gray-400 mb-1">Charge success rate</div>
                <div className="h-2 bg-gray-100 rounded-full overflow-hidden flex">
                  <div className="h-full bg-green-500 rounded-l-full" style={{ width: `${successRate}%` }} />
                  <div className="h-full bg-red-300 flex-1" />
                </div>
                <div className="flex justify-between text-[9px] mt-0.5 text-gray-400">
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
    <APICard name="Resend" color="#000000" status={status} error={error} loading={loading}
      icon={<img src="https://cdn.simpleicons.org/resend/000000" width="20" height="20" alt="Resend" />}>
      {data && (
        <>
          <BigStats items={[
            { label: "Sent",     value: fmtNum(data.emails_sent), color: "#111827" },
            { label: "Delivery", value: `${rate}%`,               color: rate > 95 ? "#10B981" : rate > 80 ? "#F59E0B" : "#EF4444" },
          ]} />
          <StatRow label="Delivered"       value={fmtNum(data.emails_delivered)} sub={`${rate}% rate · ${data.period}`} />
          <StatRow label="Bounced"         value={String(data.emails_bounced)}   sub={`${bounceRate}% bounce`} />
          <StatRow label="Spam complaints" value={String(data.emails_complained)} />

          <ExpandToggle expanded={expanded} onToggle={() => setExpanded(e => !e)} />
          {expanded && (
            <div className="mt-2 pt-2 border-t border-gray-100">
              <StatRow label="Unaccounted" value={String(data.emails_sent - data.emails_delivered - data.emails_bounced - data.emails_complained)} />
              {/* Funnel */}
              <div className="mt-2">
                <div className="text-[10px] text-gray-400 mb-1.5">Email funnel</div>
                {[
                  { label: "Sent",       val: data.emails_sent,       pct: 100,        color: "#374151" },
                  { label: "Delivered",  val: data.emails_delivered,   pct: rate,       color: "#10B981" },
                  { label: "Bounced",    val: data.emails_bounced,     pct: bounceRate, color: "#EF4444" },
                  { label: "Complained", val: data.emails_complained,  pct: Math.round(data.emails_complained / Math.max(data.emails_sent, 1) * 100), color: "#F59E0B" },
                ].map(row => (
                  <div key={row.label} className="mb-1.5 last:mb-0">
                    <div className="flex justify-between text-[10px] mb-0.5">
                      <span className="text-gray-500">{row.label}</span>
                      <span className="font-bold text-gray-700">{row.val} <span className="text-gray-400 font-normal">({row.pct}%)</span></span>
                    </div>
                    <div className="h-1 bg-gray-100 rounded-full overflow-hidden">
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
            { label: "Cache rate", value: `${cacheRate}%`,       color: cacheRate > 70 ? "#10B981" : "#F59E0B" },
          ]} />
          <StatRow label="Bandwidth"       value={fmtBytes(data.bandwidth_bytes)} sub={data.period} />
          <StatRow label="Cached requests" value={fmtNum(data.cached_requests)} />
          <StatRow label="Threats blocked" value={String(data.threats)} />

          <ExpandToggle expanded={expanded} onToggle={() => setExpanded(e => !e)} />
          {expanded && (
            <div className="mt-2 pt-2 border-t border-gray-100">
              <StatRow label="Uncached requests"   value={fmtNum(data.requests - data.cached_requests)} />
              <StatRow label="Bandwidth saved"     value={fmtBytes(Math.round(data.bandwidth_bytes * (cacheRate / 100)))} />
              <div className="mt-2">
                <div className="text-[10px] text-gray-400 mb-1">Cache hit / miss split</div>
                <div className="h-2 bg-gray-100 rounded-full overflow-hidden flex">
                  <div className="h-full bg-green-500 rounded-l-full" style={{ width: `${cacheRate}%` }} />
                  <div className="h-full bg-orange-200 flex-1" />
                </div>
                <div className="flex justify-between text-[9px] mt-0.5 text-gray-400">
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

function FirebaseCard({ data, error, loading }: { data?: FirebaseUsage | null; error?: string; loading: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const status = !data && !error ? "unconfigured" : error ? "error" : "connected";
  const cols = Object.entries(data?.collections ?? {}).filter(([, v]) => v > 0).sort(([, a], [, b]) => b - a);
  return (
    <APICard name="Firebase / Firestore" color="#FFCA28" status={status} error={error} loading={loading}
      icon={<img src="https://cdn.simpleicons.org/firebase/FFCA28" width="20" height="20" alt="Firebase" />}>
      {data && (
        <>
          <BigStats items={[
            { label: "Active users", value: fmtNum(data.active_users),  color: "#B45309" },
            { label: "Billed",       value: fmtCost(data.estimated_cost), color: "#D97706" },
          ]} />

          <StatRow label="Total documents" value={fmtNum(data.total_documents)} />
          <StatRow label="Storage"         value={fmtBytes(data.storage_bytes)} />

          <ExpandToggle expanded={expanded} onToggle={() => setExpanded(e => !e)} />
          {expanded && (
            <div className="mt-2 pt-2 border-t border-gray-100">
              <StatRow label="Est. reads"  value={fmtNum(data.estimated_reads)} />
              <StatRow label="Est. writes" value={fmtNum(data.estimated_writes)} />
              {cols.length > 0 && (
                <div className="mt-3">
                  <div className="text-[10px] text-gray-400 mb-1.5">Collections</div>
                  {cols.slice(0, 8).map(([name, count]) => {
                    const pct = data.total_documents > 0 ? Math.round((count / data.total_documents) * 100) : 0;
                    return (
                      <div key={name} className="mb-1.5 last:mb-0">
                        <div className="flex justify-between text-[10px] mb-0.5">
                          <span className="text-gray-600 font-mono">{name}</span>
                          <span className="font-bold text-gray-800">{fmtNum(count)} <span className="text-gray-400 font-normal">({pct}%)</span></span>
                        </div>
                        <div className="h-1 bg-gray-100 rounded-full overflow-hidden">
                          <div className="h-full rounded-full bg-amber-400" style={{ width: `${pct}%` }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
              <div className="mt-3 text-[10px] text-gray-400 bg-gray-50 border border-gray-100 rounded-lg px-2.5 py-2 leading-relaxed">
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
  const connected = ["claude","openai","googleai","stripe","resend","cloudflare","firebase"].filter(k => (usage as unknown as Record<string,unknown>)[k]).length;
  const errors    = Object.keys(usage.errors ?? {}).length;
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
      {[
        { label: "Services connected",  value: `${connected} / 7`,                   color: "#6366F1" },
        { label: "Total AI cost (mo.)", value: fmtCost(aiCost), color: "#10B981" },
        { label: "Emails sent",         value: fmtNum(usage.resend?.emails_sent ?? 0),color: "#F59E0B" },
        { label: "Config errors",       value: String(errors), color: errors > 0 ? "#EF4444" : "#10B981" },
      ].map(s => (
        <div key={s.label} className="bg-white border border-gray-100 rounded-xl p-4">
          <div className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">{s.label}</div>
          <div className="text-2xl font-extrabold" style={{ color: s.color }}>{s.value}</div>
        </div>
      ))}
    </div>
  );
}

// ─── Category filter + status filter (matches original) ───────────────────────

type Category     = "all" | "ai" | "payments" | "infra";
type StatusFilter = "all" | "connected" | "error";
type ServiceKey   = "claude" | "openai" | "googleai" | "stripe" | "resend" | "cloudflare" | "firebase";

interface ServiceMeta { key: ServiceKey; name: string; category: "ai" | "payments" | "infra" }

const SERVICES: ServiceMeta[] = [
  { key: "claude",     name: "Claude",              category: "ai"       },
  { key: "openai",     name: "OpenAI",               category: "ai"       },
  { key: "googleai",   name: "Google AI",            category: "ai"       },
  { key: "stripe",     name: "Stripe",               category: "payments" },
  { key: "resend",     name: "Resend",               category: "payments" },
  { key: "cloudflare", name: "Cloudflare",           category: "infra"    },
  { key: "firebase",   name: "Firebase / Firestore", category: "infra"    },
];

function getStatus(usage: AllUsage | null, key: ServiceKey): "connected" | "error" | "unconfigured" {
  if (!usage) return "unconfigured";
  if (usage.errors?.[key]) return "error";
  if ((usage as unknown as Record<string,unknown>)[key]) return "connected";
  return "unconfigured";
}

// ─── Main UsageTab ─────────────────────────────────────────────────────────────

export default function UsageTab({ token }: { token?: string }) {
  const [usage,         setUsage]         = useState<AllUsage | null>(null);
  const [loading,       setLoading]       = useState(true);
  const [openaiLoading, setOpenaiLoading] = useState(false);
  const [error,         setError]         = useState("");
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);
  const [fromCache,     setFromCache]     = useState(false);
  const [category,      setCategory]      = useState<Category>("all");
  const [statusFilter,  setStatusFilter]  = useState<StatusFilter>("all");
  const [search,        setSearch]        = useState("");
  const [claudeMonth,   setClaudeMonth]   = useState(DEFAULT_MONTH);
  const [openaiMonth,   setOpenaiMonth]   = useState(DEFAULT_MONTH);
  const isMobile = useIsMobile();

  const authHeaders: Record<string, string> = token ? { "x-firebase-token": token } : {};

  const load = useCallback((force = false) => {
    const key = `main:${claudeMonth}`;
    const hit = _cache.get(key);
    if (!force && hit && Date.now() - hit.ts < TTL) {
      setUsage(hit.data); setFromCache(true); setLastRefreshed(new Date(hit.ts)); setLoading(false);
      return;
    }
    setLoading(true); setError("");
    fetch(`/api/admin?action=usage&claudeMonth=${claudeMonth}${force ? "&refresh=1" : ""}`, { headers: authHeaders })
      .then(r => r.json() as Promise<AllUsage & { error?: string }>)
      .then(json => {
        if (json.error) throw new Error(json.error);
        _cache.set(key, { data: json, ts: Date.now() });
        setUsage(json); setFromCache(json.fromCache ?? false);
        setLastRefreshed(new Date()); setLoading(false);
      })
      .catch(e => { setError((e as Error).message); setLoading(false); });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, claudeMonth]);

  const loadOpenAI = useCallback((force = false) => {
    const key = `openai:${openaiMonth}`;
    const hit = _cache.get(key);
    if (!force && hit && Date.now() - hit.ts < TTL) {
      setUsage(prev => prev ? { ...prev, openai: (hit.data as AllUsage).openai ?? prev.openai } : prev);
      return;
    }
    setOpenaiLoading(true);
    fetch(`/api/admin?action=usage_openai&openaiMonth=${openaiMonth}${force ? "&refresh=1" : ""}`, { headers: authHeaders })
      .then(r => r.json() as Promise<{ openai?: AllUsage["openai"]; errors?: Record<string, string> }>)
      .then(json => {
        _cache.set(key, { data: json as unknown as AllUsage, ts: Date.now() });
        setUsage(prev => prev
          ? { ...prev, openai: json.openai ?? null, errors: { ...(prev.errors ?? {}), ...(json.errors ?? {}) } }
          : { openai: json.openai ?? null, errors: json.errors ?? {}, fetchedAt: new Date().toISOString() } as AllUsage
        );
        setOpenaiLoading(false);
      })
      .catch(() => setOpenaiLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, openaiMonth]);

  useEffect(() => { void Promise.resolve().then(() => load());      }, [load]);
  useEffect(() => { void Promise.resolve().then(() => loadOpenAI()); }, [loadOpenAI]);

  useEffect(() => {
    const id = setInterval(() => { load(false); loadOpenAI(false); }, 5 * 60 * 1000);
    return () => clearInterval(id);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [claudeMonth, openaiMonth]);

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

  const isCardLoading = loading && !usage;

  return (
    <div className="flex-1 overflow-y-auto p-4 md:p-6">

      {/* Header */}
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <div>
          <SL>API Usage · All Services</SL>
          <div className="flex items-center gap-2 mt-0.5">
            {lastRefreshed && (
              <span className="text-[11px] text-gray-400">
                {fromCache ? "Cached" : "Fetched"} {lastRefreshed.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
              </span>
            )}
            {fromCache && (
              <span className="text-[10px] bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded-full font-medium">from cache</span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => { load(true); loadOpenAI(true); }} disabled={loading}
            className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-semibold text-gray-500 border border-gray-200 rounded-lg hover:bg-gray-50 cursor-pointer bg-white disabled:opacity-50">
            <svg width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"
              style={{ animation: loading ? "spin .7s linear infinite" : "none" }}>
              <path d="M23 4v6h-6M1 20v-6h6M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/>
            </svg>
            Refresh all
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-xl text-[13px] text-red-600">{error}</div>
      )}

      {/* Summary */}
      {usage && <SummaryBar usage={usage} />}

      {/* Filter bar */}
      <div className="flex flex-wrap gap-2 mb-4">
        <div className="flex items-center gap-2 bg-white border border-gray-200 rounded-lg px-3 py-1.5 flex-1 min-w-[160px]">
          <svg width="12" height="12" fill="none" stroke="#9CA3AF" strokeWidth="2" viewBox="0 0 24 24">
            <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search service…"
            className="text-[12px] bg-transparent border-none outline-none text-gray-700 placeholder-gray-400 flex-1 min-w-0" />
          {search && (
            <button onClick={() => setSearch("")} className="text-gray-300 hover:text-gray-500 border-none bg-transparent cursor-pointer text-[12px]">✕</button>
          )}
        </div>
        <div className="flex gap-1 bg-gray-100 rounded-lg p-0.5">
          {(["all", "ai", "payments", "infra"] as Category[]).map(c => (
            <button key={c} onClick={() => setCategory(c)}
              className={`px-2.5 py-1 rounded text-[11px] font-semibold border-none cursor-pointer transition-colors whitespace-nowrap capitalize ${
                category === c ? "bg-white text-gray-900 shadow-sm" : "bg-transparent text-gray-500 hover:text-gray-700"
              }`}>
              {c === "ai" ? "🤖 AI" : c === "payments" ? "💳 Payments" : c === "infra" ? "🛠 Infra" : "All"}
            </button>
          ))}
        </div>
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value as StatusFilter)}
          className="border border-gray-200 rounded-lg px-2.5 py-1.5 text-[11px] text-gray-600 bg-white outline-none cursor-pointer font-[inherit]">
          <option value="all">All statuses</option>
          <option value="connected">Connected only</option>
          <option value="error">Errors only</option>
        </select>
      </div>

      {!isCardLoading && (
        <div className="text-[11px] text-gray-400 mb-3">
          Showing {visibleServices.length} of {SERVICES.length} services
          {search && ` · matching "${search}"`}
        </div>
      )}

      {/* Cards grid */}
      {visibleServices.length === 0 && !isCardLoading ? (
        <div className="text-center py-16 text-gray-400">
          <svg width="32" height="32" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24" className="mx-auto mb-2 opacity-30">
            <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
          <p className="text-[13px]">No services match your filters</p>
        </div>
      ) : (
        <div className={`grid gap-4 items-stretch ${isMobile ? "grid-cols-1" : "grid-cols-2 xl:grid-cols-3"}`}>
          {visibleServices.map(s => {
            const props = {
              data:    (usage as unknown as Record<string, unknown>)?.[s.key] as never,
              error:   usage?.errors?.[s.key],
              loading: isCardLoading,
            };
            switch (s.key) {
              case "claude":     return <ClaudeCard     key={s.key} {...props} month={claudeMonth} onMonthChange={setClaudeMonth} />;
              case "openai":     return <OpenAICard     key={s.key} {...props} month={openaiMonth} onMonthChange={setOpenaiMonth} refreshing={openaiLoading} />;
              case "googleai":   return <GoogleAICard   key={s.key} {...props} />;
              case "stripe":     return <StripeCard     key={s.key} {...props} />;
              case "resend":     return <ResendCard     key={s.key} {...props} />;
              case "cloudflare": return <CloudflareCard key={s.key} {...props} />;
              case "firebase":   return <FirebaseCard   key={s.key} {...props} />;
            }
          })}
        </div>
      )}



      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}