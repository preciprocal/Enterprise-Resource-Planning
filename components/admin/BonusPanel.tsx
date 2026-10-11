// components/admin/BonusPanel.tsx
// Users → Bonuses: give a user extra credits, now or on their next purchase.
//
// A pack is the template: its features are what can be given, and the
// presets are a share of what that pack grants (Low 25%, Moderate 50%,
// High 75%, Full 100%). Every amount stays editable for a custom number.
//
//   Give now           credits appear on their account at once (a credit_packs
//                      row with no payment, which the Refunds panel shows as
//                      "Bonus credits" and never refunds)
//   On next purchase   added automatically when they next buy that pack
//                      (pack_bonus_offers, Dashboard migration 0053)
"use client";

import { useCallback, useEffect, useState } from "react";
import { User, inputCls, fmtFull } from "./admin-shared";
import { Block, Empty } from "./ui-kit";
import { confirmDialog } from "@/components/ui/dialog-host";
import { PACKS, PACK_KEYS, FEATURE_LABELS, type PackKey } from "@/lib/packs";

const PRESETS = [
  { id: "low", label: "Low", pct: 25 },
  { id: "moderate", label: "Moderate", pct: 50 },
  { id: "high", label: "High", pct: 75 },
  { id: "full", label: "Full", pct: 100 },
] as const;

interface Granted { id: string; packKey: string; granted: Record<string, number>; consumed: Record<string, number>; at: string; revokedAt: string | null }
interface Offer { id: string; packKey: string; bonus: Record<string, number>; reason: string | null; at: string; claimedAt: string | null }

const label = (k: string) => FEATURE_LABELS[k] ?? k.replace(/([A-Z])/g, " $1").toLowerCase();
const describe = (m: Record<string, number>) => Object.entries(m).filter(([, n]) => n > 0).map(([k, n]) => `${n} ${label(k)}`).join(", ");
const scaled = (pack: PackKey, pct: number) =>
  Object.fromEntries(Object.entries(PACKS[pack].grants).map(([k, n]) => [k, Math.max(pct > 0 ? 1 : 0, Math.round((n * pct) / 100))]));

export function BonusPanel({ user, token = "" }: { user: User; token?: string }) {
  const headers = token ? { "x-admin-token": token } : undefined;
  const [packKey, setPackKey] = useState<PackKey>("networking_pack");
  const [preset, setPreset] = useState<string>("moderate");
  const [amounts, setAmounts] = useState<Record<string, number>>(() => scaled("networking_pack", 50));
  const [mode, setMode] = useState<"now" | "next_purchase">("now");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [list, setList] = useState<{ granted: Granted[]; offers: Offer[] | null } | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch(`/api/admin?action=user_bonuses&id=${encodeURIComponent(user.id)}`, { headers });
      const j = await r.json();
      if (!r.ok || j.error) throw new Error(j.error ?? `HTTP ${r.status}`);
      setList(j);
    } catch (e) { setMsg({ ok: false, text: `Could not load bonuses: ${(e as Error).message}` }); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user.id, token]);
  useEffect(() => { void Promise.resolve().then(load); }, [load]);

  const choosePack = (k: PackKey) => {
    setPackKey(k);
    const p = PRESETS.find(x => x.id === preset);
    setAmounts(scaled(k, p?.pct ?? 50));
  };
  const choosePreset = (id: string) => {
    const p = PRESETS.find(x => x.id === id)!;
    setPreset(id); setAmounts(scaled(packKey, p.pct));
  };
  const setAmount = (k: string, v: string) => {
    setPreset("custom");
    setAmounts(a => ({ ...a, [k]: Math.max(0, Math.min(PACKS[packKey].grants[k] * 10, Math.round(Number(v) || 0))) }));
  };
  const total = Object.values(amounts).reduce((s, n) => s + n, 0);

  async function submit() {
    const what = describe(amounts);
    const ok = await confirmDialog({
      title: mode === "now" ? "Give these credits now?" : "Add a bonus to their next purchase?",
      message: mode === "now"
        ? `${user.name ?? user.email} gets ${what} straight away, free.`
        : `When ${user.name ?? user.email} next buys the ${PACKS[packKey].name}, they also get ${what}.`,
      confirmLabel: mode === "now" ? "Give credits" : "Add bonus",
    });
    if (!ok) return;
    setBusy(true); setMsg(null);
    try {
      const r = await fetch("/api/admin", {
        method: "POST", headers: { "Content-Type": "application/json", ...(headers ?? {}) },
        body: JSON.stringify({ action: "bonus_grant", id: user.id, mode, packKey, bonus: amounts, reason }),
      });
      const j = await r.json();
      if (!r.ok || j.error) throw new Error(j.error ?? `HTTP ${r.status}`);
      setMsg({ ok: true, text: mode === "now" ? `Gave ${what}.` : `Bonus of ${what} added to their next ${PACKS[packKey].name}.` });
      setReason("");
      await load();
    } catch (e) { setMsg({ ok: false, text: (e as Error).message }); }
    setBusy(false);
  }

  async function revoke(kind: "pack" | "offer", id: string, what: string) {
    if (!(await confirmDialog({ title: kind === "offer" ? "Remove this offer?" : "Remove these bonus credits?", message: kind === "offer" ? `The bonus (${what}) will not be added to their next purchase.` : `Unused credits (${what}) are taken off their account.`, confirmLabel: "Remove", tone: "danger" }))) return;
    setMsg(null);
    const r = await fetch("/api/admin", { method: "POST", headers: { "Content-Type": "application/json", ...(headers ?? {}) }, body: JSON.stringify({ action: "bonus_revoke", id: user.id, kind, bonusId: id }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || j.error) setMsg({ ok: false, text: j.error ?? `HTTP ${r.status}` });
    await load();
  }

  const L = "block text-[12px] font-medium text-[#888] mb-1.5";

  return (
    <div className="flex flex-col gap-7 min-w-0">
      <Block title="Give bonus credits">
        <div className="p-4 flex flex-col gap-5">
          <div>
            <span className={L}>Based on</span>
            <div className="flex flex-wrap gap-1.5">
              {PACK_KEYS.map(k => (
                <button key={k} onClick={() => choosePack(k)}
                  className={`px-3 h-8 rounded-lg border text-[13px] cursor-pointer transition-colors ${packKey === k ? "bg-[#ededed] border-[#ededed] text-black font-medium" : "bg-transparent border-[#222] text-[#aaa] hover:border-[#3a3a3a] hover:text-[#ededed]"}`}>
                  {PACKS[k].name}
                </button>
              ))}
            </div>
            <p className="text-[12px] text-[#555] mt-1.5">The pack gives {describe(PACKS[packKey].grants)}.</p>
          </div>

          <div>
            <span className={L}>Amount</span>
            <div className="flex flex-wrap gap-1.5">
              {PRESETS.map(p => (
                <button key={p.id} onClick={() => choosePreset(p.id)}
                  className={`px-3 h-8 rounded-lg border text-[13px] cursor-pointer transition-colors ${preset === p.id ? "bg-[rgba(99,102,241,0.15)] border-[rgba(99,102,241,0.5)] text-[#c7d2fe] font-medium" : "bg-transparent border-[#222] text-[#aaa] hover:border-[#3a3a3a] hover:text-[#ededed]"}`}>
                  {p.label} <span className="text-[#666] ml-1">{p.pct}%</span>
                </button>
              ))}
              <span className={`px-3 h-8 inline-flex items-center rounded-lg border text-[13px] ${preset === "custom" ? "border-[rgba(99,102,241,0.5)] text-[#c7d2fe]" : "border-transparent text-[#555]"}`}>Custom</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-2 mt-3">
              {Object.keys(PACKS[packKey].grants).map(k => (
                <label key={k} className="flex items-center justify-between gap-3 px-3 py-2 rounded-lg border border-[#1a1a1a] bg-[#080808]">
                  <span className="text-[13px] text-[#ccc] capitalize">{label(k)}</span>
                  <span className="flex items-center gap-2">
                    <input type="number" min={0} max={PACKS[packKey].grants[k] * 10} value={amounts[k] ?? 0} onChange={e => setAmount(k, e.target.value)}
                      className={`${inputCls} w-20 h-8 py-0 text-right tabular-nums`} aria-label={`${label(k)} credits`} />
                    <span className="text-[11px] text-[#555] w-12">of {PACKS[packKey].grants[k]}</span>
                  </span>
                </label>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-[auto_1fr] gap-4 items-start">
            <div>
              <span className={L}>When</span>
              <div className="inline-flex gap-0.5 bg-[#0a0a0a] border border-[#1a1a1a] rounded-lg p-0.5">
                {(["now", "next_purchase"] as const).map(m => (
                  <button key={m} onClick={() => setMode(m)}
                    className={`px-3.5 h-8 rounded-md text-[13px] font-medium border-none cursor-pointer ${mode === m ? "bg-[#1a1a1a] text-[#ededed]" : "bg-transparent text-[#666] hover:text-[#aaa]"}`}>
                    {m === "now" ? "Give now" : `On next ${PACKS[packKey].name} purchase`}
                  </button>
                ))}
              </div>
            </div>
            <label className="block">
              <span className={L}>Reason (internal)</span>
              <input value={reason} onChange={e => setReason(e.target.value)} maxLength={300} className={inputCls} placeholder="e.g. Purchase failed on our side" />
            </label>
          </div>

          {msg && <div role="status" className={`px-3 py-2 rounded-lg text-[13px] border ${msg.ok ? "text-[#3ecf8e] bg-[rgba(62,207,142,0.06)] border-[rgba(62,207,142,0.2)]" : "text-[#f44] bg-[rgba(255,68,68,0.06)] border-[rgba(255,68,68,0.2)]"}`}>{msg.text}</div>}

          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="text-[12px] text-[#666]">{total ? describe(amounts) : "Nothing selected"}</span>
            <button onClick={submit} disabled={busy || total === 0}
              className="px-4 h-9 rounded-lg text-[13px] font-semibold border-none cursor-pointer bg-[#ededed] text-black hover:bg-white disabled:opacity-40 disabled:cursor-not-allowed">
              {busy ? "Saving…" : mode === "now" ? "Give credits" : "Add bonus offer"}
            </button>
          </div>
        </div>
      </Block>

      <Block title="Bonuses for this user" count={(list?.granted.length ?? 0) + (list?.offers?.length ?? 0) || undefined}>
        {!list ? <div className="p-4"><div className="skeleton h-16 rounded-lg" /></div>
          : list.granted.length + (list.offers?.length ?? 0) === 0 ? <Empty>No bonuses yet</Empty> : (
          <ul className="divide-y divide-[#111]">
            {(list.offers ?? []).map(o => (
              <li key={o.id} className="px-4 py-3 flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="text-[13px] text-[#ddd]">{describe(o.bonus)} <span className="text-[#666]">on next {PACKS[o.packKey as PackKey]?.name ?? o.packKey}</span></div>
                  <div className="text-[12px] text-[#555] mt-0.5">{o.claimedAt ? `Used ${fmtFull(o.claimedAt)}` : `Waiting since ${fmtFull(o.at)}`}{o.reason ? ` · ${o.reason}` : ""}</div>
                </div>
                {!o.claimedAt && <button onClick={() => void revoke("offer", o.id, describe(o.bonus))} className="shrink-0 text-[12px] text-[#888] hover:text-[#f44] bg-transparent border-none cursor-pointer p-0">Remove</button>}
              </li>
            ))}
            {list.granted.map(g => {
              const left = Object.fromEntries(Object.entries(g.granted).map(([k, n]) => [k, Math.max(0, n - (g.consumed?.[k] ?? 0))]));
              return (
                <li key={g.id} className="px-4 py-3 flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className={`text-[13px] ${g.revokedAt ? "text-[#555] line-through" : "text-[#ddd]"}`}>{describe(g.granted)}</div>
                    <div className="text-[12px] text-[#555] mt-0.5">Given {fmtFull(g.at)}{g.revokedAt ? ` · removed ${fmtFull(g.revokedAt)}` : ` · ${describe(left) || "all used"} left`}</div>
                  </div>
                  {!g.revokedAt && <button onClick={() => void revoke("pack", g.id, describe(left))} className="shrink-0 text-[12px] text-[#888] hover:text-[#f44] bg-transparent border-none cursor-pointer p-0">Remove</button>}
                </li>
              );
            })}
          </ul>
        )}
        {list?.offers === null && <p className="px-4 py-2.5 text-[12px] text-[#f5a623] border-t border-[#141414]">Offers on next purchase need Dashboard migration 0053.</p>}
      </Block>
    </div>
  );
}
