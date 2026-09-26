"use client";

import { useState, useCallback, useMemo, useEffect } from "react";

let _usersCache: import("./admin/admin-shared").User[] | null = null;
let _cacheTime = 0;
const CACHE_TTL = 60_000;

import { User, AnalyticsData, USAGE_FIELDS, CODE_REFS, AdminTokenContext, useIsMobile, planMonthlyPrice } from "./admin/admin-shared";
import OverviewTab  from "./admin/OverviewTab";
import UsersTab     from "./admin/UsersTab";
import AnalyticsTab from "./admin/AnalyticsTab";
import EmailTab     from "./admin/EmailTab";
import KanbanTab    from "./admin/KanbanTab";
import LogsTab      from "./admin/LogsTab";
import UsageTab     from "./admin/UsageTab";
import SupportTab   from "./admin/SupportTab";
import AccessTab    from "./admin/AccessTab";

const SUPABASE_PROJECT = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").replace(/^https?:\/\//, "").split(".")[0] || "supabase";

const NAV = [
  { id: "overview",  label: "Overview",  icon: <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg> },
  { id: "users",     label: "Users",     icon: <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg> },
  { id: "analytics", label: "Analytics", icon: <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg> },
  { id: "logs",      label: "Logs",      icon: <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24"><path d="M9 12h6M9 16h6M17 21H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l5 5v11a2 2 0 0 1-2 2z"/></svg> },
  { id: "email",     label: "Email",     icon: <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24"><path d="M20 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 4-8 5-8-5V6l8 5 8-5v2z"/></svg> },
  { id: "kanban",    label: "Tasks",     icon: <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24"><rect x="3" y="3" width="5" height="18" rx="1"/><rect x="10" y="3" width="5" height="12" rx="1"/><rect x="17" y="3" width="5" height="15" rx="1"/></svg> },
  { id: "usage",     label: "Usage",     icon: <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24"><path d="M18 20V10M12 20V4M6 20v-6"/></svg> },
  { id: "support",   label: "Support",   icon: <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg> },
  { id: "access",    label: "Access",    icon: <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg> },
];

const NAV_GROUPS = [
  { g: "Dashboard", ids: ["overview", "users"] },
  { g: "Billing",   ids: ["analytics"] },
  { g: "Tools",     ids: ["logs", "email", "kanban", "usage", "support"] },
  { g: "Settings",  ids: ["access"] },
];

const NAV_TITLES: Record<string, string> = {
  overview: "Overview", users: "Users",
  analytics: "Analytics", logs: "Activity Logs", email: "Inbox", kanban: "Tasks", usage: "API Usage", support: "Support", access: "ERP Access",
};

export default function AdminDashboard({ onLogout, token = "", me }: {
  onLogout?: () => void; token?: string; me?: { uid: string; name: string; email: string } | null;
}) {
  const isMobile = useIsMobile();
  const [nav, setNav]         = useState("overview");
  const [loading, setLoading] = useState(false);
  const [users, setUsers]     = useState<User[]>([]);
  const [saving, setSaving]   = useState(false);
  const [msg, setMsg]         = useState("");
  const [search, setSearch]   = useState("");
  const [planF, setPlanF]     = useState("all");
  const [sortF, setSortF]     = useState("createdAt");
  const [sortD, setSortD]     = useState<"asc" | "desc">("desc");
  const [showRefs, setShowRefs]   = useState(false);
  const [loadError, setLoadError] = useState("");
  const [emailUnread, setEmailUnread] = useState(0);
  const [theme, setTheme] = useState<"dark" | "light">("dark");

  useEffect(() => {
    const saved = localStorage.getItem("adm-theme") as "dark" | "light" | null;
    if (saved === "light") setTheme("light");
    // Deep link, e.g. /?tab=kanban after the Google/Zoom OAuth callback
    const tab = new URLSearchParams(window.location.search).get("tab");
    if (tab && NAV.some(n => n.id === tab)) setNav(tab);
  }, []);

  useEffect(() => {
    if (theme === "light") {
      document.documentElement.setAttribute("data-theme", "light");
    } else {
      document.documentElement.removeAttribute("data-theme");
    }
    localStorage.setItem("adm-theme", theme);
  }, [theme]);

  const filtered = useMemo(() => {
    if (!users.length) return [];
    let f = [...users];
    const q = search.toLowerCase();
    if (q) f = f.filter(u => [u.name, u.email, u.id, u.subscription?.stripeCustomerId, u.subscription?.stripeSubscriptionId].some(v => typeof v === "string" && v.toLowerCase().includes(q)));
    // "student" = any .edu status; "student:<status>" = that status only
    if (planF === "student") f = f.filter(u => !!u.student);
    else if (planF.startsWith("student:")) f = f.filter(u => u.student?.status === planF.slice(8));
    else if (planF !== "all") f = f.filter(u => (u.subscription?.plan ?? "free") === planF);
    return [...f].sort((a, b) => {
      const av = sortF === "createdAt" ? (a.createdAt ?? "") : sortF === "plan" ? (a.subscription?.plan ?? "") : (a.name ?? "");
      const bv = sortF === "createdAt" ? (b.createdAt ?? "") : sortF === "plan" ? (b.subscription?.plan ?? "") : (b.name ?? "");
      return sortD === "asc" ? (av > bv ? 1 : -1) : (av < bv ? 1 : -1);
    });
  }, [users, search, planF, sortF, sortD]);

  const analytics = useMemo((): AnalyticsData | null => {
    if (!users.length) return null;
    const now = new Date(), tm = now.getMonth(), ty = now.getFullYear();
    const pc = { free: 0, pro: 0, premium: 0 };
    let rev = 0, stripe = 0, canceled = 0, active = 0, newTm = 0, newLm = 0, power = 0;
    const ms: Record<string, { label: string; count: number }> = {};
    for (let i = 7; i >= 0; i--) { const d = new Date(ty, tm - i, 1); ms[`${d.getFullYear()}-${d.getMonth()}`] = { label: d.toLocaleDateString("en-GB", { month: "short", year: "2-digit" }), count: 0 }; }
    const ft: Record<string, number> = {}; USAGE_FIELDS.forEach(f => { ft[f.key as string] = 0; });
    const prov: Record<string, number> = {};
    users.forEach(u => {
      const plan = u.subscription?.plan ?? "free";
      if (plan in pc) pc[plan as keyof typeof pc]++;
      // Exclude admins and edu-email/free-override users from MRR
      const billable = !u.isAdmin && !u.subscription?.studentVerified;
      if (billable) rev += planMonthlyPrice(plan);
      if (u.subscription?.stripeCustomerId) stripe++;
      if (u.subscription?.status === "canceled") canceled++;
      prov[u.provider ?? "email"] = (prov[u.provider ?? "email"] ?? 0) + 1;
      if (u.createdAt) {
        const d = new Date(u.createdAt), key = `${d.getFullYear()}-${d.getMonth()}`;
        if (ms[key]) ms[key].count++;
        if (d.getMonth() === tm && d.getFullYear() === ty) newTm++;
        const lm = new Date(ty, tm - 1, 1); if (d.getMonth() === lm.getMonth() && d.getFullYear() === lm.getFullYear()) newLm++;
      }
      let tu = 0; USAGE_FIELDS.forEach(f => { const v = (u.usage?.[f.key] as number) ?? 0; ft[f.key as string] += v; tu += v; });
      if (tu > 0) active++; if (tu > 10) power++;
    });
    const sa = Object.values(ms);
    const fr = USAGE_FIELDS.map(f => ({ label: f.label, value: ft[f.key as string] })).sort((a, b) => b.value - a.value);
    const tu = USAGE_FIELDS.reduce((s, f) => s + ft[f.key as string], 0);
    return {
      total: users.length, planCounts: pc, revenue: rev, stripeCount: stripe, canceledCount: canceled,
      newThisMonth: newTm, growthDelta: newLm > 0 ? Math.round(((newTm - newLm) / newLm) * 100) : 0,
      signupArr: sa, signupSpark: sa.map(m => m.count), activeThisMonth: active,
      dormant: users.filter(u => USAGE_FIELDS.every(f => !(u.usage?.[f.key]))).length,
      powerUsers: power, avgUsage: users.length ? Math.round((tu / users.length) * 10) / 10 : 0,
      featureRank: fr, maxFeature: Math.max(...fr.map(f => f.value), 1),
      planSegments: [{ color: "#888", value: pc.free, label: "Free" }, { color: "#0070f3", value: pc.pro, label: "Pro" }, { color: "#f5a623", value: pc.premium, label: "Premium" }],
      providers: prov, conversionRate: users.length ? Math.round(((pc.pro + pc.premium) / users.length) * 100) : 0, totalUsage: tu,
    };
  }, [users]);

  const loadUsers = useCallback((force = false) => {
    if (!force && _usersCache && Date.now() - _cacheTime < CACHE_TTL) {
      setUsers(_usersCache!);
      return;
    }
    void Promise.resolve()
      .then(() => { setLoading(true); setLoadError(""); return fetch("/api/admin?action=users", { headers: token ? { "x-admin-token": token } : {}, cache: "no-store" }); })
      .then(async res => {
        const json = await res.json() as { users?: User[]; error?: string };
        if (res.status === 401 || json.error?.toLowerCase().includes("unauthori")) {
          throw new Error("__auth__");
        }
        if (!json.users) throw new Error(json.error ?? "No data");
        return json.users;
      })
      .then(users => { _usersCache = users; _cacheTime = Date.now(); setUsers(users); setLoading(false); })
      .catch((e: Error) => { setLoadError(e.message); setLoading(false); });
  }, [token]);

  useEffect(() => { loadUsers(); }, [loadUsers]);

  const saveUser = useCallback(async (editUser: User) => {
    setSaving(true); setMsg("");
    try {
      const { id, ...rest } = editUser;
      const res = await fetch("/api/admin", { method: "POST", headers: { "Content-Type": "application/json", ...(token ? { "x-admin-token": token } : {}) }, body: JSON.stringify({ id, data: rest }) });
      if (!res.ok) { const e = await res.json() as { error?: string }; throw new Error(e.error ?? `HTTP ${res.status}`); }
      setUsers(p => p.map(u => u.id === id ? { ...editUser } : u));
      setMsg("✓ Saved"); setTimeout(() => setMsg(""), 2500);
    } catch (e) { setMsg("✗ " + (e as Error).message); }
    setSaving(false);
  }, [token]);

  const noRefreshTabs = new Set(["email", "logs", "kanban", "access"]);

  return (
    <div className="min-h-screen flex bg-[#000]" style={{ fontFamily: "var(--font-geist-sans), -apple-system, sans-serif" }}>

      {/* Desktop Sidebar */}
      {!isMobile && (
        <aside className="w-55 bg-[#000] border-r border-[#111] flex flex-col shrink-0 h-screen sticky top-0">
          {/* Logo */}
          <div className="px-4 h-12 border-b border-[#111] flex items-center gap-2.5 shrink-0">
            <img src="/logo.png" alt="Preciprocal" className="w-6 h-6 shrink-0 object-contain" />
            <div className="text-[14px] font-semibold text-[#ededed] tracking-tight flex-1 min-w-0 truncate">Preciprocal</div>
            <span className="text-[10px] font-medium text-[#2a2a2a] bg-[#0f0f0f] border border-[#1a1a1a] px-1.5 py-0.5 rounded shrink-0">Admin</span>
          </div>

          {/* Nav */}
          <nav className="p-2 flex-1 overflow-y-auto">
            {NAV_GROUPS.map(({ g, ids }) => (
              <div key={g} className="mb-3">
                <div className="text-[10px] font-semibold text-[#333] uppercase tracking-[0.12em] px-2 py-1.5 mb-0.5 select-none">{g}</div>
                {NAV.filter(n => ids.includes(n.id)).map(n => (
                  <button
                    key={n.id}
                    onClick={() => setNav(n.id)}
                    className={`w-full flex items-center gap-2 px-2 h-[30px] rounded-md text-[13px] font-medium transition-colors duration-100 cursor-pointer border-none text-left mb-px ${
                      nav === n.id
                        ? "bg-[rgba(255,255,255,0.07)] text-[#ededed]"
                        : "bg-transparent text-[#555] hover:bg-[rgba(255,255,255,0.04)] hover:text-[#999]"
                    }`}
                    style={{ fontFamily: "inherit" }}
                  >
                    <span className={`shrink-0 transition-colors duration-100 ${nav === n.id ? "text-[#ededed]" : "text-[#3a3a3a]"}`}>{n.icon}</span>
                    <span className="truncate">{n.label}</span>
                    {n.id === "email" && emailUnread > 0 && (
                      <span className="ml-auto text-[10px] bg-[rgba(0,112,243,0.15)] text-[#0070f3] border border-[rgba(0,112,243,0.2)] px-1.5 py-0.5 rounded-full font-bold leading-none">{emailUnread}</span>
                    )}
                  </button>
                ))}
              </div>
            ))}
          </nav>

          {/* Footer */}
          <div className="px-3 py-3 border-t border-[#111] shrink-0">
            {analytics ? (
              <div className="bg-[#0a0a0a] border border-[#1a1a1a] rounded-lg px-3 py-2.5">
                <div className="text-[13px] font-bold text-[#3ecf8e] tabular-nums">
                  ${analytics.revenue.toFixed(0)}<span className="text-[11px] font-normal text-[#1e6644] ml-0.5">/mo</span>
                </div>
                <div className="text-[11px] text-[#444] mt-0.5">
                  {analytics.total} users · {analytics.planCounts.pro + analytics.planCounts.premium} paid
                </div>
              </div>
            ) : (
              <div className="skeleton h-12 rounded-lg" />
            )}
          </div>
        </aside>
      )}

      {/* Main content */}
      <div className={`flex-1 flex flex-col min-w-0 h-screen overflow-hidden ${isMobile ? "pb-14" : ""}`}>

        {/* Header */}
        <div className="bg-[#000] border-b border-[#111] px-4 md:px-5 h-12 flex items-center gap-2 shrink-0">
          <div className="flex-1 min-w-0">
            <div className="text-[14px] font-semibold text-[#ededed] tracking-tight">{NAV_TITLES[nav] ?? nav}</div>
          </div>

          {/* Code refs toggle */}
          {!isMobile && (
            <button
              onClick={() => setShowRefs(s => !s)}
              className={`inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md border text-[12px] font-medium cursor-pointer transition-colors duration-100 ${
                showRefs
                  ? "bg-[rgba(99,102,241,0.08)] border-[rgba(99,102,241,0.2)] text-[#818cf8]"
                  : "bg-transparent border-[#1a1a1a] text-[#444] hover:border-[#2a2a2a] hover:text-[#777]"
              }`}
            >
              <svg width="10" height="10" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>
              Code Refs
            </button>
          )}

          {/* Refresh */}
          {!noRefreshTabs.has(nav) && (
            <button
              onClick={() => { _usersCache = null; void loadUsers(true); }}
              disabled={loading}
              className="inline-flex items-center justify-center gap-1.5 h-7 w-7 rounded-md border border-[#1a1a1a] bg-transparent text-[#444] cursor-pointer hover:border-[#2a2a2a] hover:text-[#777] disabled:opacity-25 transition-colors duration-100"
              title={loading ? "Loading…" : "Refresh"}
            >
              <svg width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" style={{ animation: loading ? "spin .8s linear infinite" : "none" }}>
                <path d="M23 4v6h-6M1 20v-6h6M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/>
              </svg>
            </button>
          )}

          {/* Supabase project badge */}
          <span className="hidden md:inline-flex items-center text-[11px] bg-[rgba(62,207,142,0.05)] text-[#2a8c5a] border border-[rgba(62,207,142,0.12)] px-2 py-1 rounded-md font-medium shrink-0 gap-1.5" title="Supabase project">
            <span className="w-1.5 h-1.5 rounded-full bg-[#3ecf8e] shrink-0" />
            {SUPABASE_PROJECT}
          </span>

          {/* Theme toggle */}
          <button
            onClick={() => setTheme(t => t === "dark" ? "light" : "dark")}
            title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
            className="inline-flex items-center justify-center h-7 w-7 rounded-md border border-[#1a1a1a] bg-transparent text-[#444] cursor-pointer hover:border-[#2a2a2a] hover:text-[#777] transition-colors duration-100 shrink-0"
          >
            {theme === "dark" ? (
              <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>
              </svg>
            ) : (
              <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
              </svg>
            )}
          </button>

          {/* Logout */}
          <button
            onClick={() => { sessionStorage.removeItem("admin_token"); onLogout?.(); }}
            className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md border border-[#1a1a1a] bg-transparent text-[12px] font-medium text-[#444] cursor-pointer hover:border-[rgba(255,68,68,0.25)] hover:text-[#cc3333] transition-colors duration-100 shrink-0"
          >
            <svg width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>
            </svg>
            {!isMobile && "Logout"}
          </button>
        </div>

        {/* Code references panel */}
        {showRefs && !isMobile && (
          <div className="bg-[#050505] border-b border-[#1a1a1a] px-6 py-3 shrink-0">
            <div className="text-[11px] font-medium text-[#333] uppercase tracking-widest mb-2">Codebase References</div>
            <div className="grid gap-1.5" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))" }}>
              {Object.entries(CODE_REFS).map(([k, v]) => (
                <div key={k} title={v.desc} className="flex gap-2 rounded-md px-2.5 py-1.5 border border-[#1a1a1a] bg-[#0a0a0a] cursor-help">
                  <svg width="9" height="9" fill="none" stroke="#818cf8" strokeWidth="2" viewBox="0 0 24 24" className="mt-0.5 shrink-0"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>
                  <div>
                    <div className="font-mono text-[11px] text-[#818cf8] mb-0.5">{v.file}</div>
                    <div className="text-[11px] text-[#444]">{v.desc}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Error banner */}
        {loadError && (
          loadError === "__auth__" ? (
            <div className="shrink-0 mx-4 my-2 px-4 py-3 bg-[rgba(245,166,35,0.06)] border border-[rgba(245,166,35,0.2)] rounded-xl flex items-center gap-3">
              <svg width="14" height="14" fill="none" stroke="#f5a623" strokeWidth="2" viewBox="0 0 24 24" className="shrink-0">
                <rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>
              </svg>
              <div className="flex-1 min-w-0">
                <span className="text-sm font-semibold text-[#f5a623]">Session expired — </span>
                <span className="text-sm text-[#f5a623]/70">your admin token is no longer valid</span>
              </div>
              <button
                onClick={() => { sessionStorage.removeItem("admin_token"); onLogout?.(); }}
                className="shrink-0 text-xs font-semibold text-[#f5a623] border border-[rgba(245,166,35,0.3)] bg-transparent rounded-md px-3 py-1.5 cursor-pointer hover:bg-[rgba(245,166,35,0.06)] transition-colors"
              >
                Re-login
              </button>
            </div>
          ) : (
            <div className="shrink-0 mx-4 my-2 px-4 py-3 bg-[rgba(255,68,68,0.06)] border border-[rgba(255,68,68,0.2)] rounded-xl flex items-center gap-3">
              <svg width="14" height="14" fill="none" stroke="#f44" strokeWidth="2" viewBox="0 0 24 24" className="shrink-0">
                <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
              </svg>
              <div className="flex-1 min-w-0">
                <span className="text-sm font-semibold text-[#f44]">Failed to load: </span>
                <span className="text-sm text-[#f44]/70">{loadError}</span>
              </div>
              <button
                onClick={() => { _usersCache = null; void loadUsers(true); }}
                className="shrink-0 text-xs font-medium text-[#f44] border border-[rgba(255,68,68,0.3)] bg-transparent rounded-md px-2.5 py-1 cursor-pointer hover:bg-[rgba(255,68,68,0.06)]"
              >
                Retry
              </button>
            </div>
          )
        )}

        {/* Tab content */}
        <AdminTokenContext.Provider value={token}>
          <div className="flex-1 flex overflow-hidden bg-[#000]">
            {nav === "overview"  && <OverviewTab  analytics={analytics} users={users} loading={loading} token={token} />}
            {nav === "users"     && <UsersTab users={users} filtered={filtered} loading={loading} analytics={analytics} search={search} setSearch={setSearch} planF={planF} setPlanF={setPlanF} sortF={sortF} setSortF={setSortF} sortD={sortD} setSortD={setSortD} saveUser={saveUser} saving={saving} msg={msg} token={token} />}
            {nav === "analytics" && <AnalyticsTab users={users} loading={loading} token={token} theme={theme} />}
            {nav === "logs"      && <LogsTab      users={users} token={token} />}
            {nav === "email"     && <EmailTab onUnreadChange={setEmailUnread} />}
            {nav === "kanban"    && <KanbanTab token={token} currentUser={me ? { uid: me.uid, name: me.name, email: me.email } : undefined} />}
            {nav === "usage"     && <UsageTab    token={token} />}
            {nav === "support"   && <SupportTab  token={token} />}
            {nav === "access"    && <AccessTab   token={token} />}
          </div>
        </AdminTokenContext.Provider>
      </div>

      {/* Mobile bottom nav */}
      {isMobile && (
        // 9 tabs don't fit at phone widths: fixed-width items that scroll sideways
        <nav className="fixed bottom-0 left-0 right-0 z-50 bg-[#000] border-t border-[#1a1a1a] h-14 flex items-stretch overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {NAV.map(n => (
            <button
              key={n.id}
              onClick={() => setNav(n.id)}
              ref={el => { if (el && nav === n.id) el.scrollIntoView({ block: "nearest", inline: "nearest" }); }}
              className={`flex-1 min-w-16 shrink-0 flex flex-col items-center justify-center gap-0.5 border-none cursor-pointer transition-colors ${nav === n.id ? "text-[#ededed]" : "text-[#444]"}`}
              style={{ background: nav === n.id ? "rgba(255,255,255,0.04)" : "transparent", fontFamily: "inherit" }}
            >
              {n.icon}
              <span className="text-[11px] font-medium whitespace-nowrap">{n.label}</span>
            </button>
          ))}
        </nav>
      )}

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
