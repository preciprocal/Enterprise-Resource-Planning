// components/admin/UsersTab.tsx
"use client";

import { useState } from "react";
import {
  User, AnalyticsData, PLANS, USAGE_FIELDS, LIMITS, PRICE_IDS_MAP, WEBHOOK_EVENTS,
  planColor, statusColor, fmtFull, daysAgo,
  Avatar, Chip, FRow, CodeRef, SL, Spinner, HBar, Card, CardTitle,
  inputCls, selectCls, useIsMobile,
} from "./admin-shared";

interface Props {
  users: User[]; filtered: User[]; loading: boolean; analytics: AnalyticsData | null;
  search: string; setSearch: (v: string) => void;
  planF: string; setPlanF: (v: string) => void;
  sortF: string; setSortF: (v: string) => void;
  sortD: "asc" | "desc"; setSortD: (fn: (d: "asc"|"desc") => "asc"|"desc") => void;
  saveUser: (user: User) => Promise<void>; saving: boolean; msg: string;
}

export default function UsersTab({ users, filtered, loading, search, setSearch, planF, setPlanF, sortF, setSortF, sortD, setSortD, saveUser, saving, msg }: Props) {
  const [sel,  setSel]  = useState<User | null>(null);
  const [edit, setEdit] = useState<User | null>(null);
  const [tab,  setTab]  = useState("profile");
  const isMobile = useIsMobile();

  return (
    <div className="flex-1 flex overflow-hidden min-w-0">

      {/* List panel */}
      <div className="flex-1 flex flex-col overflow-hidden min-w-0">
        {/* Toolbar */}
        <div className="px-4 sm:px-5 py-3 border-b border-gray-100 flex gap-2 items-center bg-white shrink-0">
          <div className="relative flex-1">
            <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/>
            </svg>
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search name, email, UID…" className={`${inputCls} pl-8 text-xs`} />
          </div>
          <select value={planF} onChange={e => setPlanF(e.target.value)} className={`${selectCls} w-auto min-w-[100px] text-xs`}>
            <option value="all">All Plans</option>
            {PLANS.map(p => <option key={p} value={p}>{p.charAt(0).toUpperCase()+p.slice(1)}</option>)}
          </select>
          <span className="text-[11px] text-gray-400 whitespace-nowrap">{filtered.length}</span>
        </div>

        {/* List */}
        <div className="flex-1 overflow-auto bg-white">
          {loading ? <Spinner /> : isMobile ? (
            // Mobile cards
            <div className="flex flex-col gap-px bg-gray-50">
              {filtered.map(u => {
                const p = planColor(u.subscription?.plan);
                const s = statusColor(u.subscription?.status);
                return (
                  <div key={u.id} onClick={() => { setSel(u); setEdit(JSON.parse(JSON.stringify(u))); setTab("profile"); }}
                    className={`bg-white px-4 py-3 cursor-pointer border-b border-gray-50 ${sel?.id===u.id ? "bg-violet-50" : ""}`}>
                    <div className="flex items-center gap-3">
                      <div className="w-0.5 self-stretch rounded-sm shrink-0" style={{ background: p.accent }} />
                      <Avatar name={u.name} size={38} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2">
                          <div className="text-sm font-semibold text-gray-900 truncate">{u.name ?? "Unknown"}</div>
                          <span className="text-[11px] text-gray-400 shrink-0">{daysAgo(u.createdAt)}</span>
                        </div>
                        <div className="text-[11px] text-gray-400 truncate mt-0.5">{u.email}</div>
                        <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                          <Chip label={u.subscription?.plan ?? "free"} className={`border font-bold ${p.tw}`} />
                          <div className="flex items-center gap-1">
                            <div className="w-1.5 h-1.5 rounded-full" style={{ background: s.dot }} />
                            <span className="text-[11px] font-semibold" style={{ color: s.text }}>{u.subscription?.status ?? "—"}</span>
                          </div>
                          {u.subscription?.stripeCustomerId && (
                            <Chip label="Stripe" className="bg-green-50 text-green-700 border border-green-200 font-bold text-[10px]" />
                          )}
                        </div>
                      </div>
                      <svg className="text-gray-300 shrink-0" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M9 18l6-6-6-6"/></svg>
                    </div>
                  </div>
                );
              })}
              {!filtered.length && <div className="p-16 text-center text-sm text-gray-400">No users found.</div>}
            </div>
          ) : (
            // Desktop table
            <table className="w-full border-collapse" style={{ tableLayout:"fixed" }}>
              <colgroup>
                <col style={{ width:"36%" }}/><col style={{ width:"13%" }}/>
                <col style={{ width:"16%" }}/><col style={{ width:"15%" }}/><col style={{ width:"20%" }}/>
              </colgroup>
              <thead className="sticky top-0 z-10">
                <tr className="bg-gray-50 border-b border-gray-100">
                  {(["name","plan","status","stripe","createdAt"] as const).map(f => (
                    <th key={f} className="px-3.5 py-2.5 text-left text-[10px] font-bold text-gray-400 uppercase tracking-widest whitespace-nowrap">
                      {{"name":"Name","plan":"Plan","status":"Status","stripe":"Stripe","createdAt":"Joined"}[f]}
                      {(["name","plan","createdAt"] as const).includes(f as "name") && (
                        <button className={`ml-0.5 bg-transparent border-none cursor-pointer text-[9px] ${sortF===f ? "text-indigo-500" : "text-gray-300"}`}
                          onClick={() => { setSortF(f); setSortD(d => f===sortF ? (d==="asc"?"desc":"asc") : "asc"); }}>
                          {sortF===f ? (sortD==="asc" ? "↑" : "↓") : "↕"}
                        </button>
                      )}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map(u => {
                  const p = planColor(u.subscription?.plan);
                  const s = statusColor(u.subscription?.status);
                  return (
                    <tr key={u.id} onClick={() => { setSel(u); setEdit(JSON.parse(JSON.stringify(u))); setTab("profile"); }}
                      className={`border-b border-gray-50 cursor-pointer hover:bg-gray-50 transition-colors ${sel?.id===u.id ? "bg-violet-50" : "bg-white"}`}>
                      <td className="px-3.5 py-2.5">
                        <div className="flex items-center gap-2.5">
                          <div className="w-0.5 h-9 rounded-sm shrink-0" style={{ background: p.accent }} />
                          <Avatar name={u.name} size={34} />
                          <div className="min-w-0">
                            <div className="text-[13px] font-semibold text-gray-900 truncate">{u.name ?? "Unknown"}</div>
                            <div className="text-[11px] text-gray-400 truncate mt-0.5">{u.email}</div>
                          </div>
                        </div>
                      </td>
                      <td className="px-3.5 py-2.5"><Chip label={u.subscription?.plan ?? "free"} className={`border font-bold ${p.tw}`} /></td>
                      <td className="px-3.5 py-2.5">
                        <div className="flex items-center gap-1.5">
                          <div className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: s.dot }} />
                          <span className="text-xs font-semibold" style={{ color: s.text }}>{u.subscription?.status ?? "—"}</span>
                        </div>
                      </td>
                      <td className="px-3.5 py-2.5">
                        {u.subscription?.stripeCustomerId
                          ? <Chip label="Connected" className="bg-green-50 text-green-700 border border-green-200 font-bold" />
                          : <span className="text-xs text-gray-200">—</span>}
                      </td>
                      <td className="px-3.5 py-2.5 text-xs text-gray-400 font-medium">{daysAgo(u.createdAt)}</td>
                    </tr>
                  );
                })}
                {!filtered.length && <tr><td colSpan={5} className="py-16 text-center text-sm text-gray-400">No users found.</td></tr>}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Detail panel */}
      {sel && edit && (
        <UserDetailPanel sel={sel} edit={edit} setEdit={setEdit} tab={tab} setTab={setTab}
          onClose={() => { setSel(null); setEdit(null); }}
          saveUser={saveUser} saving={saving} msg={msg} users={users} />
      )}
    </div>
  );
}

interface DetailProps {
  sel: User; edit: User; setEdit: (fn: (p: User|null) => User|null) => void;
  tab: string; setTab: (t: string) => void; onClose: () => void;
  saveUser: (u: User) => Promise<void>; saving: boolean; msg: string; users: User[];
}

function UserDetailPanel({ sel, edit, setEdit, tab, setTab, onClose, saveUser, saving, msg }: DetailProps) {
  const hpc = planColor(sel.subscription?.plan);
  const hsc = statusColor(sel.subscription?.status);

  return (
    <div className="fixed inset-0 z-50 sm:relative sm:inset-auto sm:z-auto w-full sm:w-[420px] shrink-0 overflow-auto bg-white flex flex-col sm:border-l sm:border-gray-100 h-full">

      {/* Hero */}
      <div className="shrink-0">
        <div className="h-1" style={{ background:`linear-gradient(90deg,${hpc.accent},${hpc.accent}55)` }} />
        <div className="p-4 border-b border-gray-100">
          <div className="flex items-start justify-between mb-3">
            <div className="flex items-center gap-3 min-w-0">
              <Avatar name={sel.name} size={44} />
              <div className="min-w-0">
                <div className="text-base font-extrabold text-gray-900 tracking-tight">{sel.name ?? "Unknown"}</div>
                <div className="text-xs text-gray-500 mt-0.5 truncate max-w-[220px]">{sel.email}</div>
              </div>
            </div>
            <button onClick={onClose} className="p-1.5 rounded-md border border-gray-100 bg-gray-50 cursor-pointer text-gray-400 flex shrink-0 hover:bg-gray-100">
              <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M18 6L6 18M6 6l12 12"/></svg>
            </button>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div className="bg-gray-50 rounded-lg p-2">
              <div className="text-[9px] font-bold text-gray-400 uppercase tracking-widest mb-1">Plan</div>
              <Chip label={sel.subscription?.plan ?? "free"} className={`border font-bold ${hpc.tw}`} />
            </div>
            <div className="bg-gray-50 rounded-lg p-2">
              <div className="text-[9px] font-bold text-gray-400 uppercase tracking-widest mb-1">Status</div>
              <div className="flex items-center gap-1.5">
                <div className="w-1.5 h-1.5 rounded-full" style={{ background:hsc.dot }} />
                <span className="text-xs font-semibold" style={{ color:hsc.text }}>{sel.subscription?.status ?? "—"}</span>
              </div>
            </div>
            <div className="bg-gray-50 rounded-lg p-2">
              <div className="text-[9px] font-bold text-gray-400 uppercase tracking-widest mb-1">Joined</div>
              <span className="text-xs font-medium text-gray-700">{daysAgo(sel.createdAt)}</span>
            </div>
          </div>
          {sel.isAdmin && <Chip label="Admin" className="bg-amber-50 text-amber-800 border border-amber-200 font-bold mt-2" />}
          <div className="font-mono text-[9px] text-gray-300 mt-2 tracking-wide truncate">uid: {sel.id}</div>
        </div>
      </div>

      {/* Tabs */}
      <div className="px-3 py-2 border-b border-gray-100 bg-gray-50 flex gap-1 shrink-0 flex-wrap">
        {(["profile","stripe","subscription","usage","raw"] as const).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-3 py-1.5 rounded text-xs font-semibold transition-all cursor-pointer border-none font-sans ${tab===t ? "bg-gray-900 text-white" : "bg-transparent text-gray-500 hover:bg-gray-100 hover:text-gray-900"}`}>
            {t.charAt(0).toUpperCase()+t.slice(1)}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-4 sm:p-5">

        {tab === "profile" && (
          <div>
            <SL>Account</SL>
            <FRow label="Name"       value={sel.name} />
            <FRow label="Email"      value={sel.email} copyable />
            <FRow label="Provider"   value={sel.provider} />
            <FRow label="Is Admin"   value={String(sel.isAdmin ?? false)} />
            <FRow label="Created"    value={fmtFull(sel.createdAt)} />
            <FRow label="Updated"    value={fmtFull(sel.updatedAt)} />
            <FRow label="Last Login" value={fmtFull(sel.lastLogin)} />
            <div className="mt-5">
              <SL>Edit</SL>
              <div className="grid grid-cols-2 gap-2.5">
                {(["name","email"] as const).map(k => (
                  <div key={k}>
                    <label className="block text-[11px] font-semibold text-gray-500 mb-1 uppercase tracking-wide">{k.charAt(0).toUpperCase()+k.slice(1)}</label>
                    <input value={String(edit[k]??"")} onChange={e => setEdit(p => p ? {...p,[k]:e.target.value} : p)} className={inputCls} />
                  </div>
                ))}
                <div>
                  <label className="block text-[11px] font-semibold text-gray-500 mb-1 uppercase tracking-wide">Admin</label>
                  <select value={String(edit.isAdmin??false)} onChange={e => setEdit(p => p ? {...p,isAdmin:e.target.value==="true"} : p)} className={selectCls}>
                    <option value="false">No</option><option value="true">Yes</option>
                  </select>
                </div>
              </div>
            </div>
          </div>
        )}

        {tab === "stripe" && (
          <div>
            <SL>Stripe IDs</SL>
            <div className="bg-violet-50 border border-violet-100 rounded-lg p-3 mb-4">
              {([["Customer ID",sel.subscription?.stripeCustomerId,"stripeCreateSub"],["Sub ID",sel.subscription?.stripeSubscriptionId,"stripeWebhook"]] as [string,string|undefined,string][]).map(([l,v,r]) => (
                <div key={l} className="flex items-center gap-2 py-1.5 border-b border-violet-100 last:border-0 overflow-hidden">
                  <div className="w-20 text-[9px] text-gray-400 font-bold uppercase tracking-wider shrink-0">{l}</div>
                  <code className="flex-1 font-mono text-[11px] truncate min-w-0" style={{ color: v ? "#6366F1" : "#9CA3AF" }}>{v ?? "—"}</code>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {v && <button onClick={() => navigator.clipboard?.writeText(v)} className="text-[10px] bg-white border border-violet-200 rounded px-1.5 py-0.5 cursor-pointer text-indigo-600 font-medium">Copy</button>}
                    <CodeRef k={r} />
                  </div>
                </div>
              ))}
            </div>
            <div className="grid grid-cols-1 gap-2.5 mb-5">
              {(["stripeCustomerId","stripeSubscriptionId"] as const).map(k => (
                <div key={k}>
                  <label className="block text-[11px] font-semibold text-gray-500 mb-1 uppercase tracking-wide">{k==="stripeCustomerId" ? "Customer ID" : "Subscription ID"}</label>
                  <input value={String(edit.subscription?.[k]??"")} onChange={e => setEdit(p => p ? {...p,subscription:{...p.subscription,[k]:e.target.value||null}} : p)} placeholder="null" className={`${inputCls} font-mono text-xs`} />
                </div>
              ))}
            </div>
            <SL>Price IDs <CodeRef k="priceIds" /></SL>
            <div className="border border-gray-100 rounded-lg overflow-hidden mb-4">
              <table className="w-full border-collapse text-xs">
                <thead><tr className="bg-gray-50">{["ID","Plan","Billing","Price"].map(h => <th key={h} className="px-3 py-2 text-left text-[9px] font-bold text-gray-400 uppercase tracking-widest border-b border-gray-100">{h}</th>)}</tr></thead>
                <tbody>
                  {Object.entries(PRICE_IDS_MAP).map(([id,info]) => {
                    const pc = planColor(info.plan);
                    return (
                      <tr key={id} className="border-b border-gray-50 last:border-0">
                        <td className="px-3 py-2 font-mono text-[9px] text-indigo-500">{id.slice(-8)}</td>
                        <td className="px-3 py-2"><Chip label={info.plan} className={`border ${pc.tw}`} /></td>
                        <td className="px-3 py-2 text-gray-500">{info.billing}</td>
                        <td className="px-3 py-2 font-bold text-gray-900">{info.price}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <SL>Webhooks <CodeRef k="stripeWebhook" /></SL>
            <div className="bg-violet-50 border border-violet-100 rounded-lg p-3">
              {WEBHOOK_EVENTS.map(e => (
                <div key={e.event} className="flex items-center gap-2 py-1.5 border-b border-violet-100 last:border-0">
                  <div className="w-1.5 h-1.5 rounded-full bg-green-400 shrink-0" />
                  <code className="flex-1 text-[9px] text-indigo-700 font-mono truncate">{e.event}</code>
                </div>
              ))}
            </div>
          </div>
        )}

        {tab === "subscription" && (
          <div>
            <SL>Details</SL>
            <FRow label="Plan"         badgeLabel={sel.subscription?.plan ?? "free"} badgeClassName={`border font-bold ${planColor(sel.subscription?.plan).tw}`} />
            <FRow label="Status"       badgeLabel={sel.subscription?.status ?? "—"}  badgeClassName="text-xs font-semibold px-2 py-0.5 rounded" />
            <FRow label="Iv Used"      value={sel.subscription?.interviewsUsed} />
            <FRow label="Iv Limit"     value={sel.subscription?.interviewsLimit===999999 ? "∞" : sel.subscription?.interviewsLimit} />
            <FRow label="Period End"   value={fmtFull(sel.subscription?.currentPeriodEnd)} />
            <FRow label="Ends At"      value={fmtFull(sel.subscription?.subscriptionEndsAt)} />
            <FRow label="Canceled At"  value={fmtFull(sel.subscription?.canceledAt)} />
            <FRow label="Last Payment" value={fmtFull(sel.subscription?.lastPaymentAt)} />
            <FRow label="Trial Ends"   value={fmtFull(sel.subscription?.trialEndsAt)} />
            <FRow label="Student"      value={String(sel.subscription?.studentVerified ?? false)} />
            <div className="mt-5">
              <SL>Edit</SL>
              <div className="grid grid-cols-2 gap-2.5">
                {(["plan","status"] as const).map(k => (
                  <div key={k}>
                    <label className="block text-[11px] font-semibold text-gray-500 mb-1 uppercase tracking-wide">{k.charAt(0).toUpperCase()+k.slice(1)}</label>
                    <select value={String(edit.subscription?.[k]??"")} onChange={e => setEdit(p => p ? {...p,subscription:{...p.subscription,[k]:e.target.value}} : p)} className={selectCls}>
                      {(k==="plan" ? PLANS : ["active","canceled","past_due","trialing"]).map(o => <option key={o} value={o}>{o}</option>)}
                    </select>
                  </div>
                ))}
                <div>
                  <label className="block text-[11px] font-semibold text-gray-500 mb-1 uppercase tracking-wide">Iv Limit</label>
                  <input type="number" value={Number(edit.subscription?.interviewsLimit??0)} onChange={e => setEdit(p => p ? {...p,subscription:{...p.subscription,interviewsLimit:Number(e.target.value)}} : p)} className={inputCls} />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-gray-500 mb-1 uppercase tracking-wide">Student</label>
                  <select value={String(edit.subscription?.studentVerified??false)} onChange={e => setEdit(p => p ? {...p,subscription:{...p.subscription,studentVerified:e.target.value==="true"}} : p)} className={selectCls}>
                    <option value="false">No</option><option value="true">Yes</option>
                  </select>
                </div>
              </div>
            </div>
          </div>
        )}

        {tab === "usage" && (
          <div>
            <SL>Feature Counters</SL>
            {USAGE_FIELDS.map(({ key, label, color }) => {
              const val  = (edit.usage?.[key] as number) ?? 0;
              const plan = edit.subscription?.plan ?? "free";
              const lim  = LIMITS[plan]?.[key as string] ?? 0;
              const inf  = lim === -1;
              const pct  = inf ? 15 : lim > 0 ? Math.min(100,Math.round((val/lim)*100)) : 0;
              const over = !inf && val >= lim && lim > 0;
              return (
                <div key={key as string} className="grid items-center gap-2.5 py-2 border-b border-gray-50 last:border-0"
                  style={{ gridTemplateColumns:"3px 88px 1fr 52px 22px" }}>
                  <div className="h-6 rounded-sm" style={{ background: color }} />
                  <span className="text-xs text-gray-700 font-medium">{label}</span>
                  <HBar pct={pct} color={over ? "#F43F5E" : color} />
                  <input type="number" min={0} value={val} onChange={e => setEdit(p => p ? {...p,usage:{...p.usage,[key]:Number(e.target.value)}} : p)}
                    className="w-full border border-gray-200 rounded px-1.5 py-1 text-xs font-bold text-gray-900 text-center font-sans focus:outline-none focus:ring-1 focus:ring-indigo-400" />
                  <span className="text-[10px] text-gray-400 text-right">{inf ? "∞" : lim}</span>
                </div>
              );
            })}
            <div className="flex gap-2 items-center mt-3">
              <button onClick={() => setEdit(p => p ? {...p,usage:{...p.usage,...Object.fromEntries(USAGE_FIELDS.map(f=>[f.key,0])),lastReset:new Date().toISOString()}} : p)}
                className="px-3 py-1.5 rounded-md bg-green-50 border border-green-200 text-green-700 text-xs font-semibold cursor-pointer hover:bg-green-100">
                Reset All
              </button>
              <CodeRef k="usageGuard" />
            </div>
          </div>
        )}

        {tab === "raw" && (
          <div>
            <div className="flex items-center gap-2 mb-3">
              <code className="text-[10px] text-indigo-500 font-mono">users/{sel.id}</code>
              <CodeRef k="adminTs" />
              <button onClick={() => navigator.clipboard?.writeText(JSON.stringify(sel,null,2))}
                className="ml-auto px-2.5 py-1 rounded border border-gray-200 bg-white text-xs cursor-pointer text-gray-600 hover:bg-gray-50">
                Copy
              </button>
            </div>
            <pre className="bg-slate-900 text-slate-200 rounded-xl p-4 text-[10px] leading-relaxed overflow-auto max-h-[500px] font-mono">
              {JSON.stringify(sel,null,2)}
            </pre>
          </div>
        )}

        {tab !== "raw" && (
          <div className="flex items-center gap-2 mt-5 pt-4 border-t border-gray-100">
            <button onClick={() => saveUser(edit)} disabled={saving}
              className={`px-5 py-2 rounded-lg text-sm font-bold text-white border-none cursor-pointer font-sans ${saving ? "bg-indigo-300" : "bg-gray-900 hover:bg-gray-800"}`}>
              {saving ? "Saving…" : "Save"}
            </button>
            <button onClick={() => setEdit(JSON.parse(JSON.stringify(sel)))}
              className="px-3 py-2 rounded-lg bg-white border border-gray-200 text-xs cursor-pointer text-gray-500 hover:bg-gray-50 font-sans">
              Discard
            </button>
            {msg && <span className={`text-xs font-semibold ${msg.startsWith("✓") ? "text-green-600" : "text-red-500"}`}>{msg}</span>}
            <div className="ml-auto"><CodeRef k="adminRoute" /></div>
          </div>
        )}
      </div>
    </div>
  );
}