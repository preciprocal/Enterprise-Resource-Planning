// components/admin/BalancesPanel.tsx
// Usage → "What's left": remaining credit or plan headroom per outside
// service, sorted so whatever is running out comes first. Logic and sources
// in lib/provider-balances.ts.
"use client";

import { useCallback, useEffect, useState } from "react";
import { inputCls, fmtFull } from "./admin-shared";
import type { ProviderBalance, Meter, BalanceStatus } from "@/lib/provider-balances";

const STATUS: Record<BalanceStatus, { label: string; fg: string; badge: string; bar: string }> = {
  critical: { label: "Running out", fg: "var(--danger-fg)",  badge: "badge-danger",  bar: "var(--danger)" },
  low:      { label: "Low",         fg: "var(--warning-fg)", badge: "badge-warning", bar: "var(--warning)" },
  ok:       { label: "OK",          fg: "var(--success-fg)", badge: "badge-success", bar: "var(--success)" },
  unknown:  { label: "Not tracked", fg: "var(--fg-3)",       badge: "badge-neutral", bar: "var(--fg-5)" },
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
    <div className="h-1.5 rounded-full bg-raised-2 overflow-hidden">
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
    <div className="card card-pad flex flex-col gap-3" style={{ borderColor: p.status === "critical" ? "var(--danger-line)" : p.status === "low" ? "var(--warning-line)" : "var(--line)" }}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="section-title truncate">{p.name}</div>
          <div className="text-caption mt-0.5">{p.plan ?? SOURCE[p.source]}</div>
        </div>
        <span className={`badge ${st.badge} shrink-0`}>{st.label}</span>
      </div>

      {money && (
        <div>
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-[22px] font-semibold num tracking-tight" style={{ color: p.status === "unknown" ? "var(--fg)" : st.fg }}>
              {p.remainingUsd != null ? usd(p.remainingUsd) : "?"}
            </span>
            <span className="text-[12px] text-fg-4">left</span>
          </div>
          {pctMoney != null && <div className="mt-2"><Bar pctLeft={pctMoney} color={st.bar} /></div>}
          <div className="text-[12px] text-fg-4 mt-2 leading-relaxed">
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
              <span className="text-fg-3">{m.label}</span>
              <span className="num text-fg-3">
                <span style={{ color: STATUS[ms].fg }} className="font-semibold">{amount(left, m.unit)}</span> left of {amount(m.limit, m.unit)}
              </span>
            </div>
            <Bar pctLeft={pct} color={STATUS[ms].bar} />
          </div>
        );
      })}

      {p.resetsAt && <div className="text-[12px] text-fg-4">Resets {fmtFull(p.resetsAt)}</div>}
      {p.error && <div className="text-[12px] text-danger-fg">{p.error}</div>}
      {p.note && <div className="text-[12px] text-fg-4 leading-relaxed">{p.note}</div>}

      {editing && (
        <div className="flex flex-col gap-2 pt-1">
          <div className="grid grid-cols-2 gap-2">
            <label className="block">
              <span className="field-label">Balance now ($)</span>
              <input type="number" min={0} step="0.01" value={bal} onChange={e => setBal(e.target.value)} className={`${inputCls} field-sm`} placeholder="e.g. 25.00" autoFocus />
            </label>
            <label className="block">
              <span className="field-label">Warn under ($)</span>
              <input type="number" min={0} step="0.01" value={low} onChange={e => setLow(e.target.value)} className={`${inputCls} field-sm`} placeholder="optional" />
            </label>
          </div>
          <p className="text-caption">Copy it from the provider&apos;s billing page. Spend from now on is subtracted automatically.</p>
          {err && <div className="text-[12px] text-danger-fg">{err}</div>}
          <div className="flex items-center gap-2">
            <button onClick={() => void save()} disabled={busy || bal === "" || !(Number(bal) >= 0)}
              className="btn btn-sm btn-primary">
              {busy ? "Saving…" : "Save balance"}
            </button>
            <button onClick={() => { setEditing(false); setErr(null); }} className="btn btn-sm btn-ghost">Cancel</button>
            {p.balanceUsd != null && (
              <button onClick={() => void save(true)} disabled={busy} className="link ml-auto text-[12px] text-fg-3 hover:text-danger-fg">Stop tracking</button>
            )}
          </div>
        </div>
      )}

      <div className="flex items-center gap-2 mt-auto pt-1">
        <a href={p.manageUrl} target="_blank" rel="noopener noreferrer"
          className={`btn btn-sm ${p.status === "critical" || p.status === "low" ? "btn-primary" : "btn-secondary"}`}>
          {p.source === "live" || p.source === "counted" ? (p.plan?.toLowerCase().includes("free") ? "Upgrade plan" : "Manage plan") : p.editable ? "Add credit" : "Open console"} ↗
        </a>
        {p.editable && !editing && (
          <button onClick={() => setEditing(true)} className="btn btn-sm btn-secondary">
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
          <h3 className="section-title">What&apos;s left</h3>
          <p className="text-caption mt-0.5">
            {!data ? "Checking each service…" : alerts.length ? `${alerts.length} service${alerts.length === 1 ? "" : "s"} running low` : "Nothing is running low"}
          </p>
        </div>
        <button onClick={() => void load()} disabled={loading}
          className="btn btn-sm btn-secondary shrink-0">
          {loading ? "Checking…" : "Check again"}
        </button>
      </div>
      {error && <div className="mb-3 p-3 rounded-lg text-[13px] text-danger-fg bg-danger-soft border border-danger-line">{error}</div>}
      {data?.tableMissing && <div className="mb-3 p-3 rounded-lg text-[13px] text-warning-fg bg-warning-soft border border-warning-line">Run Dashboard migration 0054 to save balances.</div>}
      <div className="grid gap-3 grid-cols-1 md:grid-cols-2 xl:grid-cols-3">
        {!data
          ? Array.from({ length: 6 }, (_, i) => <div key={i} className="skeleton h-44 rounded-xl" />)
          : list.map(p => <BalanceCard key={p.key} p={p} onSave={save} />)}
      </div>
    </section>
  );
}
