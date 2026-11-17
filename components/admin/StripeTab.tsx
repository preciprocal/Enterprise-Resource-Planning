// components/admin/StripeTab.tsx
"use client";
import { confirmDialog } from "@/components/ui/dialog-host";
import { useState, useMemo, useEffect } from "react";
import {
  User, AnalyticsData, PRICE_IDS_MAP, WEBHOOK_EVENTS,
  planColor, statusColor, fmtFull,
  MetricCard, StatusDot, Avatar, CodeRef, SL, Card, CardTitle, Spinner, FRow, useIsMobile,
  inputCls, Select, Checkbox,
} from "./admin-shared";
import { FollowUpPanel } from "./FollowUp";

interface Props { analytics: AnalyticsData | null; users: User[]; loading: boolean; token?: string; }

export interface StripeCoupon {
  id: string; name: string; amountOff: number | null; percentOff: number | null;
  currency: string | null; duration: string; durationMonths: number | null;
  timesRedeemed: number; maxRedemptions: number | null; valid: boolean;
}

export function apiCall(action: string, payload: Record<string, unknown>, token = "") {
  return fetch("/api/admin", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(token ? { "x-admin-token": token } : {}) },
    body: JSON.stringify({ action, ...payload }),
  });
}
export function toDateInput(iso?: string) { if (!iso) return ""; try { return new Date(iso).toISOString().slice(0,10); } catch { return ""; } }
export function fromDateInput(v: string) { return v ? new Date(v).toISOString() : ""; }

export function couponLabel(c: StripeCoupon) {
  const disc = c.percentOff ? `${c.percentOff}% off` : c.amountOff ? `$${(c.amountOff / 100).toFixed(2)} off` : "discount";
  const dur = c.duration === "repeating" && c.durationMonths ? `${c.durationMonths}mo` : c.duration;
  return `${c.name} · ${disc} · ${dur}`;
}

type Toast = { msg: string; type: "ok"|"err" };
function ToastBanner({ toast }: { toast: Toast | null }) {
  if (!toast) return null;
  return (
    <div className={`fixed bottom-7 right-7 z-[999] px-4 py-3 rounded-xl font-semibold text-[13px] border ${toast.type==="ok" ? "bg-success-soft text-success-fg border-success-line" : "bg-danger-soft text-danger-fg border-danger-line"}`}>
      {toast.type==="ok" ? "✓ " : "✗ "}{toast.msg}
    </div>
  );
}

// ─── Coupon card grid ─────────────────────────────────────────────────────────

export function CouponGrid({
  coupons, loading, selectedId, onSelect,
}: {
  coupons: StripeCoupon[]; loading: boolean; selectedId: string; onSelect: (id: string) => void;
}) {
  const valid = coupons.filter(c => c.valid);
  if (loading) return <div className="text-caption py-3">Loading coupons from Stripe…</div>;
  if (!valid.length) return <div className="text-caption py-3">No active coupons in Stripe.</div>;
  return (
    <div className="flex flex-col gap-1.5 max-h-[220px] overflow-y-auto pr-0.5">
      {valid.map(c => {
        const disc = c.percentOff ? `${c.percentOff}% off` : c.amountOff ? `$${(c.amountOff/100).toFixed(2)} off` : "discount";
        const dur = c.duration === "repeating" && c.durationMonths ? `${c.durationMonths}mo` : c.duration;
        const isSel = selectedId === c.id;
        const is100 = c.percentOff === 100;
        return (
          <button key={c.id} onClick={() => onSelect(isSel ? "" : c.id)}
            className={`w-full text-left px-3 py-2.5 rounded-lg border transition-colors cursor-pointer ${
              isSel
                ? "bg-brand-soft border-brand-line text-fg"
                : "bg-subtle border-line text-fg hover:border-line-hover"
            }`}>
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <div className={`w-3.5 h-3.5 rounded-full border-2 shrink-0 flex items-center justify-center ${isSel ? "border-brand bg-brand" : "border-line-hover bg-transparent"}`}>
                  {isSel && <div className="w-1.5 h-1.5 rounded-full bg-white" />}
                </div>
                <span className="text-[13px] font-semibold truncate">{c.name}</span>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <span className={`badge ${is100 ? "badge-success" : "badge-brand"}`}>{disc}</span>
                <span className="text-caption">{dur}</span>
              </div>
            </div>
            <div className="flex items-center gap-2 mt-1 pl-5">
              <span className="font-mono text-[11px] text-fg-5 truncate">{c.id}</span>
              {c.timesRedeemed > 0 && <span className="text-[11px] text-fg-5">{c.timesRedeemed} used</span>}
              {c.maxRedemptions && <span className="text-[11px] text-fg-5">max {c.maxRedemptions}</span>}
            </div>
          </button>
        );
      })}
    </div>
  );
}

// ─── Plan editor (with optional coupon) ──────────────────────────────────────

export function PlanEditorPanel({ user, onSaved, isMobile, token = "", coupons, loadingCoupons }: {
  user: User; onSaved: (u: User) => void; isMobile: boolean; token?: string;
  coupons: StripeCoupon[]; loadingCoupons: boolean;
}) {
  const sub = user.subscription ?? {};
  // Start on the user's CURRENT plan. (This used to require billing === "Monthly",
  // which Free never matches, so free users defaulted to Pro — one click on Apply
  // away from creating a real Pro subscription.)
  const [priceId,setPriceId]         = useState(() => {
    const plan = sub.plan ?? "free";
    const matches = Object.entries(PRICE_IDS_MAP).filter(([,v]) => v.plan === plan);
    return (matches.find(([,v]) => v.billing === "Monthly") ?? matches[0])?.[0] ?? "";
  });
  const unchanged = PRICE_IDS_MAP[priceId]?.plan === (sub.plan ?? "free");
  const [periodStart,setPeriodStart] = useState(toDateInput(sub.currentPeriodStart));
  const [periodEnd,  setPeriodEnd]   = useState(toDateInput(sub.currentPeriodEnd));
  const [trialEnd,   setTrialEnd]    = useState(toDateInput(sub.trialEndsAt));
  const [cancelEoP,  setCancelEoP]   = useState(false);
  const [undoCancel, setUndoCancel]  = useState(false);
  const [couponId,   setCouponId]    = useState("");
  const [working,    setWorking]     = useState(false);
  const [err,        setErr]         = useState("");
  const selectedPrice  = PRICE_IDS_MAP[priceId];
  const selectedCoupon = coupons.find(c => c.id === couponId);
  // Nothing to send to Stripe — keep Apply disabled so a stray click is harmless.
  const noChanges = unchanged && !couponId && !cancelEoP && !undoCancel
    && periodStart === toDateInput(sub.currentPeriodStart)
    && periodEnd   === toDateInput(sub.currentPeriodEnd)
    && trialEnd    === toDateInput(sub.trialEndsAt);

  async function apply() {
    // These go straight to Stripe: a plan change bills the prorated difference
    // at once, and cancelling ends their paid plan.
    const what = priceId === "__free__" ? `cancel ${user.email ?? "this user"}'s subscription at the end of the period`
      : !unchanged ? `change ${user.email ?? "this user"} to ${selectedPrice?.label ?? "this plan"}. Stripe charges or credits the difference immediately`
      : `update ${user.email ?? "this user"}'s subscription in Stripe`;
    if (!(await confirmDialog({ title: priceId === "__free__" ? "Cancel this subscription?" : "Update this subscription in Stripe?", message: `This will ${what}.`, confirmLabel: priceId === "__free__" ? "Cancel subscription" : "Apply changes", tone: priceId === "__free__" ? "danger" : "default" }))) return;
    setWorking(true); setErr("");
    try {
      const sd: Record<string,unknown> = { priceId, plan: selectedPrice?.plan ?? "free" };
      if (periodStart) sd.periodStart = fromDateInput(periodStart);
      if (periodEnd)   sd.periodEnd   = fromDateInput(periodEnd);
      if (trialEnd)    sd.trialEnd    = fromDateInput(trialEnd);
      if (cancelEoP)   sd.cancelAtPeriodEnd = true;
      if (undoCancel)  sd.cancelAtPeriodEnd = false;
      const res  = await apiCall("stripe_update", { id: user.id, stripeData: sd }, token);
      const json = await res.json() as { success?: boolean; error?: string; subscription?: Record<string,unknown> };
      if (!res.ok || json.error) throw new Error(json.error ?? "Unknown error");

      // Apply coupon in same step if selected
      if (couponId) {
        const cr  = await apiCall("apply_coupon", { id: user.id, couponCode: couponId }, token);
        const cj  = await cr.json() as { success?: boolean; error?: string; applied?: string };
        if (!cr.ok || cj.error) throw new Error(`Plan updated, but coupon failed: ${cj.error ?? "Unknown"}`);
        onSaved({ ...user, subscription: { ...user.subscription, ...json.subscription, lastAppliedCoupon: cj.applied } });
      } else {
        onSaved({ ...user, subscription: { ...user.subscription, ...json.subscription } });
      }
    } catch (e) { setErr((e as Error).message); }
    setWorking(false);
  }

  return (
    <div className="flex flex-col gap-3.5">
      {/* Plan */}
      <div>
        <label className="field-label">Plan & Price</label>
        <Select value={priceId} onChange={e=>setPriceId(e.target.value)}>
          <option value="">Select price</option>
          {Object.entries(PRICE_IDS_MAP).map(([id,info]) => (
            <option key={id} value={id}>
              {info.plan}{info.billing ? ` · ${info.billing}` : ""} · {info.price}{info.plan === (sub.plan ?? "free") ? " (current)" : ""}
            </option>
          ))}
          <option value="__free__">free (cancel)</option>
        </Select>
        {selectedPrice && (
          <div className="flex items-center gap-2 mt-1.5">
            <span className={`badge ${planColor(selectedPrice.plan).tw}`}>{selectedPrice.plan}</span>
            <span className="text-[12px] text-fg-3">{selectedPrice.billing} · {selectedPrice.price}</span>
          </div>
        )}
      </div>

      {!sub.stripeSubscriptionId && (() => {
        // Free (or nothing) selected → nothing will be created in Stripe
        const noPaid = !priceId || priceId === "__free__" || selectedPrice?.plan === "free";
        return (
        <div className={`px-3.5 py-2.5 rounded-lg text-[12px] border ${noPaid ? "bg-warning-soft border-warning-line text-warning-fg" : "bg-brand-soft border-brand-line text-brand-fg"}`}>
          {noPaid
            ? "No Stripe subscription. Select a paid plan to create one in Stripe."
            : "No existing subscription. A new Stripe customer & subscription will be created automatically."}
        </div>
        );
      })()}

      {/* Coupon (optional) */}
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <label className="field-label mb-0!">Coupon (optional)</label>
          {couponId && (
            <button onClick={() => setCouponId("")} className="link text-[12px]">
              Clear
            </button>
          )}
        </div>
        <CouponGrid coupons={coupons} loading={loadingCoupons} selectedId={couponId} onSelect={setCouponId} />
        {couponId && selectedCoupon && (
          <div className="mt-2 px-3 py-2 bg-brand-soft border border-brand-line rounded-lg flex items-center gap-2">
            <svg className="text-brand-fg shrink-0" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg>
            <span className="text-[12px] text-brand-fg font-medium">{couponLabel(selectedCoupon)} will be applied</span>
          </div>
        )}
      </div>

      {/* Dates */}
      <div className={`grid gap-2.5 ${isMobile?"grid-cols-1":"grid-cols-3"}`}>
        {([["Period Start",periodStart,setPeriodStart],["Period End",periodEnd,setPeriodEnd],["Trial End",trialEnd,setTrialEnd]] as [string,string,(s:string)=>void][]).map(([l,v,set])=>(
          <div key={l}>
            <label className="field-label">{l}</label>
            <input type="date" value={v} onChange={e=>set(e.target.value)} className={inputCls} />
          </div>
        ))}
      </div>

      {sub.canceledAt && sub.plan && sub.plan !== "free" ? (
        // Already set to cancel: the only useful action is undoing it.
        <div className="flex items-center gap-2 cursor-pointer select-none" onClick={()=>setUndoCancel(v=>!v)}>
          <Checkbox checked={undoCancel} onChange={()=>setUndoCancel(v=>!v)} label="Undo the scheduled cancellation" />
          <span className="text-[13px] text-fg font-medium">Undo the scheduled cancellation</span>
          <span className="text-caption hidden sm:inline">(the plan renews as normal)</span>
        </div>
      ) : (
        <div className="flex items-center gap-2 cursor-pointer select-none" onClick={()=>setCancelEoP(v=>!v)}>
          <Checkbox checked={cancelEoP} onChange={()=>setCancelEoP(v=>!v)} label="Cancel at period end" />
          <span className="text-[13px] text-fg font-medium">Cancel at period end</span>
          <span className="text-caption hidden sm:inline">(keeps access until end date)</span>
        </div>
      )}

      {err && <div className="px-3 py-2 bg-danger-soft border border-danger-line rounded-lg text-[12px] text-danger-fg">{err}</div>}
      <button onClick={apply} disabled={working || noChanges} title={noChanges ? "Pick a different plan, change a date or add a coupon first" : undefined}
        className="btn btn-primary self-start">
        {working ? "Applying…" : couponId ? "Apply Plan + Coupon" : "Apply to Stripe + Supabase"}
      </button>
    </div>
  );
}

// ─── Coupon panel (standalone apply) ─────────────────────────────────────────

export function CouponPanel({ user, onDone, token = "", coupons, loadingCoupons }: {
  user: User; onDone: (m: string) => void; token?: string;
  coupons: StripeCoupon[]; loadingCoupons: boolean;
}) {
  const [selectedId, setSelectedId] = useState("");
  const [code,       setCode]       = useState("");
  const [working,    setWorking]    = useState(false);
  const [err,        setErr]        = useState("");

  async function apply(couponCode?: string) {
    const c = (couponCode ?? (selectedId || code)).trim();
    if (!c) { setErr("Select a coupon or enter a code"); return; }
    if (!(await confirmDialog({ title: `Apply coupon "${c}"?`, message: `It goes on ${user.email ?? "this user"}'s subscription and replaces any discount they already have. A 100%-off coupon also marks them as a verified student.`, confirmLabel: "Apply coupon" }))) return;
    setWorking(true); setErr("");
    try {
      const res  = await apiCall("apply_coupon", { id: user.id, couponCode: c }, token);
      const json = await res.json() as { success?: boolean; error?: string; applied?: string };
      if (!res.ok || json.error) throw new Error(json.error ?? "Unknown error");
      onDone(`Coupon "${json.applied}" applied`);
      setSelectedId(""); setCode("");
    } catch (e) { setErr((e as Error).message); }
    setWorking(false);
  }

  const selectedCoupon = coupons.find(c => c.id === selectedId);

  return (
    <div className="flex flex-col gap-4">
      {user.subscription?.lastAppliedCoupon && (
        <div className="px-3 py-2 bg-success-soft border border-success-line rounded-lg text-[12px] text-success-fg font-medium">
          Last applied: <strong>{user.subscription.lastAppliedCoupon}</strong>
          {user.subscription.lastCouponAppliedAt ? ` on ${fmtFull(user.subscription.lastCouponAppliedAt)}` : ""}
        </div>
      )}

      {/* Coupon cards */}
      <div>
        <div className="label mb-2">Select Coupon</div>
        <CouponGrid coupons={coupons} loading={loadingCoupons} selectedId={selectedId} onSelect={setSelectedId} />
      </div>

      {/* Apply button for selected coupon */}
      {selectedCoupon && (
        <div className="flex items-center gap-2 px-3.5 py-3 bg-brand-soft border border-brand-line rounded-lg">
          <div className="flex-1 min-w-0">
            <div className="text-[13px] font-semibold text-fg">{selectedCoupon.name}</div>
            <div className="text-caption mt-0.5">{couponLabel(selectedCoupon)}</div>
          </div>
          <button onClick={() => apply()} disabled={working || !user.subscription?.stripeCustomerId}
            className="btn btn-primary shrink-0">
            {working ? "Applying…" : "Apply to Account"}
          </button>
        </div>
      )}

      {/* Divider */}
      <div className="flex items-center gap-3">
        <div className="flex-1 h-px bg-line-soft" />
        <span className="label">or enter code manually</span>
        <div className="flex-1 h-px bg-line-soft" />
      </div>

      {/* Manual code */}
      <div className="flex gap-2">
        <input value={code} onChange={e=>setCode(e.target.value)} onKeyDown={e=>e.key==="Enter"&&apply()}
          placeholder="PROMO_CODE or coupon_id"
          className={`${inputCls} flex-1`} />
        <button onClick={()=>apply()} disabled={working || !user.subscription?.stripeCustomerId || !code.trim()}
          className="btn btn-secondary btn-lg">
          {working ? "…" : "Apply"}
        </button>
      </div>

      {!user.subscription?.stripeCustomerId && (
        <p className="text-caption">No Stripe customer ID on this user — assign a subscription first.</p>
      )}
      {err && <div className="px-3 py-2 bg-danger-soft border border-danger-line rounded-lg text-[12px] text-danger-fg">{err}</div>}
    </div>
  );
}

/** Follow-up emails to one user: templates, scheduling and open tracking (see FollowUp.tsx). */
export function ContactPanel({ user, onDone, token = "" }: { user:User; onDone:(m:string)=>void; token?: string }) {
  return <FollowUpPanel user={user} token={token} onDone={onDone} />;
}

// ─── Main StripeTab ───────────────────────────────────────────────────────────

export default function StripeTab({ analytics, users, loading, token = "" }: Props) {
  const isMobile = useIsMobile();
  const [search,setSearch]             = useState("");
  const [planFilter,setPlanFilter]     = useState("all");
  const [sortBy,setSortBy]             = useState("recent");
  const [selectedUser,setSelectedUser] = useState<User|null>(null);
  const [activePanel,setActivePanel]   = useState<"plan"|"coupon"|"contact">("plan");
  const [toast,setToast]               = useState<Toast|null>(null);
  const [healthOpen,setHealthOpen]     = useState(false);

  const [coupons,        setCoupons]        = useState<StripeCoupon[]>([]);
  const [loadingCoupons, setLoadingCoupons] = useState(true);

  useEffect(() => {
    setLoadingCoupons(true);
    (async () => {
      try {
        const res  = await fetch("/api/admin?action=coupons", { headers: token ? { "x-admin-token": token } : {} });
        const json = await res.json() as { coupons?: StripeCoupon[]; error?: string };
        if (res.ok && json.coupons) setCoupons(json.coupons);
        // A failed load used to look exactly like "no coupons exist".
        else showToast(`Could not load coupons: ${json.error ?? `HTTP ${res.status}`}`, "err");
      } catch (e) { showToast(`Could not load coupons: ${(e as Error).message}`, "err"); }
      setLoadingCoupons(false);
    })();
  }, [token]);

  const showToast = (msg: string, type: "ok"|"err" = "ok") => {
    setToast({ msg, type }); setTimeout(() => setToast(null), 4000);
  };

  const stripeUsers   = useMemo(()=>users.filter(u=>u.subscription?.stripeCustomerId||u.email),[users]);
  const filteredUsers = useMemo(()=>{
    let f = search.toLowerCase()
      ? stripeUsers.filter(u=>[u.name,u.email,u.subscription?.stripeCustomerId,u.subscription?.stripeSubscriptionId].some(v=>typeof v==="string"&&v.toLowerCase().includes(search.toLowerCase())))
      : stripeUsers;
    if (planFilter !== "all") f = f.filter(u => (u.subscription?.plan ?? "free") === planFilter);
    f = [...f].sort((a,b) => {
      if (sortBy === "name_asc")  return (a.name??"").localeCompare(b.name??"");
      if (sortBy === "name_desc") return (b.name??"").localeCompare(a.name??"");
      if (sortBy === "plan") {
        const order = ["enterprise","premium","pro","free"];
        return order.indexOf(a.subscription?.plan??"free") - order.indexOf(b.subscription?.plan??"free");
      }
      const da = a.subscription?.lastPaymentAt ?? a.createdAt ?? "";
      const db = b.subscription?.lastPaymentAt ?? b.createdAt ?? "";
      return db.localeCompare(da);
    });
    return f;
  },[stripeUsers,search,planFilter,sortBy]);

  if (loading) return <Spinner />;

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-canvas">
      <ToastBanner toast={toast} />

      {selectedUser ? (
        /* ── DETAIL VIEW ─────────────────────────────────── */
        <div className="flex-1 overflow-auto">
          <div className="p-4 md:p-6 flex flex-col gap-4 max-w-4xl mx-auto">
            <button onClick={()=>setSelectedUser(null)}
              className="btn btn-ghost btn-sm self-start -ml-2.5">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M19 12H5M12 5l-7 7 7 7"/></svg>
              Back to all users
            </button>

            {(()=>{
              const pc=planColor(selectedUser.subscription?.plan), sc=statusColor(selectedUser.subscription?.status);
              return (
                <div className="card overflow-hidden">
                  <div className="h-[2px]" style={{background:pc.accent}} />
                  <div className="p-4">
                    <div className="flex items-center gap-3 mb-3">
                      <Avatar name={selectedUser.name} size={44} />
                      <div className="flex-1 min-w-0">
                        <div className="text-[16px] font-semibold text-fg tracking-tight">{selectedUser.name??"Unknown"}</div>
                        <div className="text-[12px] text-fg-3 truncate mt-0.5">{selectedUser.email}</div>
                        <div className="flex items-center gap-2 mt-2 flex-wrap">
                          <span className={`badge ${pc.tw}`}>{selectedUser.subscription?.plan??"free"}</span>
                          <div className="flex items-center gap-1"><StatusDot color={sc.dot}/><span className="text-[12px] font-semibold" style={{color:sc.text}}>{selectedUser.subscription?.status??""}</span></div>
                          {selectedUser.subscription?.stripeCustomerId && <span className="badge badge-success">Stripe</span>}
                          {selectedUser.subscription?.lastAppliedCoupon && (
                            <span className="badge badge-brand">{`Coupon: ${selectedUser.subscription.lastAppliedCoupon}`}</span>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-x-5 gap-y-1.5">
                      {([["Customer ID",selectedUser.subscription?.stripeCustomerId],["Sub ID",selectedUser.subscription?.stripeSubscriptionId],["Period End",fmtFull(selectedUser.subscription?.currentPeriodEnd)],["UID",selectedUser.id]] as [string,string|undefined][]).map(([l,v])=>(
                        <div key={l} className="min-w-0">
                          <div className="label">{l}</div>
                          <div className="font-mono text-[12px] text-brand-fg mt-0.5 truncate">{v??""}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              );
            })()}

            <div className="tabs">
              {([
                { id:"plan",    label:"Change Plan",   icon:<svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><rect x="1" y="4" width="22" height="16" rx="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg> },
                { id:"coupon",  label:"Apply Coupon",  icon:<svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg> },
                { id:"contact", label:"Contact User",  icon:<svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg> },
              ] as {id:"plan"|"coupon"|"contact";label:string;icon:React.ReactNode}[]).map(p=>(
                <button key={p.id} onClick={()=>setActivePanel(p.id)}
                  className={`tab ${activePanel===p.id ? "tab-active" : ""}`}>
                  {p.icon}<span className={isMobile?"hidden sm:inline":""}>{p.label}</span>
                </button>
              ))}
            </div>

            <Card>
              {activePanel==="plan" && (
                <>
                  <CardTitle>Change Plan & Dates</CardTitle>
                  <PlanEditorPanel
                    user={selectedUser}
                    onSaved={u=>{ setSelectedUser(u); showToast(u.subscription?.lastAppliedCoupon ? "Plan + coupon applied in Stripe & Supabase" : "Plan updated in Stripe + Supabase"); }}
                    isMobile={isMobile} token={token}
                    coupons={coupons} loadingCoupons={loadingCoupons}
                  />
                </>
              )}
              {activePanel==="coupon" && (
                <>
                  <CardTitle>Apply Discount Coupon</CardTitle>
                  <CouponPanel
                    user={selectedUser} onDone={msg=>showToast(msg)} token={token}
                    coupons={coupons} loadingCoupons={loadingCoupons}
                  />
                </>
              )}
              {activePanel==="contact" && (
                <>
                  <CardTitle>Contact User</CardTitle>
                  <ContactPanel user={selectedUser} onDone={msg=>showToast(msg)} token={token} />
                </>
              )}
            </Card>

            <Card>
              <CardTitle>Current Subscription</CardTitle>
              <FRow label="Plan"         badgeLabel={selectedUser.subscription?.plan??"free"} badgeClassName={`border ${planColor(selectedUser.subscription?.plan).tw}`} />
              <FRow label="Status"       badgeLabel={selectedUser.subscription?.status??""} badgeClassName="bg-raised text-fg-3 border-line" />
              <FRow label="Period Start" value={fmtFull(selectedUser.subscription?.currentPeriodStart)} />
              <FRow label="Period End"   value={fmtFull(selectedUser.subscription?.currentPeriodEnd)} />
              <FRow label="Trial Ends"   value={fmtFull(selectedUser.subscription?.trialEndsAt)} />
              <FRow label="Canceled At"  value={fmtFull(selectedUser.subscription?.canceledAt)} />
              <FRow label="Last Payment" value={fmtFull(selectedUser.subscription?.lastPaymentAt)} />
              <FRow label="Last Coupon"  value={selectedUser.subscription?.lastAppliedCoupon} />
            </Card>
          </div>
        </div>
      ) : (
        /* ── GRID VIEW ─────────────────────────────────────── */
        <div className="flex-1 overflow-auto">
          <div className="p-4 md:p-6 flex flex-col gap-4">

            {/* Toolbar */}
            <div className="flex flex-col sm:flex-row gap-2">
              <div className="relative flex-1">
                <svg className="absolute left-3 top-1/2 -translate-y-1/2 text-fg-4 pointer-events-none" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>
                <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search name, email, Stripe ID…" className={`${inputCls} pl-9`} />
              </div>
              <Select value={planFilter} onChange={e=>setPlanFilter(e.target.value)}>
                <option value="all">All Plans</option>
                <option value="free">Free</option>
                <option value="pro">Pro</option>
                <option value="premium">Premium</option>
                <option value="enterprise">Enterprise</option>
              </Select>
              <Select value={sortBy} onChange={e=>setSortBy(e.target.value)}>
                <option value="recent">Recent</option>
                <option value="name_asc">Name A-Z</option>
                <option value="name_desc">Name Z-A</option>
                <option value="plan">By Plan</option>
              </Select>
            </div>

            <div className="flex items-center justify-between">
              <span className="text-caption num">{filteredUsers.length} users</span>
              {planFilter !== "all" && (
                <button onClick={()=>setPlanFilter("all")} className="link text-[12px]">Clear filter</button>
              )}
            </div>

            {/* Stripe Health — collapsible */}
            <div className="card overflow-hidden">
              <button
                onClick={()=>setHealthOpen(o=>!o)}
                className="w-full flex items-center justify-between px-4 py-3 text-left cursor-pointer hover:bg-hover transition-colors"
              >
                <div className="flex items-center gap-2">
                  <svg width="14" height="14" fill="none" stroke="var(--success)" strokeWidth="2" viewBox="0 0 24 24"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
                  <span className="section-title">Stripe Health</span>
                  {analytics && (
                    <span className="text-caption num ml-1">
                      {analytics.stripeCount} active · ${analytics.revenue.toFixed(2)} MRR
                    </span>
                  )}
                </div>
                <svg width="14" height="14" fill="none" stroke="var(--fg-4)" strokeWidth="2" viewBox="0 0 24 24" style={{transform:healthOpen?"rotate(180deg)":"none",transition:"transform 0.15s"}}><polyline points="6 9 12 15 18 9"/></svg>
              </button>
              {healthOpen && (
                <div className="px-4 pb-5 flex flex-col gap-4 border-t border-line-soft">
                  {analytics && (
                    <div className="pt-4 grid grid-cols-1 sm:grid-cols-3 gap-3">
                      <MetricCard label="Active Customers" value={analytics.stripeCount}              color="var(--brand-fg)" />
                      <MetricCard label="Est. MRR"         value={`$${analytics.revenue.toFixed(2)}`} color="var(--success-fg)" />
                      <MetricCard label="Canceled"         value={analytics.canceledCount}            color="var(--danger-fg)" />
                    </div>
                  )}
                  <section>
                    <SL>Price IDs <CodeRef k="priceIds" /></SL>
                    {isMobile ? (
                      <div className="flex flex-col gap-2">
                        {Object.entries(PRICE_IDS_MAP).map(([id,info])=>{const pc=planColor(info.plan);return(
                          <div key={id} className="bg-subtle border border-line-soft rounded-lg px-3.5 py-3">
                            <div className="flex items-center justify-between mb-1.5">
                              <span className={`badge ${pc.tw}`}>{info.plan}</span>
                              <span className="text-[13px] font-semibold text-fg num">{info.price}</span>
                            </div>
                            <div className="flex items-center justify-between">
                              <code className="font-mono text-[11px] text-brand-fg truncate max-w-[60%]">{id}</code>
                              <span className="text-[12px] text-fg-3">{info.billing}</span>
                            </div>
                          </div>
                        );})}
                      </div>
                    ) : (
                      <Card className="p-0 overflow-hidden">
                        <table className="data-table">
                          <thead><tr>{["Price ID","Plan","Billing","Price"].map(h=><th key={h}>{h}</th>)}</tr></thead>
                          <tbody>{Object.entries(PRICE_IDS_MAP).map(([id,info])=>{const pc=planColor(info.plan);return(<tr key={id}><td className="font-mono text-[12px] text-brand-fg">{id}</td><td><span className={`badge ${pc.tw}`}>{info.plan}</span></td><td className="text-fg-3">{info.billing}</td><td className="font-semibold text-fg num">{info.price}</td></tr>);})}</tbody>
                        </table>
                      </Card>
                    )}
                  </section>
                  <section>
                    <SL>Webhook Events <CodeRef k="stripeWebhook" /></SL>
                    <Card>
                      {WEBHOOK_EVENTS.map(e=>(
                        <div key={e.event} className={`flex gap-3 py-2.5 border-b border-line-soft last:border-0 ${isMobile?"flex-col":"flex-row items-center"}`}>
                          <div className="flex items-center gap-2.5">
                            <span className="dot bg-success" />
                            <code className={`font-mono text-fg ${isMobile?"text-[11px] break-all":"text-[13px]"}`}>{e.event}</code>
                          </div>
                          <code className={`font-mono text-fg-4 ${isMobile?"text-[11px] ml-4":"text-[12px] ml-auto"}`}>{e.handler}()</code>
                        </div>
                      ))}
                    </Card>
                  </section>
                </div>
              )}
            </div>

            {/* User grid */}
            <div className={`grid gap-3 ${isMobile ? "grid-cols-1 sm:grid-cols-2" : "grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"}`}>
              {filteredUsers.map(u => {
                const pc = planColor(u.subscription?.plan);
                const sc = statusColor(u.subscription?.status);
                return (
                  <div key={u.id}
                    onClick={() => { setSelectedUser(u); setActivePanel("plan"); }}
                    className="card overflow-hidden cursor-pointer hover:border-line-hover transition-colors flex flex-col"
                  >
                    <div className="h-[2px] shrink-0" style={{background:pc.accent}} />
                    <div className="p-4 flex flex-col flex-1 gap-3">
                      <div className="flex items-start gap-3">
                        <Avatar name={u.name} size={38} />
                        <div className="flex-1 min-w-0">
                          <div className="text-[14px] font-semibold text-fg truncate leading-tight">{u.name??"Unknown"}</div>
                          <div className="text-[12px] text-fg-4 truncate mt-0.5">{u.email??""}</div>
                        </div>
                        <StatusDot color={sc.dot} />
                      </div>
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className={`badge ${pc.tw}`}>{u.subscription?.plan??"free"}</span>
                        {u.subscription?.status && (
                          <span className="text-[11px] font-semibold" style={{color:sc.text}}>{u.subscription.status}</span>
                        )}
                        {u.subscription?.stripeCustomerId && (
                          <span className="badge badge-success">Stripe</span>
                        )}
                      </div>
                      {u.subscription?.stripeCustomerId && (
                        <div className="font-mono text-[11px] text-fg-5 truncate">{u.subscription.stripeCustomerId}</div>
                      )}
                      <button
                        onClick={e => { e.stopPropagation(); setSelectedUser(u); setActivePanel("plan"); }}
                        className="btn btn-sm btn-secondary mt-auto w-full"
                      >
                        View
                      </button>
                    </div>
                  </div>
                );
              })}
              {!filteredUsers.length && (
                <div className="col-span-full empty py-16">No users found.</div>
              )}
            </div>

          </div>
        </div>
      )}
    </div>
  );
}
