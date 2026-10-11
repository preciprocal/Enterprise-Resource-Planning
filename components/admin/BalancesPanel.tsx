// components/admin/BalancesPanel.tsx
// Usage → "What's left": remaining credit or plan headroom per outside
// service, sorted so whatever is running out comes first. Logic and sources
// in lib/provider-balances.ts.
"use client";

import { useCallback, useEffect, useState } from "react";
import { inputCls, fmtFull } from "./admin-shared";
import type { ProviderBalance, Meter, BalanceStatus } from "@/lib/provider-balances";

const STATUS: Record<BalanceStatus, { label: string; fg: string; bg: string; bar: string }> = {
  critical: { label: "Running out", fg: "#f44",    bg: "rgba(255,68,68,0.08)",  bar: "#f44" },
  low:      { label: "Low",         fg: "#f5a623", bg: "rgba(245,166,35,0.08)", bar: "#f5a623" },
  ok:       { label: "OK",          fg: "#3ecf8e", bg: "rgba(62,207,142,0.08)", bar: "#3ecf8e" },
  unknown:  { label: "Not tracked", fg: "#777",    bg: "rgba(255,255,255,0.04)", bar: "#444" },
};
const ORDER: BalanceStatus[] = ["critical", "low", "ok", "unknown"];
const SOURCE: Record<string, string> = {
  live: "Reported by the provider", counted: "Counted from our usage", estimate: "Estimate: balance you entered minus reported spend",
  manual: "Balance you entered", none: "Not available by API",
};

const usd = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
function amount(n: number, unit?: Meter["unit"]) {
  if (unit === "bytes") {
    const mb = n / 1024 ** 2;
    return mb >= 1024 ? `${(mb / 1024).toFixed(2)} GB` : `${mb.toFixed(mb < 10 ? 1 : 0)} MB`;
  }
  if (unit === "usd") return usd(n);
  return n.toLocaleString("en-US");
}

function Bar({ pctLeft, color }: { pctLeft: number; color: string }) {
  return (
    <div className="h-1.5 rounded-full bg-[#161616] overflow-hidden">
      <div className="h-full rounded-full transition-[width]" style={{ width: `${Math.max(0, Math.min(100, pctLeft))}%`, background: color }} />
    </div>
  );
}

function BalanceCard({ p, onSave }: { p: ProviderBalance; onSave: (provider: string, balance: number | null, low: string) => Promise<string | null> }) {
  const st = STATUS[p.status];
  const [editing, setEditing] = useState(false);
  const [bal, setBal] = useState("");
  const [low, setLow] = useState(p.lowUsd != null ? String(p.lowUsd) : "");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const save = async (clear = false) => {
    setBusy(true); setErr(null);
    const e = await onSave(p.key, clear ? null : Number(bal), low);
    setBusy(false);
    if (e) setErr(e); else { setEditing(false); setBal(""); }
  };

  const money = p.remainingUsd != null || p.balanceUsd != null;
  const pctMoney = p.remainingUsd != null && p.balanceUsd ? (p.remainingUsd / p.balanceUsd) * 100 : null;

  return (
    <div className="flex flex-col gap-3 p-4 rounded-xl border bg-[#0a0a0a] min-w-0" style={{ borderColor: p.status === "critical" ? "rgba(255,68,68,0.35)" : p.status === "low" ? "rgba(245,166,35,0.3)" : "#161616" }}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[14px] font-semibold text-[#ededed] truncate">{p.name}</div>
          <div className="text-[12px] text-[#555] mt-0.5">{p.plan ?? SOURCE[p.source]}</div>
        </div>
        <span className="shrink-0 px-2 py-0.5 rounded-full text-[11px] font-semibold" style={{ color: st.fg, background: st.bg }}>{st.label}</span>
      </div>

      {money && (
        <div>
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-[22px] font-semibold tabular-nums tracking-tight" style={{ color: p.status === "unknown" ? "#ededed" : st.fg }}>
              {p.remainingUsd != null ? usd(p.remainingUsd) : "?"}
            </span>
            <span className="text-[12px] text-[#555]">left</span>
          </div>
          {pctMoney != null && <div className="mt-2"><Bar pctLeft={pctMoney} color={st.bar} /></div>}
          <div className="text-[12px] text-[#666] mt-2 leading-relaxed">
            {p.balanceUsd != null && <>{usd(p.balanceUsd)} on {fmtFull(p.setAt ?? undefined)}</>}
            {p.spentUsd != null && <>, {usd(p.spentUsd)} spent since</>}
            {p.lowUsd != null && <> · warns under {usd(p.lowUsd)}</>}
          </div>
        </div>
      )}

      {p.meters?.map(m => {
        const left = Math.max(0, m.limit - m.used);
        const pct = m.limit > 0 ? (left / m.limit) * 100 : 0;
        const ms: BalanceStatus = m.limit > 0 ? (pct < 5 ? "critical" : pct < 20 ? "low" : "ok") : "unknown";
        return (
          <div key={m.label}>
            <div className="flex items-baseline justify-between gap-2 text-[12px] mb-1.5">
              <span className="text-[#aaa]">{m.label}</span>
              <span className="tabular-nums text-[#888]">
                <span style={{ color: STATUS[ms].fg }} className="font-semibold">{amount(left, m.unit)}</span> left of {amount(m.limit, m.unit)}
              </span>
            </div>
            <Bar pctLeft={pct} color={STATUS[ms].bar} />
          </div>
        );
      })}

      {p.resetsAt && <div className="text-[12px] text-[#555]">Resets {fmtFull(p.resetsAt)}</div>}
      {p.error && <div className="text-[12px] text-[#f44]">{p.error}</div>}
      {p.note && <div className="text-[12px] text-[#555] leading-relaxed">{p.note}</div>}

      {editing && (
        <div className="flex flex-col gap-2 pt-1">
          <div className="grid grid-cols-2 gap-2">
            <label className="block">
              <span className="block text-[11px] text-[#777] mb-1">Balance now ($)</span>
              <input type="number" min={0} step="0.01" value={bal} onChange={e => setBal(e.target.value)} className={`${inputCls} h-8 py-0`} placeholder="e.g. 25.00" autoFocus />
            </label>
            <label className="block">
              <span className="block text-[11px] text-[#777] mb-1">Warn under ($)</span>
              <input type="number" min={0} step="0.01" value={low} onChange={e => setLow(e.target.value)} className={`${inputCls} h-8 py-0`} placeholder="optional" />
            </label>
          </div>
          <p className="text-[11px] text-[#555] leading-relaxed">Copy it from the provider&apos;s billing page. Spend from now on is subtracted automatically.</p>
          {err && <div className="text-[12px] text-[#f44]">{err}</div>}
          <div className="flex items-center gap-2">
            <button onClick={() => void save()} disabled={busy || bal === "" || !(Number(bal) >= 0)}
              className="px-3 h-8 rounded-lg text-[12px] font-semibold border-none cursor-pointer bg-[#ededed] text-black hover:bg-white disabled:opacity-40 disabled:cursor-not-allowed">
              {busy ? "Saving…" : "Save balance"}
            </button>
            <button onClick={() => { setEditing(false); setErr(null); }} className="px-3 h-8 rounded-lg text-[12px] text-[#888] bg-transparent border border-[#222] cursor-pointer hover:text-[#ededed]">Cancel</button>
            {p.balanceUsd != null && (
              <button onClick={() => void save(true)} disabled={busy} className="ml-auto text-[12px] text-[#777] hover:text-[#f44] bg-transparent border-none cursor-pointer p-0">Stop tracking</button>
            )}
          </div>
        </div>
      )}

      <div className="flex items-center gap-2 mt-auto pt-1">
        <a href={p.manageUrl} target="_blank" rel="noopener noreferrer"
          className={`px-3 h-8 inline-flex items-center rounded-lg text-[12px] font-semibold no-underline transition-colors ${p.status === "critical" || p.status === "low" ? "bg-[#ededed] text-black hover:bg-white" : "border border-[#222] text-[#aaa] hover:text-[#ededed] hover:border-[#3a3a3a]"}`}>
          {p.source === "live" || p.source === "counted" ? (p.plan?.toLowerCase().includes("free") ? "Upgrade plan" : "Manage plan") : p.editable ? "Add credit" : "Open console"} ↗
        </a>
        {p.editable && !editing && (
          <button onClick={() => setEditing(true)} className="px-3 h-8 rounded-lg text-[12px] text-[#aaa] bg-transparent border border-[#222] cursor-pointer hover:text-[#ededed] hover:border-[#3a3a3a]">
            {p.balanceUsd != null ? "Update balance" : "Enter balance"}
          </button>
        )}
      </div>
    </div>
  );
}

export function BalancesPanel({ token = "" }: { token?: string }) {
  const headers: Record<string, string> = token ? { "x-admin-token": token } : {};
  const [data, setData] = useState<{ providers: ProviderBalance[]; tableMissing: boolean } | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch("/api/admin?action=provider_balances", { headers });
      const j = await r.json();
      if (!r.ok || j.error) throw new Error(j.error ?? `HTTP ${r.status}`);
      setData(j); setError("");
    } catch (e) { setError((e as Error).message); }
    setLoading(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);
  useEffect(() => { void Promise.resolve().then(load); }, [load]);

  const save = async (provider: string, balanceUsd: number | null, lowUsd: string) => {
    const r = await fetch("/api/admin", {
      method: "POST", headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify({ action: "provider_balance_set", provider, balanceUsd, lowUsd }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || j.error) return j.error ?? `HTTP ${r.status}`;
    await load();
    return null;
  };

  const list = [...(data?.providers ?? [])].sort((a, b) => ORDER.indexOf(a.status) - ORDER.indexOf(b.status));
  const alerts = list.filter(p => p.status === "critical" || p.status === "low");

  return (
    <section className="mb-6">
      <div className="flex items-center justify-between gap-3 mb-3">
        <div>
          <h3 className="text-[15px] font-semibold text-[#ededed] tracking-tight">What&apos;s left</h3>
          <p className="text-[12px] text-[#555] mt-0.5">
            {!data ? "Checking each service…" : alerts.length ? `${alerts.length} service${alerts.length === 1 ? "" : "s"} running low` : "Nothing is running low"}
          </p>
        </div>
        <button onClick={() => void load()} disabled={loading}
          className="px-3 py-1.5 text-[12px] font-semibold text-[#888] border border-[#2a2a2a] rounded-lg hover:text-[#ededed] hover:border-[#555] cursor-pointer bg-transparent disabled:opacity-50">
          {loading ? "Checking…" : "Check again"}
        </button>
      </div>
      {error && <div className="mb-3 p-3 rounded-lg text-[13px] text-[#f44] bg-[rgba(255,68,68,0.06)] border border-[rgba(255,68,68,0.2)]">{error}</div>}
      {data?.tableMissing && <div className="mb-3 p-3 rounded-lg text-[13px] text-[#f5a623] bg-[rgba(245,166,35,0.06)] border border-[rgba(245,166,35,0.2)]">Run Dashboard migration 0054 to save balances.</div>}
      <div className="grid gap-3 grid-cols-1 md:grid-cols-2 xl:grid-cols-3">
        {!data
          ? Array.from({ length: 6 }, (_, i) => <div key={i} className="skeleton h-44 rounded-xl" />)
          : list.map(p => <BalanceCard key={p.key} p={p} onSave={save} />)}
      </div>
    </section>
  );
}
