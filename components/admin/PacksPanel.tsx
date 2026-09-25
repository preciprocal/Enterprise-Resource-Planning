// components/admin/PacksPanel.tsx
// One-time Stripe credit packs: configured price IDs (STRIPE_PACK_*_PRICE_ID),
// sales from the credit_packs ledger, and recent purchases.
"use client";
import { useEffect, useState } from "react";
import { SL, Card, CardTitle, MetricCard, Chip, CodeRef, SkeletonMetricCard, useIsMobile, fmtFull } from "./admin-shared";
import { FEATURE_LABELS } from "@/lib/packs";

interface PackRow {
  key: string; name: string; priceUsd: number; grants: Record<string, number>;
  envVar: string; priceId: string | null;
  sold: number; refunded: number; revenueCents: number; buyers: number;
}
interface Purchase {
  userId: string; userName?: string; userEmail?: string; packKey: string; packName: string;
  priceCents: number; purchasedAt: string; refundedAt: string | null;
  granted: Record<string, number>; consumed: Record<string, number>;
}
interface PacksResponse {
  packs: PackRow[]; recent: Purchase[]; checkoutEnabled: boolean;
  totals: { sold: number; revenueCents: number; buyers: number };
  error?: string;
}

const usd = (cents: number) => `$${(cents / 100).toFixed(2)}`;
const grantText = (g: Record<string, number>) =>
  Object.entries(g).map(([k, v]) => `${v} ${FEATURE_LABELS[k] ?? k}`).join(" · ");

export default function PacksPanel({ token }: { token: string }) {
  const isMobile = useIsMobile();
  const [data, setData]   = useState<PacksResponse | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!token) return;
    fetch("/api/admin?action=packs", { headers: { "x-admin-token": token }, cache: "no-store" })
      .then(r => r.json() as Promise<PacksResponse>)
      .then(j => { if (j.error) throw new Error(j.error); setData(j); })
      .catch(e => setError((e as Error).message));
  }, [token]);

  if (error) return (
    <section><SL>Credit Packs</SL><Card><div className="text-[13px] text-[#f44]">{error}</div></Card></section>
  );

  return (
    <section>
      <SL>Credit Packs <CodeRef k="packs" /></SL>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
        {!data ? Array.from({ length: 4 }).map((_, i) => <SkeletonMetricCard key={i} />) : <>
          <MetricCard label="Packs Sold"   value={data.totals.sold}                 color="#ededed" />
          <MetricCard label="Pack Revenue" value={usd(data.totals.revenueCents)}    color="#3ecf8e" sub="Excl. refunds" />
          <MetricCard label="Buyers"       value={data.totals.buyers}               color="#0070f3" />
          <MetricCard label="Checkout"     value={data.checkoutEnabled ? "On" : "Off"}
            color={data.checkoutEnabled ? "#3ecf8e" : "#f5a623"} sub="Set in Dashboard env" />
        </>}
      </div>

      {data && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          <Card className={isMobile ? "" : "p-0 overflow-hidden"}>
            {isMobile ? (
              <div className="flex flex-col gap-2">
                <CardTitle>Catalog</CardTitle>
                {data.packs.map(p => (
                  <div key={p.key} className="bg-[#111] border border-[#1a1a1a] rounded-lg px-3.5 py-3">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[13px] font-semibold text-[#ededed]">{p.name}</span>
                      <span className="text-[13px] font-bold text-[#ededed]">${p.priceUsd.toFixed(2)}</span>
                    </div>
                    <div className="text-[11px] text-[#555] mb-1.5">{grantText(p.grants)}</div>
                    <code className={`font-mono text-[11px] break-all ${p.priceId ? "text-[#0070f3]" : "text-[#f44]"}`}>{p.priceId ?? `${p.envVar} not set`}</code>
                    <div className="text-[11px] text-[#888] mt-1">{p.sold} sold · {usd(p.revenueCents)}</div>
                  </div>
                ))}
              </div>
            ) : (
              <table className="w-full border-collapse">
                <thead><tr className="bg-[#111] border-b border-[#1a1a1a]">
                  {["Pack", "Price ID", "Price", "Sold", "Revenue"].map(h =>
                    <th key={h} className="px-4 py-2.5 text-left text-[11px] font-bold text-[#555] uppercase tracking-wider">{h}</th>)}
                </tr></thead>
                <tbody>
                  {data.packs.map(p => (
                    <tr key={p.key} className="border-b border-[#111] hover:bg-[#111] transition-colors align-top">
                      <td className="px-4 py-2.5">
                        <div className="text-[13px] font-semibold text-[#ededed]">{p.name}</div>
                        <div className="text-[11px] text-[#555] mt-0.5 max-w-60">{grantText(p.grants)}</div>
                      </td>
                      <td className="px-4 py-2.5">
                        {p.priceId
                          ? <code className="font-mono text-[11px] text-[#0070f3]">{p.priceId}</code>
                          : <span className="text-[11px] text-[#f44]">{p.envVar} not set</span>}
                      </td>
                      <td className="px-4 py-2.5 text-sm font-bold text-[#ededed]">${p.priceUsd.toFixed(2)}</td>
                      <td className="px-4 py-2.5 text-sm text-[#888]">{p.sold}{p.refunded > 0 && <span className="text-[#f44]"> ({p.refunded} ref.)</span>}</td>
                      <td className="px-4 py-2.5 text-sm font-semibold text-[#3ecf8e]">{usd(p.revenueCents)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>

          <Card>
            <CardTitle>Recent Purchases</CardTitle>
            {data.recent.length === 0 ? (
              <div className="text-[13px] text-[#555] py-6 text-center">No packs purchased yet</div>
            ) : (
              <div className="flex flex-col max-h-80 overflow-y-auto">
                {data.recent.map((r, i) => {
                  const left = Object.entries(r.granted ?? {}).reduce((s, [k, v]) => s + Math.max(0, v - (r.consumed?.[k] ?? 0)), 0);
                  const total = Object.values(r.granted ?? {}).reduce((s, v) => s + v, 0);
                  return (
                    <div key={`${r.userId}-${r.purchasedAt}-${i}`} className="flex items-center gap-3 py-2 border-b border-[#111] last:border-0">
                      <div className="flex-1 min-w-0">
                        <div className="text-[13px] text-[#ededed] truncate">{r.userName ?? r.userEmail ?? r.userId}</div>
                        <div className="text-[11px] text-[#555]">{fmtFull(r.purchasedAt)} · {left}/{total} credits left</div>
                      </div>
                      <Chip label={r.packName} className="bg-[rgba(168,85,247,0.08)] text-[#a855f7] border border-[rgba(168,85,247,0.2)] text-[11px]" />
                      <span className={`text-[13px] font-semibold shrink-0 ${r.refundedAt ? "text-[#f44] line-through" : "text-[#ededed]"}`}>{usd(r.priceCents)}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </Card>
        </div>
      )}
    </section>
  );
}
