"use client";

import { useState, useCallback, useMemo, useEffect } from "react";

let _usersCache: import("./admin/admin-shared").User[] | null = null;
let _cacheTime = 0;
const CACHE_TTL = 60_000;

import { initializeApp, getApps } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { User, AnalyticsData, USAGE_FIELDS, CODE_REFS, useIsMobile } from "./admin/admin-shared";
import OverviewTab  from "./admin/OverviewTab";
import UsersTab     from "./admin/UsersTab";
import StripeTab    from "./admin/StripeTab";
import AnalyticsTab from "./admin/AnalyticsTab";
import EmailTab     from "./admin/EmailTab";
import LogsTab      from "./admin/LogsTab";

function getDb() {
  const cfg = {
    apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
    authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
    storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
    appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
  };
  const app = getApps().find(a => a.name === "adm-client") ?? initializeApp(cfg, "adm-client");
  return getFirestore(app);
}

const NAV = [
  { id: "overview",  label: "Overview",  icon: <svg width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg> },
  { id: "users",     label: "Users",     icon: <svg width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg> },
  { id: "stripe",    label: "Stripe",    icon: <svg width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><rect x="1" y="4" width="22" height="16" rx="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg> },
  { id: "analytics", label: "Analytics", icon: <svg width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg> },
  { id: "logs",      label: "Logs",      icon: <svg width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M9 12h6M9 16h6M17 21H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l5 5v11a2 2 0 0 1-2 2z"/></svg> },
  { id: "email",     label: "Email",     icon: <svg width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M20 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 4-8 5-8-5V6l8 5 8-5v2z"/></svg> },
];

const NAV_GROUPS = [
  { g: "Dashboard", ids: ["overview", "users"] },
  { g: "Data",      ids: ["stripe", "analytics"] },
  { g: "Tools",     ids: ["logs", "email"] },
];

const NAV_TITLES: Record<string, string> = {
  overview: "Overview", users: "Users", stripe: "Stripe",
  analytics: "Analytics", logs: "Activity Logs", email: "Outlook Inbox",
};

export default function AdminDashboard({ onLogout, token = "" }: { onLogout?: () => void; token?: string }) {
  const isMobile = useIsMobile();
  const [nav, setNav]         = useState("overview");
  const [loading, setLoading] = useState(false);
  const [users, setUsers]     = useState<User[]>([]);
  const [saving, setSaving]   = useState(false);
  const [msg, setMsg]         = useState("");
  const [search, setSearch]   = useState("");
  const [planF, setPlanF]     = useState("all");
  const [sortF, setSortF]     = useState("createdAt");
  const [sortD, setSortD]     = useState<"asc"|"desc">("desc");
  const [showRefs, setShowRefs]   = useState(false);
  const [loadError, setLoadError] = useState("");
  const [emailUnread, setEmailUnread] = useState(0);

  const filtered = useMemo(() => {
    if (!users.length) return [];
    let f = [...users];
    const q = search.toLowerCase();
    if (q) f = f.filter(u => [u.name,u.email,u.id,u.subscription?.stripeCustomerId,u.subscription?.stripeSubscriptionId].some(v => typeof v === "string" && v.toLowerCase().includes(q)));
    if (planF !== "all") f = f.filter(u => (u.subscription?.plan ?? "free") === planF);
    return [...f].sort((a, b) => {
      const av = sortF === "createdAt" ? (a.createdAt ?? "") : sortF === "plan" ? (a.subscription?.plan ?? "") : (a.name ?? "");
      const bv = sortF === "createdAt" ? (b.createdAt ?? "") : sortF === "plan" ? (b.subscription?.plan ?? "") : (b.name ?? "");
      return sortD === "asc" ? (av > bv ? 1 : -1) : (av < bv ? 1 : -1);
    });
  }, [users, search, planF, sortF, sortD]);

  const analytics = useMemo((): AnalyticsData | null => {
    if (!users.length) return null;
    const now = new Date(), tm = now.getMonth(), ty = now.getFullYear();
    const pc = { free:0, pro:0, premium:0 };
    let rev=0, stripe=0, canceled=0, active=0, newTm=0, newLm=0, power=0;
    const ms: Record<string, { label:string; count:number }> = {};
    for (let i = 7; i >= 0; i--) { const d=new Date(ty,tm-i,1); ms[`${d.getFullYear()}-${d.getMonth()}`]={ label:d.toLocaleDateString("en-GB",{month:"short",year:"2-digit"}), count:0 }; }
    const ft: Record<string,number> = {}; USAGE_FIELDS.forEach(f => { ft[f.key as string]=0; });
    const prov: Record<string,number> = {};
    users.forEach(u => {
      const plan = u.subscription?.plan ?? "free";
      if (plan in pc) pc[plan as keyof typeof pc]++;
      if (plan==="pro") rev+=9.99; if (plan==="premium") rev+=24.99;
      if (u.subscription?.stripeCustomerId) stripe++;
      if (u.subscription?.status==="canceled") canceled++;
      prov[u.provider??"email"]=(prov[u.provider??"email"]??0)+1;
      if (u.createdAt) {
        const d=new Date(u.createdAt), key=`${d.getFullYear()}-${d.getMonth()}`;
        if (ms[key]) ms[key].count++;
        if (d.getMonth()===tm&&d.getFullYear()===ty) newTm++;
        const lm=new Date(ty,tm-1,1); if (d.getMonth()===lm.getMonth()&&d.getFullYear()===lm.getFullYear()) newLm++;
      }
      let tu=0; USAGE_FIELDS.forEach(f => { const v=(u.usage?.[f.key] as number)??0; ft[f.key as string]+=v; tu+=v; });
      if (tu>0) active++; if (tu>10) power++;
    });
    const sa=Object.values(ms);
    const fr=USAGE_FIELDS.map(f=>({label:f.label,value:ft[f.key as string]})).sort((a,b)=>b.value-a.value);
    const tu=USAGE_FIELDS.reduce((s,f)=>s+ft[f.key as string],0);
    return {
      total:users.length, planCounts:pc, revenue:rev, stripeCount:stripe, canceledCount:canceled,
      newThisMonth:newTm, growthDelta:newLm>0?Math.round(((newTm-newLm)/newLm)*100):0,
      signupArr:sa, signupSpark:sa.map(m=>m.count), activeThisMonth:active,
      dormant:users.filter(u=>USAGE_FIELDS.every(f=>!(u.usage?.[f.key]))).length,
      powerUsers:power, avgUsage:users.length?Math.round((tu/users.length)*10)/10:0,
      featureRank:fr, maxFeature:Math.max(...fr.map(f=>f.value),1),
      planSegments:[{color:"#9CA3AF",value:pc.free,label:"Free"},{color:"#3B82F6",value:pc.pro,label:"Pro"},{color:"#F59E0B",value:pc.premium,label:"Premium"}],
      providers:prov, conversionRate:users.length?Math.round(((pc.pro+pc.premium)/users.length)*100):0, totalUsage:tu,
    };
  }, [users]);

  const loadUsers = useCallback((force=false) => {
    // Cache hit — defer setState into microtask so effect body stays pure
    if (!force&&_usersCache&&Date.now()-_cacheTime<CACHE_TTL) {
      void Promise.resolve().then(() => setUsers(_usersCache!));
      return;
    }
    void Promise.resolve()
      .then(() => {
        setLoading(true);
        setLoadError("");
        return fetch("/api/admin?action=users", { headers:token?{"x-firebase-token":token}:{}, cache:"no-store" });
      })
      .then(res => res.json() as Promise<{users?:User[];error?:string}>)
      .then(json => {
        if (!json.users) throw new Error(json.error??"No data");
        _usersCache=json.users; _cacheTime=Date.now();
        setUsers(json.users); setLoading(false);
      })
      .catch((e:Error) => { setLoadError(e.message); setLoading(false); });
  }, [token]);

  useEffect(() => { loadUsers(); }, [loadUsers]);

  const saveUser = useCallback(async (editUser: User) => {
    setSaving(true); setMsg("");
    try {
      const { id, ...rest } = editUser;
      const res = await fetch("/api/admin", { method:"POST", headers:{"Content-Type":"application/json",...(token?{"x-firebase-token":token}:{})}, body:JSON.stringify({id,data:rest}) });
      if (!res.ok) { const e=await res.json() as {error?:string}; throw new Error(e.error??`HTTP ${res.status}`); }
      setUsers(p => p.map(u => u.id===id?{...editUser}:u));
      setMsg("✓ Saved"); setTimeout(()=>setMsg(""),2500);
    } catch(e) { setMsg("✗ "+(e as Error).message); }
    setSaving(false);
  }, []);

  const noRefreshTabs = new Set(["email","logs"]);

  return (
    <div className="min-h-screen flex bg-gray-50" style={{fontFamily:"'Inter',-apple-system,sans-serif"}}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap');
        *,*::before,*::after{box-sizing:border-box} body{margin:0}
        ::-webkit-scrollbar{width:4px;height:4px} ::-webkit-scrollbar-thumb{background:#E5E7EB;border-radius:99px}
        @keyframes spin{to{transform:rotate(360deg)}}
        .scrollbar-hide::-webkit-scrollbar{display:none} .scrollbar-hide{-ms-overflow-style:none;scrollbar-width:none}
      `}</style>

      {!isMobile && (
        <aside className="w-[200px] bg-white border-r border-gray-100 flex flex-col shrink-0 h-screen sticky top-0">
          <div className="px-4 py-[18px] border-b border-gray-100 flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0" style={{background:"linear-gradient(135deg,#6366F1,#8B5CF6)"}}>
              <svg width="14" height="14" fill="none" stroke="#fff" strokeWidth="2.2" viewBox="0 0 24 24"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/></svg>
            </div>
            <div><div className="text-[13px] font-extrabold text-gray-900 tracking-tight leading-tight">Preciprocal</div><div className="text-[9px] font-bold text-gray-400 uppercase tracking-widest">Admin</div></div>
          </div>
          <nav className="p-2 flex-1 overflow-y-auto">
            {NAV_GROUPS.map(({g,ids}) => (
              <div key={g} className="mb-1">
                <div className="text-[10px] font-bold text-gray-300 uppercase tracking-widest px-3 py-2">{g}</div>
                {NAV.filter(n=>ids.includes(n.id)).map(n => (
                  <button key={n.id} onClick={()=>setNav(n.id)}
                    className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-md text-[13px] font-medium transition-all cursor-pointer border-none text-left mb-0.5 ${nav===n.id?"bg-indigo-50 text-indigo-700 font-semibold":"bg-transparent text-gray-500 hover:bg-gray-50 hover:text-gray-900"}`}
                    style={{fontFamily:"inherit"}}>
                    {n.icon}
                    <span className="flex-1">{n.label}</span>
                    {n.id === "email" && emailUnread > 0 && (
                      <span className="ml-auto text-[9px] bg-indigo-500 text-white rounded-full px-1.5 py-0.5 font-bold leading-none">{emailUnread}</span>
                    )}
                  </button>
                ))}
              </div>
            ))}
          </nav>
          <div className="px-4 py-3 border-t border-gray-100 text-[10px] text-gray-400 leading-relaxed shrink-0">
            {analytics ? (<><span className="font-semibold text-gray-600">{analytics.total} users</span>{" · "}{analytics.planCounts.pro+analytics.planCounts.premium} paid<br/><span className="text-green-500 font-bold">MRR ${analytics.revenue.toFixed(0)}</span></>) : (<span className="text-gray-300">No data loaded</span>)}
          </div>
        </aside>
      )}

      <div className={`flex-1 flex flex-col min-w-0 h-screen overflow-hidden ${isMobile?"pb-14":""}`}>
        <div className="bg-white border-b border-gray-100 px-4 md:px-6 h-[52px] flex items-center gap-3 shrink-0">
          <div className="flex-1 min-w-0">
            <div className="text-[17px] font-extrabold text-gray-900 tracking-tight">{NAV_TITLES[nav]??nav}</div>
            {analytics&&!isMobile&&!noRefreshTabs.has(nav)&&<div className="text-[11px] text-gray-400">{analytics.total} users · {analytics.planCounts.pro+analytics.planCounts.premium} paying · MRR ${analytics.revenue.toFixed(2)}</div>}
          </div>
          {!isMobile&&<button onClick={()=>setShowRefs(s=>!s)} className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border text-xs font-medium cursor-pointer transition-colors ${showRefs?"bg-indigo-50 border-indigo-200 text-indigo-600":"bg-white border-gray-200 text-gray-600 hover:bg-gray-50"}`}><svg width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>Code Refs</button>}
          {!noRefreshTabs.has(nav)&&<button onClick={()=>{_usersCache=null;void loadUsers(true);}} disabled={loading} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-gray-200 bg-white text-xs font-medium text-gray-600 cursor-pointer hover:bg-gray-50 disabled:opacity-50"><svg width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" style={{animation:loading?"spin .7s linear infinite":"none"}}><path d="M23 4v6h-6M1 20v-6h6M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/></svg>{!isMobile&&(loading?"Loading…":"Refresh")}</button>}
          <span className="hidden sm:inline-flex text-[11px] bg-green-50 text-green-700 px-2.5 py-1 rounded-full font-semibold border border-green-200 shrink-0">{process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID}</span>
          <button onClick={()=>{sessionStorage.removeItem("admin_token");onLogout?.();}} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-gray-200 bg-white text-xs font-medium text-gray-500 cursor-pointer hover:bg-gray-50 hover:text-rose-500 hover:border-rose-200 transition-colors shrink-0"><svg width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>{!isMobile&&"Logout"}</button>
        </div>

        {showRefs&&!isMobile&&(
          <div className="bg-slate-900 border-b border-slate-800 px-6 py-3 shrink-0">
            <div className="text-[9px] font-bold text-slate-500 uppercase tracking-widest mb-2">Codebase References</div>
            <div className="grid gap-1.5" style={{gridTemplateColumns:"repeat(auto-fill,minmax(280px,1fr))"}}>
              {Object.entries(CODE_REFS).map(([k,v])=>(
                <div key={k} title={v.desc} className="flex gap-2 rounded-md px-2.5 py-1.5 border cursor-help" style={{background:"rgba(255,255,255,0.03)",borderColor:"rgba(255,255,255,0.05)"}}>
                  <svg width="9" height="9" fill="none" stroke="#818CF8" strokeWidth="2" viewBox="0 0 24 24" className="mt-0.5 shrink-0"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>
                  <div><div className="font-mono text-[9px] text-indigo-300 mb-0.5">{v.file}</div><div className="text-[9px] text-slate-500">{v.desc}</div></div>
                </div>
              ))}
            </div>
          </div>
        )}

        {loadError&&(
          <div className="shrink-0 mx-4 my-2 px-4 py-3 bg-rose-50 border border-rose-200 rounded-lg flex items-center gap-3">
            <svg width="14" height="14" fill="none" stroke="#F43F5E" strokeWidth="2" viewBox="0 0 24 24" className="shrink-0"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
            <div className="flex-1 min-w-0"><span className="text-sm font-semibold text-rose-700">Failed to load users: </span><span className="text-sm text-rose-600">{loadError}</span></div>
            <button onClick={()=>{_usersCache=null;void loadUsers(true);}} className="shrink-0 text-xs font-semibold text-rose-700 border border-rose-300 bg-white rounded-md px-2.5 py-1 cursor-pointer hover:bg-rose-50">Retry</button>
          </div>
        )}

        <div className="flex-1 flex overflow-hidden">
          {nav==="overview"  && <OverviewTab  analytics={analytics} users={users} loading={loading} token={token} />}
          {nav==="users"     && <UsersTab users={users} filtered={filtered} loading={loading} analytics={analytics} search={search} setSearch={setSearch} planF={planF} setPlanF={setPlanF} sortF={sortF} setSortF={setSortF} sortD={sortD} setSortD={setSortD} saveUser={saveUser} saving={saving} msg={msg} />}
          {nav==="stripe"    && <StripeTab    analytics={analytics} users={users} loading={loading} token={token} />}
          {nav==="analytics" && <AnalyticsTab users={users} loading={loading} token={token} />}
          {nav==="logs"      && <LogsTab      users={users} token={token} />}
          {nav==="email"     && <EmailTab onUnreadChange={setEmailUnread} />}
        </div>
      </div>

      {isMobile&&(
        <nav className="fixed bottom-0 left-0 right-0 z-50 bg-white border-t border-gray-100 h-14 flex items-stretch">
          {NAV.map(n=>(
            <button key={n.id} onClick={()=>setNav(n.id)}
              className={`flex-1 flex flex-col items-center justify-center gap-0.5 border-none cursor-pointer transition-colors ${nav===n.id?"text-indigo-600":"text-gray-400"}`}
              style={{background:nav===n.id?"rgba(99,102,241,0.05)":"transparent",fontFamily:"inherit"}}>
              <div className="relative">
                {n.icon}
                {n.id === "email" && emailUnread > 0 && (
                  <span className="absolute -top-1 -right-1 text-[8px] bg-indigo-500 text-white rounded-full w-3.5 h-3.5 flex items-center justify-center font-bold leading-none">{emailUnread > 9 ? "9+" : emailUnread}</span>
                )}
              </div>
              <span className="text-[9px] font-semibold">{n.label}</span>
            </button>
          ))}
        </nav>
      )}
    </div>
  );
}