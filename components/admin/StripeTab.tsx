// components/admin/StripeTab.tsx
"use client";
import { useState, useMemo, useEffect } from "react";
import {
  User, AnalyticsData, PRICE_IDS_MAP, WEBHOOK_EVENTS,
  planColor, statusColor, fmtFull,
  MetricCard, Chip, StatusDot, Avatar, CodeRef, SL, Card, CardTitle, Spinner, FRow, useIsMobile,
  inputCls, Select,
} from "./admin-shared";

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
    <div className={`fixed bottom-7 right-7 z-[999] px-5 py-3 rounded-xl font-semibold text-sm border ${toast.type==="ok" ? "bg-[rgba(62,207,142,0.1)] text-[#3ecf8e] border-[rgba(62,207,142,0.25)]" : "bg-[rgba(255,68,68,0.1)] text-[#f44] border-[rgba(255,68,68,0.25)]"}`}>
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
  if (loading) return <div className="text-xs text-[#555] py-3">Loading coupons from Stripe…</div>;
  if (!valid.length) return <div className="text-xs text-[#555] py-3">No active coupons in Stripe.</div>;
  return (
    <div className="flex flex-col gap-1.5 max-h-[220px] overflow-y-auto pr-0.5">
      {valid.map(c => {
        const disc = c.percentOff ? `${c.percentOff}% off` : c.amountOff ? `$${(c.amountOff/100).toFixed(2)} off` : "discount";
        const dur = c.duration === "repeating" && c.durationMonths ? `${c.durationMonths}mo` : c.duration;
        const isSel = selectedId === c.id;
        const is100 = c.percentOff === 100;
        return (
          <button key={c.id} onClick={() => onSelect(isSel ? "" : c.id)}
            className={`w-full text-left px-3 py-2.5 rounded-lg border transition-all cursor-pointer font-[inherit] ${
              isSel
                ? "bg-[rgba(0,112,243,0.08)] border-[rgba(0,112,243,0.35)] text-[#ededed]"
                : "bg-[#111] border-[#1a1a1a] text-[#ededed] hover:border-[#2a2a2a]"
            }`}>
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <div className={`w-3.5 h-3.5 rounded-full border-2 shrink-0 flex items-center justify-center ${isSel ? "border-[#0070f3] bg-[#0070f3]" : "border-[#2a2a2a] bg-transparent"}`}>
                  {isSel && <div className="w-1.5 h-1.5 rounded-full bg-white" />}
                </div>
                <span className="text-[13px] font-semibold truncate">{c.name}</span>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <span className={`text-[11px] font-bold px-1.5 py-0.5 rounded border ${is100 ? "bg-[rgba(62,207,142,0.12)] text-[#3ecf8e] border-[rgba(62,207,142,0.3)]" : "bg-[rgba(0,112,243,0.08)] text-[#4da3ff] border-[rgba(0,112,243,0.2)]"}`}>{disc}</span>
                <span className="text-[11px] text-[#555]">{dur}</span>
              </div>
            </div>
            <div className="flex items-center gap-2 mt-1 pl-5">
              <span className="font-mono text-[11px] text-[#444] truncate">{c.id}</span>
              {c.timesRedeemed > 0 && <span className="text-[11px] text-[#444]">{c.timesRedeemed} used</span>}
              {c.maxRedemptions && <span className="text-[11px] text-[#444]">max {c.maxRedemptions}</span>}
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
  const [priceId,setPriceId]         = useState(() => {
    return Object.entries(PRICE_IDS_MAP).find(([,v])=>v.plan===(sub.plan??"free")&&v.billing==="Monthly")?.[0]
      ?? Object.entries(PRICE_IDS_MAP).find(([,v])=>v.plan==="pro"&&v.billing==="Monthly")?.[0]
      ?? "";
  });
  const [periodStart,setPeriodStart] = useState(toDateInput(sub.currentPeriodStart));
  const [periodEnd,  setPeriodEnd]   = useState(toDateInput(sub.currentPeriodEnd));
  const [trialEnd,   setTrialEnd]    = useState(toDateInput(sub.trialEndsAt));
  const [cancelEoP,  setCancelEoP]   = useState(false);
  const [couponId,   setCouponId]    = useState("");
  const [working,    setWorking]     = useState(false);
  const [err,        setErr]         = useState("");
  const selectedPrice  = PRICE_IDS_MAP[priceId];
  const selectedCoupon = coupons.find(c => c.id === couponId);

  async function apply() {
    setWorking(true); setErr("");
    try {
      const sd: Record<string,unknown> = { priceId, plan: selectedPrice?.plan ?? "free" };
      if (periodStart) sd.periodStart = fromDateInput(periodStart);
      if (periodEnd)   sd.periodEnd   = fromDateInput(periodEnd);
      if (trialEnd)    sd.trialEnd    = fromDateInput(trialEnd);
      if (cancelEoP)   sd.cancelAtPeriodEnd = true;
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
        <label className="block text-[12px] font-semibold text-[#555] uppercase tracking-wide mb-1.5">Plan & Price</label>
        <Select value={priceId} onChange={e=>setPriceId(e.target.value)}>
          <option value="">Select price</option>
          {Object.entries(PRICE_IDS_MAP).map(([id,info]) => <option key={id} value={id}>{info.plan} · {info.billing} · {info.price}</option>)}
          <option value="__free__">free (cancel)</option>
        </Select>
        {selectedPrice && (
          <div className="flex items-center gap-2 mt-1.5">
            <Chip label={selectedPrice.plan} className={`border font-bold ${planColor(selectedPrice.plan).tw}`} />
            <span className="text-[12px] text-[#888]">{selectedPrice.billing} · {selectedPrice.price}</span>
          </div>
        )}
      </div>

      {!sub.stripeSubscriptionId && (
        <div className={`px-3.5 py-2.5 rounded-lg text-xs border ${!priceId || priceId === "__free__" ? "bg-[rgba(245,166,35,0.06)] border-[rgba(245,166,35,0.2)] text-[#f5a623]" : "bg-[rgba(0,112,243,0.06)] border-[rgba(0,112,243,0.15)] text-[#0070f3]"}`}>
          {!priceId || priceId === "__free__"
            ? "No Stripe subscription. Select a paid plan to create one in Stripe."
            : "No existing subscription. A new Stripe customer & subscription will be created automatically."}
        </div>
      )}

      {/* Coupon (optional) */}
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <label className="block text-[12px] font-semibold text-[#555] uppercase tracking-wide">Coupon (optional)</label>
          {couponId && (
            <button onClick={() => setCouponId("")} className="text-[11px] text-[#555] hover:text-[#888] border-none bg-transparent cursor-pointer transition-colors">
              Clear
            </button>
          )}
        </div>
        <CouponGrid coupons={coupons} loading={loadingCoupons} selectedId={couponId} onSelect={setCouponId} />
        {couponId && selectedCoupon && (
          <div className="mt-2 px-3 py-2 bg-[rgba(0,112,243,0.06)] border border-[rgba(0,112,243,0.2)] rounded-lg flex items-center gap-2">
            <svg width="11" height="11" fill="none" stroke="#0070f3" strokeWidth="2" viewBox="0 0 24 24"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg>
            <span className="text-[12px] text-[#0070f3] font-medium">{couponLabel(selectedCoupon)} will be applied</span>
          </div>
        )}
      </div>

      {/* Dates */}
      <div className={`grid gap-2.5 ${isMobile?"grid-cols-1":"grid-cols-3"}`}>
        {([["Period Start",periodStart,setPeriodStart],["Period End",periodEnd,setPeriodEnd],["Trial End",trialEnd,setTrialEnd]] as [string,string,(s:string)=>void][]).map(([l,v,set])=>(
          <div key={l}>
            <label className="block text-[12px] font-semibold text-[#555] uppercase tracking-wide mb-1.5">{l}</label>
            <input type="date" value={v} onChange={e=>set(e.target.value)} className={inputCls} />
          </div>
        ))}
      </div>

      <label className="flex items-center gap-2 cursor-pointer">
        <input type="checkbox" checked={cancelEoP} onChange={e=>setCancelEoP(e.target.checked)} className="w-3.5 h-3.5 accent-[#0070f3]" />
        <span className="text-sm text-[#ededed] font-medium">Cancel at period end</span>
        <span className="text-[12px] text-[#555] hidden sm:inline">(keeps access until end date)</span>
      </label>

      {err && <div className="px-3 py-2 bg-[rgba(255,68,68,0.06)] border border-[rgba(255,68,68,0.2)] rounded-lg text-xs text-[#f44]">{err}</div>}
      <button onClick={apply} disabled={working}
        className={`self-start px-5 py-2 rounded-lg text-sm font-bold border-none cursor-pointer transition-colors ${working ? "bg-[#1a1a1a] text-[#555] cursor-wait" : "bg-[#0070f3] text-white hover:bg-[#0060df]"}`}>
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
        <div className="px-3 py-2 bg-[rgba(62,207,142,0.06)] border border-[rgba(62,207,142,0.2)] rounded-lg text-xs text-[#3ecf8e] font-medium">
          Last applied: <strong>{user.subscription.lastAppliedCoupon}</strong>
          {user.subscription.lastCouponAppliedAt ? ` on ${fmtFull(user.subscription.lastCouponAppliedAt)}` : ""}
        </div>
      )}

      {/* Coupon cards */}
      <div>
        <div className="text-[11px] font-bold text-[#555] uppercase tracking-wide mb-2">Select Coupon</div>
        <CouponGrid coupons={coupons} loading={loadingCoupons} selectedId={selectedId} onSelect={setSelectedId} />
      </div>

      {/* Apply button for selected coupon */}
      {selectedCoupon && (
        <div className="flex items-center gap-2 px-3.5 py-3 bg-[rgba(0,112,243,0.06)] border border-[rgba(0,112,243,0.2)] rounded-xl">
          <div className="flex-1 min-w-0">
            <div className="text-[13px] font-semibold text-[#ededed]">{selectedCoupon.name}</div>
            <div className="text-[11px] text-[#555] mt-0.5">{couponLabel(selectedCoupon)}</div>
          </div>
          <button onClick={() => apply()} disabled={working || !user.subscription?.stripeCustomerId}
            className={`shrink-0 px-4 py-2 rounded-lg text-[13px] font-bold border-none cursor-pointer disabled:opacity-40 transition-colors ${working ? "bg-[#3ecf8e]/60 text-black cursor-wait" : "bg-[#3ecf8e] hover:bg-[#32bf7e] text-black"}`}>
            {working ? "Applying…" : "Apply to Account"}
          </button>
        </div>
      )}

      {/* Divider */}
      <div className="flex items-center gap-3">
        <div className="flex-1 h-px bg-[#1a1a1a]" />
        <span className="text-[11px] text-[#333] uppercase tracking-wider font-semibold">or enter code manually</span>
        <div className="flex-1 h-px bg-[#1a1a1a]" />
      </div>

      {/* Manual code */}
      <div className="flex gap-2">
        <input value={code} onChange={e=>setCode(e.target.value)} onKeyDown={e=>e.key==="Enter"&&apply()}
          placeholder="PROMO_CODE or coupon_id"
          className={`${inputCls} flex-1`} />
        <button onClick={()=>apply()} disabled={working || !user.subscription?.stripeCustomerId || !code.trim()}
          className={`px-4 py-2 rounded-lg text-sm font-bold text-black border-none whitespace-nowrap cursor-pointer disabled:opacity-40 transition-colors ${working ? "bg-[#3ecf8e]/60 cursor-wait" : "bg-[#3ecf8e] hover:bg-[#32bf7e]"}`}>
          {working ? "…" : "Apply"}
        </button>
      </div>

      {!user.subscription?.stripeCustomerId && (
        <p className="text-[12px] text-[#555]">No Stripe customer ID on this user — assign a subscription first.</p>
      )}
      {err && <div className="px-3 py-2 bg-[rgba(255,68,68,0.06)] border border-[rgba(255,68,68,0.2)] rounded-lg text-xs text-[#f44]">{err}</div>}
    </div>
  );
}

export function ContactPanel({ user, onDone, token = "" }: { user:User; onDone:(m:string)=>void; token?: string }) {
  const email = user.email ?? "";
  const name  = user.name  ?? "there";

  const buildTemplate = (bodyContent: string) =>
    `Hi ${name},\n\n${bodyContent}\n\nIf you have any questions, feel free to reply to this email. We typically respond within 24 hours.\n\nWarm regards,\nSam Stein\nTech Support, Preciprocal\nsupport@preciprocal.com`;

  type Template = { id: string; label: string; subject: string; body: string };
  const TEMPLATES: Template[] = [
    { id: "welcome",      label: "Welcome",         subject: "Welcome to Preciprocal: Here's How to Get Started",          body: buildTemplate(`Welcome to Preciprocal! We're thrilled to have you on board.\n\nHere's what you can do right now:\n• Analyse your resume and get an ATS score\n• Practice mock interviews with AI feedback\n• Optimise your LinkedIn profile\n• Track all your job applications in one place\n\nHead to https://app.preciprocal.com to get started.`) },
    { id: "upgrade",      label: "Upgrade offer",   subject: "An Exclusive Offer: Upgrade to Preciprocal Pro",             body: buildTemplate(`I wanted to personally reach out with an exclusive offer.\n\nAs a valued Preciprocal user, we'd love to offer you a special discount on Pro. Here's what you unlock:\n• Unlimited cover letters\n• 30 mock interviews per month\n• Full analytics dashboard\n• Resume editor with PDF & Word export\n• And much more\n\nUse code [COUPON_CODE] at checkout for [X]% off your first month.\n\nUpgrade here: https://app.preciprocal.com/pricing`) },
    { id: "payment",      label: "Payment issue",   subject: "Action Required: Payment Issue on Your Preciprocal Account",  body: buildTemplate(`We noticed there's an issue with the payment method on your Preciprocal account. To avoid any interruption to your subscription, please update your billing details at your earliest convenience.\n\nUpdate billing: https://app.preciprocal.com/settings/billing\n\nIf you believe this is an error or need assistance, please don't hesitate to reply to this email.`) },
    { id: "cancellation", label: "Win-back",         subject: "We Miss You: Here's What's New at Preciprocal",              body: buildTemplate(`We noticed you recently cancelled your Preciprocal subscription, and we wanted to reach out.\n\nWe've been busy shipping new features since you left:\n• [New feature 1]\n• [New feature 2]\n• [New feature 3]\n\nWe'd love to have you back. As a returning user, use code [WINBACK_CODE] for [X]% off your first month back.\n\nReactivate here: https://app.preciprocal.com/pricing`) },
    { id: "feedback",     label: "Feedback request", subject: "Quick Question: How Is Preciprocal Working for You?",        body: buildTemplate(`I'm reaching out personally to ask: how has your experience with Preciprocal been so far?\n\nYour feedback means a lot to us and directly shapes what we build next. It would take less than 2 minutes:\n\n[FEEDBACK_LINK]\n\nOr simply reply to this email with your thoughts. I read every response personally.`) },
    { id: "custom",       label: "Custom",           subject: "Regarding your Preciprocal account",                          body: buildTemplate("[Write your message here]") },
  ];

  const [activeTemplate, setActiveTemplate] = useState<string>("welcome");
  const [subject, setSubject] = useState(TEMPLATES[0].subject);
  const [body,    setBody]    = useState(TEMPLATES[0].body);
  const [working, setWorking] = useState(false);
  const [err,     setErr]     = useState("");

  function applyTemplate(tpl: Template) { setActiveTemplate(tpl.id); setSubject(tpl.subject); setBody(tpl.body); }

  async function send() {
    if (!email)                        { setErr("No email on this user"); return; }
    if (!subject.trim()||!body.trim()) { setErr("Subject and body are required"); return; }
    setWorking(true); setErr("");
    try {
      const res  = await apiCall("contact_email", { id:user.id, subject, body, toEmail:email, toName:name }, token);
      const json = await res.json() as { success?:boolean; error?:string; draft?:boolean };
      if (!res.ok||json.error) throw new Error(json.error??"Unknown error");
      onDone(json.draft ? "Email drafted (add RESEND_API_KEY to send)" : `Email sent to ${email}`);
    } catch (e) { setErr((e as Error).message); }
    setWorking(false);
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3 px-3.5 py-3 bg-[#111] border border-[#1a1a1a] rounded-lg">
        <Avatar name={user.name} size={38} />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-[#ededed]">{user.name ?? "Unknown"}</div>
          <div className="text-xs text-[#888] truncate">{email || "No email on file"}</div>
        </div>
        {user.lastContactedAt
          ? <div className="text-[11px] text-[#555] text-right shrink-0">Last contacted<br/><span className="font-semibold text-[#888]">{fmtFull(user.lastContactedAt)}</span></div>
          : <div className="text-[11px] text-[#333] shrink-0 italic">Never contacted</div>}
      </div>
      <div>
        <div className="text-[11px] font-bold text-[#555] uppercase tracking-wider mb-2">Email Template</div>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
          {TEMPLATES.map(t => (
            <button key={t.id} onClick={() => applyTemplate(t)}
              className={`px-2.5 py-2 rounded-lg border text-[12px] font-medium cursor-pointer text-left transition-all ${
                activeTemplate === t.id
                  ? "bg-[rgba(0,112,243,0.08)] border-[rgba(0,112,243,0.3)] text-[#0070f3] font-semibold"
                  : "bg-[#111] border-[#2a2a2a] text-[#888] hover:border-[#555] hover:text-[#ededed]"
              }`}>
              {t.label}
            </button>
          ))}
        </div>
      </div>
      <div>
        <label className="block text-[12px] font-semibold text-[#555] uppercase tracking-wide mb-1.5">Subject</label>
        <input value={subject} onChange={e => setSubject(e.target.value)} className={inputCls} />
      </div>
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <label className="block text-[12px] font-semibold text-[#555] uppercase tracking-wide">Message</label>
          <span className="text-[11px] text-[#555]">Edit content in [brackets] before sending</span>
        </div>
        <textarea value={body} onChange={e => setBody(e.target.value)} rows={10}
          className={`${inputCls} resize-y leading-relaxed font-[inherit] text-[14px]`} spellCheck />
      </div>
      <div className="px-3 py-2.5 bg-[#111] border border-[#1a1a1a] rounded-lg">
        <div className="text-[11px] font-bold text-[#555] uppercase tracking-wider mb-1">Email Preview</div>
        <div className="text-[12px] text-[#888]">
          <span className="font-semibold text-[#ededed]">To:</span> {email || ""}
          &nbsp;&nbsp;<span className="font-semibold text-[#ededed]">From:</span> support@preciprocal.com
        </div>
        <div className="text-[12px] text-[#888] mt-0.5">
          <span className="font-semibold text-[#ededed]">Subject:</span> {subject || ""}
        </div>
      </div>
      {err && <div className="px-3 py-2 bg-[rgba(255,68,68,0.06)] border border-[rgba(255,68,68,0.2)] rounded-lg text-xs text-[#f44]">{err}</div>}
      <div className="flex items-center gap-3">
        <button onClick={send} disabled={working || !email}
          className={`flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-bold border-none cursor-pointer disabled:opacity-40 transition-colors ${working ? "bg-[#1a1a1a] text-[#555] cursor-wait" : "bg-[#ededed] text-black hover:bg-white"}`}>
          <svg width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>
          </svg>
          {working ? "Sending…" : "Send Email"}
        </button>
        <div className="flex items-center gap-1.5 text-[12px] text-[#555]">
          <svg width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>
          </svg>
          Sent via Resend · Logged in Supabase
        </div>
      </div>
    </div>
  );
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
      } catch {}
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
    <div className="flex-1 flex flex-col overflow-hidden bg-black">
      <ToastBanner toast={toast} />

      {selectedUser ? (
        /* ── DETAIL VIEW ─────────────────────────────────── */
        <div className="flex-1 overflow-auto">
          <div className="p-4 md:p-7 flex flex-col gap-4 max-w-4xl mx-auto">
            <button onClick={()=>setSelectedUser(null)}
              className="flex items-center gap-2 text-sm text-[#555] hover:text-[#ededed] border-none bg-transparent cursor-pointer transition-colors self-start">
              <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M19 12H5M12 5l-7 7 7 7"/></svg>
              Back to all users
            </button>

            {(()=>{
              const pc=planColor(selectedUser.subscription?.plan), sc=statusColor(selectedUser.subscription?.status);
              return (
                <div className="bg-[#0a0a0a] border border-[#1a1a1a] rounded-xl overflow-hidden">
                  <div className="h-[2px]" style={{background:`linear-gradient(90deg,${pc.accent},${pc.accent}44)`}} />
                  <div className="p-4">
                    <div className="flex items-center gap-3 mb-3">
                      <Avatar name={selectedUser.name} size={44} />
                      <div className="flex-1 min-w-0">
                        <div className="text-base font-extrabold text-[#ededed] tracking-tight">{selectedUser.name??"Unknown"}</div>
                        <div className="text-xs text-[#888] truncate mt-0.5">{selectedUser.email}</div>
                        <div className="flex items-center gap-2 mt-2 flex-wrap">
                          <Chip label={selectedUser.subscription?.plan??"free"} className={`border font-bold ${pc.tw}`} />
                          <div className="flex items-center gap-1"><StatusDot color={sc.dot}/><span className="text-xs font-semibold" style={{color:sc.text}}>{selectedUser.subscription?.status??""}</span></div>
                          {selectedUser.subscription?.stripeCustomerId && <Chip label="Stripe" className="bg-[rgba(62,207,142,0.08)] text-[#3ecf8e] border border-[rgba(62,207,142,0.2)] font-bold" />}
                          {selectedUser.subscription?.lastAppliedCoupon && (
                            <Chip label={`Coupon: ${selectedUser.subscription.lastAppliedCoupon}`} className="bg-[rgba(0,112,243,0.08)] text-[#4da3ff] border border-[rgba(0,112,243,0.2)] font-bold" />
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-x-5 gap-y-1.5">
                      {([["Customer ID",selectedUser.subscription?.stripeCustomerId],["Sub ID",selectedUser.subscription?.stripeSubscriptionId],["Period End",fmtFull(selectedUser.subscription?.currentPeriodEnd)],["UID",selectedUser.id]] as [string,string|undefined][]).map(([l,v])=>(
                        <div key={l} className="min-w-0">
                          <div className="text-[11px] font-bold text-[#555] uppercase tracking-wider">{l}</div>
                          <div className="font-mono text-[12px] text-[#0070f3] mt-0.5 truncate">{v??""}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              );
            })()}

            <div className="flex gap-1 bg-[#0a0a0a] border border-[#1a1a1a] rounded-xl p-1">
              {([
                { id:"plan",    label:"Change Plan",   icon:<svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><rect x="1" y="4" width="22" height="16" rx="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg> },
                { id:"coupon",  label:"Apply Coupon",  icon:<svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg> },
                { id:"contact", label:"Contact User",  icon:<svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg> },
              ] as {id:"plan"|"coupon"|"contact";label:string;icon:React.ReactNode}[]).map(p=>(
                <button key={p.id} onClick={()=>setActivePanel(p.id)}
                  className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg border-none cursor-pointer font-[inherit] transition-all text-xs font-semibold ${activePanel===p.id ? "bg-[#1a1a1a] text-[#ededed]" : "bg-transparent text-[#555] hover:text-[#888]"}`}>
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
              <FRow label="Plan"         badgeLabel={selectedUser.subscription?.plan??"free"} badgeClassName={`border font-bold ${planColor(selectedUser.subscription?.plan).tw}`} />
              <FRow label="Status"       badgeLabel={selectedUser.subscription?.status??""} badgeClassName="text-xs font-semibold" />
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
                <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[#555] pointer-events-none" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>
                <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search name, email, Stripe ID…" className={`${inputCls} pl-8 text-xs`} />
              </div>
              <Select value={planFilter} onChange={e=>setPlanFilter(e.target.value)} className="text-xs">
                <option value="all">All Plans</option>
                <option value="free">Free</option>
                <option value="pro">Pro</option>
                <option value="premium">Premium</option>
                <option value="enterprise">Enterprise</option>
              </Select>
              <Select value={sortBy} onChange={e=>setSortBy(e.target.value)} className="text-xs">
                <option value="recent">Recent</option>
                <option value="name_asc">Name A-Z</option>
                <option value="name_desc">Name Z-A</option>
                <option value="plan">By Plan</option>
              </Select>
            </div>

            <div className="flex items-center justify-between">
              <span className="text-[12px] text-[#555]">{filteredUsers.length} users</span>
              {planFilter !== "all" && (
                <button onClick={()=>setPlanFilter("all")} className="text-[11px] text-[#0070f3] font-medium cursor-pointer border-none bg-transparent">Clear filter</button>
              )}
            </div>

            {/* Stripe Health — collapsible */}
            <div className="bg-[#0a0a0a] border border-[#1a1a1a] rounded-xl overflow-hidden">
              <button
                onClick={()=>setHealthOpen(o=>!o)}
                className="w-full flex items-center justify-between px-4 py-3 text-left border-none bg-transparent cursor-pointer"
              >
                <div className="flex items-center gap-2">
                  <svg width="13" height="13" fill="none" stroke="#3ecf8e" strokeWidth="2" viewBox="0 0 24 24"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
                  <span className="text-[13px] font-bold text-[#ededed]">Stripe Health</span>
                  {analytics && (
                    <span className="text-[11px] text-[#555] font-medium ml-1">
                      {analytics.stripeCount} active · ${analytics.revenue.toFixed(2)} MRR
                    </span>
                  )}
                </div>
                <svg width="12" height="12" fill="none" stroke="#555" strokeWidth="2" viewBox="0 0 24 24" style={{transform:healthOpen?"rotate(180deg)":"none",transition:"transform 0.15s"}}><polyline points="6 9 12 15 18 9"/></svg>
              </button>
              {healthOpen && (
                <div className="px-4 pb-5 flex flex-col gap-4 border-t border-[#1a1a1a]">
                  {analytics && (
                    <div className="pt-4 grid grid-cols-1 sm:grid-cols-3 gap-3">
                      <MetricCard label="Active Customers" value={analytics.stripeCount}              color="#0070f3" />
                      <MetricCard label="Est. MRR"         value={`$${analytics.revenue.toFixed(2)}`} color="#3ecf8e" />
                      <MetricCard label="Canceled"         value={analytics.canceledCount}            color="#f44" />
                    </div>
                  )}
                  <section>
                    <SL>Price IDs <CodeRef k="priceIds" /></SL>
                    {isMobile ? (
                      <div className="flex flex-col gap-2">
                        {Object.entries(PRICE_IDS_MAP).map(([id,info])=>{const pc=planColor(info.plan);return(
                          <div key={id} className="bg-[#111] border border-[#1a1a1a] rounded-lg px-3.5 py-3">
                            <div className="flex items-center justify-between mb-1.5">
                              <Chip label={info.plan} className={`border font-bold ${pc.tw}`} />
                              <span className="text-sm font-bold text-[#ededed]">{info.price}</span>
                            </div>
                            <div className="flex items-center justify-between">
                              <code className="font-mono text-[11px] text-[#0070f3] truncate max-w-[60%]">{id}</code>
                              <span className="text-xs text-[#888]">{info.billing}</span>
                            </div>
                          </div>
                        );})}
                      </div>
                    ) : (
                      <Card className="p-0 overflow-hidden">
                        <table className="w-full border-collapse">
                          <thead><tr className="bg-[#111] border-b border-[#1a1a1a]">{["Price ID","Plan","Billing","Price"].map(h=><th key={h} className="px-4 py-2.5 text-left text-[11px] font-bold text-[#555] uppercase tracking-wider">{h}</th>)}</tr></thead>
                          <tbody>{Object.entries(PRICE_IDS_MAP).map(([id,info])=>{const pc=planColor(info.plan);return(<tr key={id} className="border-b border-[#111] hover:bg-[#111] transition-colors"><td className="px-4 py-2.5 font-mono text-xs text-[#0070f3]">{id}</td><td className="px-4 py-2.5"><Chip label={info.plan} className={`border font-bold ${pc.tw}`}/></td><td className="px-4 py-2.5 text-sm text-[#888]">{info.billing}</td><td className="px-4 py-2.5 text-sm font-bold text-[#ededed]">{info.price}</td></tr>);})}</tbody>
                        </table>
                      </Card>
                    )}
                  </section>
                  <section>
                    <SL>Webhook Events <CodeRef k="stripeWebhook" /></SL>
                    <Card>
                      {WEBHOOK_EVENTS.map(e=>(
                        <div key={e.event} className={`flex gap-3 py-2.5 border-b border-[#111] last:border-0 ${isMobile?"flex-col":"flex-row items-center"}`}>
                          <div className="flex items-center gap-2.5">
                            <div className="w-1.5 h-1.5 rounded-full bg-[#3ecf8e] shrink-0" />
                            <code className={`font-mono text-[#ededed] ${isMobile?"text-[11px] break-all":"text-sm"}`}>{e.event}</code>
                          </div>
                          <code className={`font-mono text-[#555] ${isMobile?"text-[11px] ml-4":"text-xs ml-auto"}`}>{e.handler}()</code>
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
                    className="bg-[#0a0a0a] border border-[#1a1a1a] rounded-xl overflow-hidden cursor-pointer hover:border-[#2a2a2a] hover:bg-[#111] transition-all flex flex-col"
                  >
                    <div className="h-[2px] shrink-0" style={{background:`linear-gradient(90deg,${pc.accent},${pc.accent}44)`}} />
                    <div className="p-4 flex flex-col flex-1 gap-3">
                      <div className="flex items-start gap-3">
                        <Avatar name={u.name} size={38} />
                        <div className="flex-1 min-w-0">
                          <div className="text-[14px] font-bold text-[#ededed] truncate leading-tight">{u.name??"Unknown"}</div>
                          <div className="text-[12px] text-[#555] truncate mt-0.5">{u.email??""}</div>
                        </div>
                        <StatusDot color={sc.dot} />
                      </div>
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <Chip label={u.subscription?.plan??"free"} className={`border text-[11px] font-bold ${pc.tw}`} />
                        {u.subscription?.status && (
                          <span className="text-[11px] font-semibold" style={{color:sc.text}}>{u.subscription.status}</span>
                        )}
                        {u.subscription?.stripeCustomerId && (
                          <Chip label="Stripe" className="bg-[rgba(62,207,142,0.08)] text-[#3ecf8e] border border-[rgba(62,207,142,0.2)] text-[11px] font-bold" />
                        )}
                      </div>
                      {u.subscription?.stripeCustomerId && (
                        <div className="font-mono text-[11px] text-[#444] truncate">{u.subscription.stripeCustomerId}</div>
                      )}
                      <button
                        onClick={e => { e.stopPropagation(); setSelectedUser(u); setActivePanel("plan"); }}
                        className="mt-auto w-full py-1.5 rounded-lg text-[12px] font-bold text-white bg-[#0070f3] hover:bg-[#0060df] border-none cursor-pointer transition-colors"
                      >
                        View
                      </button>
                    </div>
                  </div>
                );
              })}
              {!filteredUsers.length && (
                <div className="col-span-full py-16 text-center text-sm text-[#555]">No users found.</div>
              )}
            </div>

          </div>
        </div>
      )}
    </div>
  );
}
