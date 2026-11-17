// components/admin/PacksPanel.tsx
// One-time Stripe credit packs: configured price IDs (STRIPE_PACK_*_PRICE_ID),
// sales from the credit_packs ledger, and recent purchases.
"use client";
import { useEffect, useState } from "react";
import { SL, Card, CardTitle, MetricCard, CodeRef, SkeletonMetricCard, useIsMobile, fmtFull } from "./admin-shared";
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
    <section><SL>Credit Packs</SL><Card><div className="text-[13px] text-danger-fg">{error}</div></Card></section>
  );

  return (
    <section>
      <SL>Credit Packs <CodeRef k="packs" /></SL>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
        {!data ? Array.from({ length: 4 }).map((_, i) => <SkeletonMetricCard key={i} />) : <>
          <MetricCard label="Packs Sold"   value={data.totals.sold}                 color="var(--fg)" />
          <MetricCard label="Pack Revenue" value={usd(data.totals.revenueCents)}    color="var(--success-fg)" sub="Excl. refunds" />
          <MetricCard label="Buyers"       value={data.totals.buyers}               color="var(--brand-fg)" />
          <MetricCard label="Checkout"     value={data.checkoutEnabled ? "On" : "Off"}
            color={data.checkoutEnabled ? "var(--success-fg)" : "var(--warning-fg)"} sub="Set in Dashboard env" />
        </>}
      </div>

      {data && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          <Card className={isMobile ? "" : "p-0 overflow-hidden"}>
            {isMobile ? (
              <div className="flex flex-col gap-2">
                <CardTitle>Catalog</CardTitle>
                {data.packs.map(p => (
                  <div key={p.key} className="bg-subtle border border-line-soft rounded-lg px-3.5 py-3">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[13px] font-semibold text-fg">{p.name}</span>
                      <span className="text-[13px] font-semibold text-fg num">${p.priceUsd.toFixed(2)}</span>
                    </div>
                    <div className="text-caption mb-1.5">{grantText(p.grants)}</div>
                    <code className={`font-mono text-[11px] break-all ${p.priceId ? "text-brand-fg" : "text-danger-fg"}`}>{p.priceId ?? `${p.envVar} not set`}</code>
                    <div className="text-[12px] text-fg-3 mt-1">{p.sold} sold · {usd(p.revenueCents)}</div>
                  </div>
                ))}
              </div>
            ) : (
              <table className="data-table">
                <thead><tr>
                  {["Pack", "Price ID", "Price", "Sold", "Revenue"].map(h =>
                    <th key={h}>{h}</th>)}
                </tr></thead>
                <tbody>
                  {data.packs.map(p => (
                    <tr key={p.key} className="align-top">
                      <td>
                        <div className="text-[13px] font-semibold text-fg">{p.name}</div>
                        <div className="text-caption mt-0.5 max-w-60">{grantText(p.grants)}</div>
                      </td>
                      <td>
                        {p.priceId
                          ? <code className="font-mono text-[11px] text-brand-fg">{p.priceId}</code>
                          : <span className="text-[11px] text-danger-fg">{p.envVar} not set</span>}
                      </td>
                      <td className="font-semibold text-fg num">${p.priceUsd.toFixed(2)}</td>
                      <td className="text-fg-3 num">{p.sold}{p.refunded > 0 && <span className="text-danger-fg"> ({p.refunded} ref.)</span>}</td>
                      <td className="font-semibold text-success-fg num">{usd(p.revenueCents)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>

          <Card>
            <CardTitle>Recent Purchases</CardTitle>
            {data.recent.length === 0 ? (
              <div className="empty">No packs purchased yet</div>
            ) : (
              <div className="flex flex-col max-h-80 overflow-y-auto">
                {data.recent.map((r, i) => {
                  const left = Object.entries(r.granted ?? {}).reduce((s, [k, v]) => s + Math.max(0, v - (r.consumed?.[k] ?? 0)), 0);
                  const total = Object.values(r.granted ?? {}).reduce((s, v) => s + v, 0);
                  return (
                    <div key={`${r.userId}-${r.purchasedAt}-${i}`} className="flex items-center gap-3 py-2 border-b border-line-soft last:border-0">
                      <div className="flex-1 min-w-0">
                        <div className="text-[13px] text-fg truncate">{r.userName ?? r.userEmail ?? r.userId}</div>
                        <div className="text-caption">{fmtFull(r.purchasedAt)} · {left}/{total} credits left</div>
                      </div>
                      <span className="badge badge-violet shrink-0">{r.packName}</span>
                      <span className={`text-[13px] font-semibold num shrink-0 ${r.refundedAt ? "text-danger-fg line-through" : "text-fg"}`}>{usd(r.priceCents)}</span>
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
