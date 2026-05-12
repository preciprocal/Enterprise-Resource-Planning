// components/admin/StripeTab.tsx
"use client";
import { useState, useMemo } from "react";
import {
  User, AnalyticsData, PRICE_IDS_MAP, WEBHOOK_EVENTS,
  planColor, statusColor, fmtFull,
  MetricCard, Chip, StatusDot, Avatar, CodeRef, SL, Card, CardTitle, Spinner, FRow, useIsMobile,
  inputCls, selectCls,
} from "./admin-shared";

interface Props { analytics: AnalyticsData | null; users: User[]; loading: boolean; token?: string; }

function apiCall(action: string, payload: Record<string, unknown>, token = "") {
  return fetch("/api/admin", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(token ? { "x-admin-secret": token } : {}) },
    body: JSON.stringify({ action, ...payload }),
  });
}
function toDateInput(iso?: string) { if (!iso) return ""; try { return new Date(iso).toISOString().slice(0,10); } catch { return ""; } }
function fromDateInput(v: string) { return v ? new Date(v).toISOString() : ""; }

type Toast = { msg: string; type: "ok"|"err" };
function ToastBanner({ toast }: { toast: Toast | null }) {
  if (!toast) return null;
  return (
    <div className={`fixed bottom-7 right-7 z-[999] px-5 py-3 rounded-xl font-semibold text-sm shadow-lg border ${toast.type==="ok"?"bg-green-50 text-green-700 border-green-300":"bg-rose-50 text-rose-700 border-rose-300"}`}>
      {toast.type==="ok"?"✓ ":"✗ "}{toast.msg}
    </div>
  );
}

function PlanEditorPanel({ user, onSaved, isMobile, token = "" }: { user: User; onSaved:(u:User)=>void; isMobile:boolean; token?: string }) {
  const sub = user.subscription ?? {};
  const [priceId,setPriceId]         = useState(() => {
    // Try to match current plan, fall back to Pro Monthly so banner starts informative
    return Object.entries(PRICE_IDS_MAP).find(([,v])=>v.plan===(sub.plan??"free")&&v.billing==="Monthly")?.[0]
      ?? Object.entries(PRICE_IDS_MAP).find(([,v])=>v.plan==="pro"&&v.billing==="Monthly")?.[0]
      ?? "";
  });
  const [periodStart,setPeriodStart] = useState(toDateInput(sub.currentPeriodStart));
  const [periodEnd,  setPeriodEnd]   = useState(toDateInput(sub.currentPeriodEnd));
  const [trialEnd,   setTrialEnd]    = useState(toDateInput(sub.trialEndsAt));
  const [cancelEoP,  setCancelEoP]   = useState(false);
  const [working,    setWorking]     = useState(false);
  const [err,        setErr]         = useState("");
  const selectedPrice = PRICE_IDS_MAP[priceId];

  async function apply() {
    setWorking(true); setErr("");
    try {
      const sd: Record<string,unknown> = { priceId, plan: selectedPrice?.plan ?? "free" };
      if (periodStart) sd.periodStart = fromDateInput(periodStart);
      if (periodEnd)   sd.periodEnd   = fromDateInput(periodEnd);
      if (trialEnd)    sd.trialEnd    = fromDateInput(trialEnd);
      if (cancelEoP)   sd.cancelAtPeriodEnd = true;
      const res  = await apiCall("stripe_update", { id: user.id, stripeData: sd }, token);
      const json = await res.json() as { success?:boolean; error?:string; subscription?:Record<string,unknown> };
      if (!res.ok || json.error) throw new Error(json.error ?? "Unknown error");
      onSaved({ ...user, subscription: { ...user.subscription, ...json.subscription } });
    } catch (e) { setErr((e as Error).message); }
    setWorking(false);
  }

  return (
    <div className="flex flex-col gap-3.5">
      <div>
        <label className="block text-[11px] font-semibold text-gray-500 uppercase tracking-wide mb-1.5">New Plan & Price</label>
        <select value={priceId} onChange={e=>setPriceId(e.target.value)} className={selectCls}>
          <option value="">— Select price —</option>
          {Object.entries(PRICE_IDS_MAP).map(([id,info]) => <option key={id} value={id}>{info.plan} · {info.billing} · {info.price}</option>)}
          <option value="__free__">free (cancel)</option>
        </select>
        {selectedPrice && (
          <div className="flex items-center gap-2 mt-1.5">
            <Chip label={selectedPrice.plan} className={`border font-bold ${planColor(selectedPrice.plan).tw}`} />
            <span className="text-[11px] text-gray-500">{selectedPrice.billing} · {selectedPrice.price}</span>
          </div>
        )}
      </div>
      {/* Show context banner only when no existing Stripe subscription */}
      {!sub.stripeSubscriptionId && (
        <div className={`px-3.5 py-2.5 rounded-lg text-xs border ${!priceId || priceId === "__free__" ? "bg-amber-50 border-amber-200 text-amber-800" : "bg-blue-50 border-blue-200 text-blue-800"}`}>
          {!priceId || priceId === "__free__"
            ? "⚠ No Stripe subscription. Select a paid plan to create one in Stripe."
            : "✓ No existing subscription. A new Stripe customer & subscription will be created automatically."}
        </div>
      )}
      <div className={`grid gap-2.5 ${isMobile?"grid-cols-1":"grid-cols-3"}`}>
        {([["Period Start",periodStart,setPeriodStart],["Period End",periodEnd,setPeriodEnd],["Trial End",trialEnd,setTrialEnd]] as [string,string,(s:string)=>void][]).map(([l,v,set])=>(
          <div key={l}>
            <label className="block text-[11px] font-semibold text-gray-500 uppercase tracking-wide mb-1.5">{l}</label>
            <input type="date" value={v} onChange={e=>set(e.target.value)} className={inputCls} />
          </div>
        ))}
      </div>
      <label className="flex items-center gap-2 cursor-pointer">
        <input type="checkbox" checked={cancelEoP} onChange={e=>setCancelEoP(e.target.checked)} className="w-3.5 h-3.5 accent-indigo-500" />
        <span className="text-sm text-gray-700 font-medium">Cancel at period end</span>
        <span className="text-[11px] text-gray-400 hidden sm:inline">(keeps access until end date)</span>
      </label>
      {err && <div className="px-3 py-2 bg-rose-50 border border-rose-200 rounded-lg text-xs text-rose-700">{err}</div>}
      <button onClick={apply} disabled={working}
        className={`self-start px-5 py-2 rounded-lg text-sm font-bold text-white border-none cursor-pointer ${working?"bg-indigo-300 cursor-wait":"bg-indigo-500 hover:bg-indigo-600"}`}>
        {working?"Applying…":"Apply to Stripe + Firebase"}
      </button>
    </div>
  );
}

function CouponPanel({ user, onDone, token = "" }: { user:User; onDone:(m:string)=>void; token?: string }) {
  const [code,setCode]       = useState("");
  const [working,setWorking] = useState(false);
  const [err,setErr]         = useState("");
  async function apply() {
    if (!code.trim()) { setErr("Enter a coupon or promo code"); return; }
    setWorking(true); setErr("");
    try {
      const res  = await apiCall("apply_coupon", { id: user.id, couponCode: code.trim() }, token);
      const json = await res.json() as { success?:boolean; error?:string; applied?:string };
      if (!res.ok || json.error) throw new Error(json.error ?? "Unknown error");
      onDone(`Coupon "${json.applied}" applied`); setCode("");
    } catch (e) { setErr((e as Error).message); }
    setWorking(false);
  }
  return (
    <div className="flex flex-col gap-3">
      {user.subscription?.lastAppliedCoupon && (
        <div className="px-3 py-2 bg-green-50 border border-green-200 rounded-lg text-xs text-green-700 font-medium">
          Last applied: <strong>{user.subscription.lastAppliedCoupon}</strong>
          {user.subscription.lastCouponAppliedAt ? ` on ${fmtFull(user.subscription.lastCouponAppliedAt)}` : ""}
        </div>
      )}
      <div className="flex gap-2">
        <input value={code} onChange={e=>setCode(e.target.value)} onKeyDown={e=>e.key==="Enter"&&apply()} placeholder="PROMO_CODE or coupon_id" className={`${inputCls} flex-1`} />
        <button onClick={apply} disabled={working||!user.subscription?.stripeCustomerId}
          className={`px-4 py-2 rounded-lg text-sm font-bold text-white border-none whitespace-nowrap cursor-pointer disabled:opacity-40 ${working?"bg-emerald-300 cursor-wait":"bg-emerald-500 hover:bg-emerald-600"}`}>
          {working?"Applying…":"Apply"}
        </button>
      </div>
      {!user.subscription?.stripeCustomerId && <p className="text-[11px] text-gray-400">No Stripe customer ID on this user.</p>}
      {err && <div className="px-3 py-2 bg-rose-50 border border-rose-200 rounded-lg text-xs text-rose-700">{err}</div>}
    </div>
  );
}

function ContactPanel({ user, onDone, token = "" }: { user:User; onDone:(m:string)=>void; token?: string }) {
  const email = user.email ?? "";
  const name  = user.name  ?? "there";

  // Professional template builder
  const buildTemplate = (bodyContent: string) =>
    `Hi ${name},

${bodyContent}

If you have any questions, feel free to reply to this email. We typically respond within 24 hours.

Warm regards,
Yash
Founder, Preciprocal
support@preciprocal.com`;

  type Template = { id: string; label: string; subject: string; body: string };
  const TEMPLATES: Template[] = [
    {
      id: "welcome",
      label: "Welcome",
      subject: "Welcome to Preciprocal: Here's How to Get Started",
      body: buildTemplate(
        `Welcome to Preciprocal! We're thrilled to have you on board.

Here's what you can do right now:
• Analyse your resume and get an ATS score
• Practice mock interviews with AI feedback
• Optimise your LinkedIn profile
• Track all your job applications in one place

Head to https://app.preciprocal.com to get started.`
      ),
    },
    {
      id: "upgrade",
      label: "Upgrade offer",
      subject: "An Exclusive Offer: Upgrade to Preciprocal Pro",
      body: buildTemplate(
        `I wanted to personally reach out with an exclusive offer.

As a valued Preciprocal user, we'd love to offer you a special discount on Pro. Here's what you unlock:
• Unlimited cover letters
• 30 mock interviews per month
• Full analytics dashboard
• Resume editor with PDF & Word export
• And much more

Use code [COUPON_CODE] at checkout for [X]% off your first month.

Upgrade here: https://app.preciprocal.com/pricing`
      ),
    },
    {
      id: "payment",
      label: "Payment issue",
      subject: "Action Required: Payment Issue on Your Preciprocal Account",
      body: buildTemplate(
        `We noticed there's an issue with the payment method on your Preciprocal account. To avoid any interruption to your subscription, please update your billing details at your earliest convenience.

Update billing: https://app.preciprocal.com/settings/billing

If you believe this is an error or need assistance, please don't hesitate to reply to this email.`
      ),
    },
    {
      id: "cancellation",
      label: "Win-back",
      subject: "We Miss You: Here's What's New at Preciprocal",
      body: buildTemplate(
        `We noticed you recently cancelled your Preciprocal subscription, and we wanted to reach out.

We've been busy shipping new features since you left:
• [New feature 1]
• [New feature 2]
• [New feature 3]

We'd love to have you back. As a returning user, use code [WINBACK_CODE] for [X]% off your first month back.

Reactivate here: https://app.preciprocal.com/pricing`
      ),
    },
    {
      id: "feedback",
      label: "Feedback request",
      subject: "Quick Question: How Is Preciprocal Working for You?",
      body: buildTemplate(
        `I'm reaching out personally to ask: how has your experience with Preciprocal been so far?

Your feedback means a lot to us and directly shapes what we build next. It would take less than 2 minutes:

[FEEDBACK_LINK]

Or simply reply to this email with your thoughts. I read every response personally.`
      ),
    },
    {
      id: "custom",
      label: "Custom",
      subject: "Regarding your Preciprocal account",
      body: buildTemplate("[Write your message here]"),
    },
  ];

  const [activeTemplate, setActiveTemplate] = useState<string>("welcome");
  const [subject, setSubject] = useState(TEMPLATES[0].subject);
  const [body,    setBody]    = useState(TEMPLATES[0].body);
  const [working, setWorking] = useState(false);
  const [err,     setErr]     = useState("");

  function applyTemplate(tpl: Template) {
    setActiveTemplate(tpl.id);
    setSubject(tpl.subject);
    setBody(tpl.body);
  }

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

      {/* Recipient card */}
      <div className="flex items-center gap-3 px-3.5 py-3 bg-gray-50 border border-gray-100 rounded-lg">
        <Avatar name={user.name} size={38} />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-gray-900">{user.name ?? "Unknown"}</div>
          <div className="text-xs text-gray-400 truncate">{email || "No email on file"}</div>
        </div>
        {user.lastContactedAt
          ? <div className="text-[10px] text-gray-400 text-right shrink-0">Last contacted<br/><span className="font-semibold text-gray-600">{fmtFull(user.lastContactedAt)}</span></div>
          : <div className="text-[10px] text-gray-300 shrink-0 italic">Never contacted</div>}
      </div>

      {/* Template picker */}
      <div>
        <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2">Email Template</div>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
          {TEMPLATES.map(t => (
            <button key={t.id} onClick={() => applyTemplate(t)}
              className={`px-2.5 py-2 rounded-lg border text-[11px] font-medium cursor-pointer text-left transition-all ${
                activeTemplate === t.id
                  ? "bg-indigo-50 border-indigo-300 text-indigo-700 font-semibold"
                  : "bg-white border-gray-200 text-gray-600 hover:border-gray-300 hover:bg-gray-50"
              }`}>
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Subject */}
      <div>
        <label className="block text-[11px] font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Subject</label>
        <input value={subject} onChange={e => setSubject(e.target.value)} className={inputCls} />
      </div>

      {/* Body - professional template with editable content */}
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <label className="block text-[11px] font-semibold text-gray-500 uppercase tracking-wide">Message</label>
          <span className="text-[10px] text-gray-400">Edit the content in [brackets] before sending</span>
        </div>
        <textarea value={body} onChange={e => setBody(e.target.value)} rows={10}
          className={`${inputCls} resize-y leading-relaxed font-[inherit] text-[13px]`}
          spellCheck />
      </div>

      {/* Preview hint */}
      <div className="px-3 py-2.5 bg-gray-50 border border-gray-100 rounded-lg">
        <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">Email Preview</div>
        <div className="text-[11px] text-gray-500">
          <span className="font-semibold text-gray-700">To:</span> {email || "—"}
          &nbsp;&nbsp;
          <span className="font-semibold text-gray-700">From:</span> support@preciprocal.com
        </div>
        <div className="text-[11px] text-gray-500 mt-0.5">
          <span className="font-semibold text-gray-700">Subject:</span> {subject || "—"}
        </div>
      </div>

      {err && (
        <div className="px-3 py-2 bg-rose-50 border border-rose-200 rounded-lg text-xs text-rose-700">{err}</div>
      )}

      <div className="flex items-center gap-3">
        <button onClick={send} disabled={working || !email}
          className={`flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-bold text-white border-none cursor-pointer disabled:opacity-40 transition-colors ${working ? "bg-gray-400 cursor-wait" : "bg-gray-900 hover:bg-gray-800"}`}>
          <svg width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>
          </svg>
          {working ? "Sending…" : "Send Email"}
        </button>
        <div className="flex items-center gap-1.5 text-[11px] text-gray-400">
          <svg width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>
          </svg>
          Sent via Resend · Logged in Firebase
        </div>
      </div>
    </div>
  );
}

export default function StripeTab({ analytics, users, loading, token = "" }: Props) {
  const isMobile = useIsMobile();
  const [search,setSearch]             = useState("");
  const [planFilter,setPlanFilter]     = useState("all");
  const [selectedUser,setSelectedUser] = useState<User|null>(null);
  const [activePanel,setActivePanel]   = useState<"plan"|"coupon"|"contact">("plan");
  const [toast,setToast]               = useState<Toast|null>(null);
  const showToast = (msg:string,type:"ok"|"err"="ok")=>{setToast({msg,type});setTimeout(()=>setToast(null),4000);};
  const stripeUsers   = useMemo(()=>users.filter(u=>u.subscription?.stripeCustomerId||u.email),[users]);
  const filteredUsers = useMemo(()=>{
    let f = search.toLowerCase()
      ? stripeUsers.filter(u=>[u.name,u.email,u.subscription?.stripeCustomerId,u.subscription?.stripeSubscriptionId].some(v=>typeof v==="string"&&v.toLowerCase().includes(search.toLowerCase())))
      : stripeUsers;
    if (planFilter !== "all") f = f.filter(u => (u.subscription?.plan ?? "free") === planFilter);
    return f;
  },[stripeUsers,search,planFilter]);
  const showList   = !isMobile || !selectedUser;
  const showDetail = !isMobile || !!selectedUser;
  if (loading) return <Spinner />;
  return (
    <div className={`flex-1 flex overflow-hidden ${isMobile?"flex-col":"flex-row"}`}>
      <ToastBanner toast={toast} />
      {showList && (
        <div className={`flex flex-col overflow-hidden bg-white ${isMobile?"flex-1":"w-[300px] shrink-0 border-r border-gray-100"}`}>
          <div className="px-4 py-3.5 border-b border-gray-100 shrink-0">
            <div className="text-sm font-bold text-gray-900 mb-2.5">Select a user to manage</div>
            <div className="relative">
              <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>
              <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Name, email, Stripe ID..." className={`${inputCls} pl-8 text-xs`} />
            </div>
            <select value={planFilter} onChange={e=>setPlanFilter(e.target.value)} className={`${selectCls} text-xs mt-2`}>
              <option value="all">All Plans</option>
              <option value="free">Free</option>
              <option value="pro">Pro</option>
              <option value="premium">Premium</option>
              <option value="enterprise">Enterprise</option>
            </select>
            <div className="flex items-center justify-between mt-1.5">
              <span className="text-[10px] text-gray-400">{filteredUsers.length} users</span>
              {planFilter !== "all" && (
                <button onClick={()=>setPlanFilter("all")} className="text-[10px] text-indigo-500 font-medium cursor-pointer border-none bg-transparent">
                  Clear
                </button>
              )}
            </div>
          </div>
          <div className="flex-1 overflow-auto">
            {filteredUsers.map(u=>{
              const pc=planColor(u.subscription?.plan), sc=statusColor(u.subscription?.status), isOn=selectedUser?.id===u.id;
              return (
                <div key={u.id} onClick={()=>setSelectedUser(u)} className={`flex items-center gap-2.5 px-4 py-3 border-b border-gray-50 cursor-pointer transition-colors ${isOn?"bg-indigo-50":"bg-white hover:bg-gray-50"}`}>
                  <div className="w-0.5 self-stretch rounded shrink-0" style={{background:pc.accent}} />
                  <Avatar name={u.name} size={32} />
                  <div className="flex-1 min-w-0">
                    <div className="text-[13px] font-semibold text-gray-900 truncate">{u.name??"Unknown"}</div>
                    <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                      <Chip label={u.subscription?.plan??"free"} className={`border text-[10px] font-bold ${pc.tw}`} />
                      <div className="flex items-center gap-1"><StatusDot color={sc.dot}/><span className="text-[10px] font-medium" style={{color:sc.text}}>{u.subscription?.status??"—"}</span></div>
                    </div>
                  </div>
                  {u.subscription?.stripeCustomerId && <div className="w-2 h-2 rounded-full bg-green-400 shrink-0" />}
                </div>
              );
            })}
            {!filteredUsers.length && <div className="py-12 text-center text-xs text-gray-400">No users found.</div>}
          </div>
        </div>
      )}
      {showDetail && (
        <div className="flex-1 overflow-auto flex flex-col min-w-0">
          {!selectedUser ? (
            <div className="p-4 md:p-7 flex flex-col gap-5">
              {analytics && (
                <section>
                  <SL>Stripe Health</SL>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <MetricCard label="Active Customers" value={analytics.stripeCount}              color="#6366F1" />
                    <MetricCard label="Est. MRR"         value={`$${analytics.revenue.toFixed(2)}`} color="#10B981" />
                    <MetricCard label="Canceled"         value={analytics.canceledCount}            color="#F43F5E" />
                  </div>
                </section>
              )}
              <section>
                <SL>Price IDs <CodeRef k="priceIds" /></SL>
                {isMobile ? (
                  <div className="flex flex-col gap-2">
                    {Object.entries(PRICE_IDS_MAP).map(([id,info])=>{const pc=planColor(info.plan);return(
                      <div key={id} className="bg-white border border-gray-100 rounded-lg px-3.5 py-3">
                        <div className="flex items-center justify-between mb-1.5">
                          <Chip label={info.plan} className={`border font-bold ${pc.tw}`} />
                          <span className="text-sm font-bold text-gray-900">{info.price}</span>
                        </div>
                        <div className="flex items-center justify-between">
                          <code className="font-mono text-[9px] text-indigo-500 truncate max-w-[60%]">{id}</code>
                          <span className="text-xs text-gray-500">{info.billing}</span>
                        </div>
                      </div>
                    );})}
                  </div>
                ) : (
                  <Card className="p-0 overflow-hidden">
                    <table className="w-full border-collapse">
                      <thead><tr className="bg-gray-50 border-b border-gray-100">{["Price ID","Plan","Billing","Price"].map(h=><th key={h} className="px-4 py-2.5 text-left text-[10px] font-bold text-gray-400 uppercase tracking-wider">{h}</th>)}</tr></thead>
                      <tbody>{Object.entries(PRICE_IDS_MAP).map(([id,info])=>{const pc=planColor(info.plan);return(<tr key={id} className="border-b border-gray-50"><td className="px-4 py-2.5 font-mono text-xs text-indigo-500">{id}</td><td className="px-4 py-2.5"><Chip label={info.plan} className={`border font-bold ${pc.tw}`}/></td><td className="px-4 py-2.5 text-sm text-gray-500">{info.billing}</td><td className="px-4 py-2.5 text-sm font-bold text-gray-900">{info.price}</td></tr>);})}</tbody>
                    </table>
                  </Card>
                )}
              </section>
              <section>
                <SL>Webhook Events <CodeRef k="stripeWebhook" /></SL>
                <Card>
                  {WEBHOOK_EVENTS.map(e=>(
                    <div key={e.event} className={`flex gap-3 py-2.5 border-b border-gray-50 last:border-0 ${isMobile?"flex-col":"flex-row items-center"}`}>
                      <div className="flex items-center gap-2.5">
                        <div className="w-1.5 h-1.5 rounded-full bg-green-400 shrink-0" />
                        <code className={`font-mono text-gray-700 ${isMobile?"text-[10px] break-all":"text-sm"}`}>{e.event}</code>
                      </div>
                      <code className={`font-mono text-gray-400 ${isMobile?"text-[10px] ml-4":"text-xs ml-auto"}`}>{e.handler}()</code>
                    </div>
                  ))}
                </Card>
              </section>
            </div>
          ) : (
            <div className="p-4 md:p-7 flex flex-col gap-4">
              {(()=>{
                const pc=planColor(selectedUser.subscription?.plan), sc=statusColor(selectedUser.subscription?.status);
                return (
                  <div className="bg-white border border-gray-100 rounded-xl overflow-hidden">
                    <div className="h-1" style={{background:`linear-gradient(90deg,${pc.accent},${pc.accent}44)`}} />
                    <div className="p-4">
                      <div className="flex items-center gap-3 mb-3">
                        <Avatar name={selectedUser.name} size={44} />
                        <div className="flex-1 min-w-0">
                          <div className="text-base font-extrabold text-gray-900 tracking-tight">{selectedUser.name??"Unknown"}</div>
                          <div className="text-xs text-gray-500 truncate mt-0.5">{selectedUser.email}</div>
                          <div className="flex items-center gap-2 mt-2 flex-wrap">
                            <Chip label={selectedUser.subscription?.plan??"free"} className={`border font-bold ${pc.tw}`} />
                            <div className="flex items-center gap-1"><StatusDot color={sc.dot}/><span className="text-xs font-semibold" style={{color:sc.text}}>{selectedUser.subscription?.status??"—"}</span></div>
                            {selectedUser.subscription?.stripeCustomerId && <Chip label="Stripe" className="bg-green-50 text-green-700 border border-green-200 font-bold" />}
                          </div>
                        </div>
                        <button onClick={()=>setSelectedUser(null)} className="p-1.5 rounded-md border border-gray-100 bg-gray-50 cursor-pointer text-gray-400 hover:bg-gray-100 flex shrink-0">
                          <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M18 6L6 18M6 6l12 12"/></svg>
                        </button>
                      </div>
                      <div className="grid grid-cols-2 gap-x-5 gap-y-1.5">
                        {([["Customer ID",selectedUser.subscription?.stripeCustomerId],["Sub ID",selectedUser.subscription?.stripeSubscriptionId],["Period End",fmtFull(selectedUser.subscription?.currentPeriodEnd)],["UID",selectedUser.id]] as [string,string|undefined][]).map(([l,v])=>(
                          <div key={l} className="min-w-0">
                            <div className="text-[9px] font-bold text-gray-400 uppercase tracking-wider">{l}</div>
                            <div className="font-mono text-[11px] text-indigo-500 mt-0.5 truncate">{v??"—"}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                );
              })()}
              <div className="flex gap-1 bg-gray-100 border border-gray-100 rounded-xl p-1">
                {([
                  {
                    id:"plan", label:"Change Plan",
                    icon:<svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><rect x="1" y="4" width="22" height="16" rx="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg>,
                  },
                  {
                    id:"coupon", label:"Apply Coupon",
                    icon:<svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg>,
                  },
                  {
                    id:"contact", label:"Contact User",
                    icon:<svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>,
                  },
                ] as {id:"plan"|"coupon"|"contact";label:string;icon:React.ReactNode}[]).map(p=>(
                  <button key={p.id} onClick={()=>setActivePanel(p.id)}
                    className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg border-none cursor-pointer font-[inherit] transition-all text-xs font-semibold ${activePanel===p.id?"bg-white text-gray-900 shadow-sm":"bg-transparent text-gray-500 hover:text-gray-700"}`}>
                    {p.icon}<span className={isMobile?"hidden sm:inline":""}>{p.label}</span>
                  </button>
                ))}
              </div>
              <Card>
                {activePanel==="plan"    && <><CardTitle>Change Plan & Dates</CardTitle><PlanEditorPanel user={selectedUser} onSaved={u=>{setSelectedUser(u);showToast("Plan updated in Stripe + Firebase");}} isMobile={isMobile} token={token} /></>}
                {activePanel==="coupon"  && <><CardTitle>Apply Discount Coupon</CardTitle><CouponPanel user={selectedUser} onDone={msg=>showToast(msg)} token={token} /></>}
                {activePanel==="contact" && <><CardTitle>Contact User</CardTitle><ContactPanel user={selectedUser} onDone={msg=>showToast(msg)} token={token} /></>}
              </Card>
              <Card>
                <CardTitle>Current Subscription</CardTitle>
                <FRow label="Plan"         badgeLabel={selectedUser.subscription?.plan??"free"} badgeClassName={`border font-bold ${planColor(selectedUser.subscription?.plan).tw}`} />
                <FRow label="Status"       badgeLabel={selectedUser.subscription?.status??"—"} badgeClassName="text-xs font-semibold" />
                <FRow label="Period Start" value={fmtFull(selectedUser.subscription?.currentPeriodStart)} />
                <FRow label="Period End"   value={fmtFull(selectedUser.subscription?.currentPeriodEnd)} />
                <FRow label="Trial Ends"   value={fmtFull(selectedUser.subscription?.trialEndsAt)} />
                <FRow label="Canceled At"  value={fmtFull(selectedUser.subscription?.canceledAt)} />
                <FRow label="Last Payment" value={fmtFull(selectedUser.subscription?.lastPaymentAt)} />
                <FRow label="Last Coupon"  value={selectedUser.subscription?.lastAppliedCoupon} />
              </Card>
            </div>
          )}
        </div>
      )}
    </div>
  );
}