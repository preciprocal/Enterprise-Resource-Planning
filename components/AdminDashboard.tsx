"use client";

import { useState, useCallback, useMemo, useEffect } from "react";

let _usersCache: import("./admin/admin-shared").User[] | null = null;
let _cacheTime = 0;
const CACHE_TTL = 60_000;

import {
  LayoutGrid, Users, Activity, Globe, Puzzle, ScrollText, Mail, KanbanSquare, BarChart3, LifeBuoy, Lock,
  ChevronRight, Code2, RefreshCw, Sun, Moon, LogOut, AlertCircle, type LucideIcon,
} from "lucide-react";
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
import MarketingTab from "./admin/MarketingTab";
import ExtensionTab from "./admin/ExtensionTab";

const SUPABASE_PROJECT = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").replace(/^https?:\/\//, "").split(".")[0] || "supabase";

const NAV: { id: string; label: string; icon: LucideIcon }[] = [
  { id: "overview",  label: "Overview",  icon: LayoutGrid },
  { id: "users",     label: "Users",     icon: Users },
  { id: "analytics", label: "Analytics", icon: Activity },
  { id: "marketing", label: "Marketing", icon: Globe },
  { id: "extension", label: "Extension", icon: Puzzle },
  { id: "logs",      label: "Logs",      icon: ScrollText },
  { id: "email",     label: "Email",     icon: Mail },
  { id: "kanban",    label: "Tasks",     icon: KanbanSquare },
  { id: "usage",     label: "Usage",     icon: BarChart3 },
  { id: "support",   label: "Support",   icon: LifeBuoy },
  { id: "access",    label: "Access",    icon: Lock },
];

const NAV_GROUPS = [
  { g: "Dashboard", ids: ["overview", "users"] },
  { g: "Billing",   ids: ["analytics"] },
  { g: "Growth",    ids: ["marketing", "extension"] },
  { g: "Tools",     ids: ["logs", "email", "kanban", "usage", "support"] },
  { g: "Settings",  ids: ["access"] },
];

const NAV_TITLES: Record<string, string> = {
  overview: "Overview", users: "Users",
  analytics: "Analytics", logs: "Activity Logs", email: "Inbox", kanban: "Tasks", usage: "API Usage", support: "Support", access: "ERP Access", marketing: "Marketing", extension: "Extension",
};

// One line beside the page title, so every page says what it is for.
const NAV_DESCRIPTIONS: Record<string, string> = {
  overview:  "Revenue, signups and activity at a glance",
  users:     "Every account, its plan, usage and history",
  analytics: "Billing, revenue, retention and churn",
  marketing: "Visitors and conversions on preciprocal.com",
  extension: "Chrome extension installs and activity",
  logs:      "Sign-ins, feature use and ERP actions",
  email:     "Shared inbox and outgoing email",
  kanban:    "Team tasks, meetings and the calendar",
  usage:     "API spend and what is left per provider",
  support:   "Tickets from users and their replies",
  access:    "Who can sign in to the ERP",
};

const groupOf = (id: string) => NAV_GROUPS.find(g => g.ids.includes(id))?.g ?? "";

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
      planSegments: [{ color: "#9aa3b2", value: pc.free, label: "Free" }, { color: "#5b6cff", value: pc.pro, label: "Pro" }, { color: "#f59e0b", value: pc.premium, label: "Premium" }],
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
      const { id } = editUser;
      // Only what was actually changed. The cached copy can be a minute old,
      // and sending all of it rolled back anything that happened since: a
      // webhook marking the plan past_due, or usage the person had consumed.
      const orig = users.find(u => u.id === id);
      const data: Record<string, unknown> = {};
      for (const k of ["name", "email", "provider", "isAdmin"] as const) {
        if (editUser[k] !== orig?.[k]) data[k] = editUser[k];
      }
      const sub: Record<string, unknown> = {};
      for (const k of ["plan", "status", "studentVerified"] as const) {
        const next = (editUser.subscription as Record<string, unknown> | undefined)?.[k];
        if (next !== (orig?.subscription as Record<string, unknown> | undefined)?.[k]) sub[k] = next;
      }
      if (Object.keys(sub).length) data.subscription = sub;
      const usage: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(editUser.usage ?? {})) {
        if (v !== (orig?.usage as Record<string, unknown> | undefined)?.[k]) usage[k] = v;
      }
      if (Object.keys(usage).length) data.usage = usage;
      if (!Object.keys(data).length) { setMsg("No changes"); setTimeout(() => setMsg(""), 2000); setSaving(false); return; }
      const res = await fetch("/api/admin", { method: "POST", headers: { "Content-Type": "application/json", ...(token ? { "x-admin-token": token } : {}) }, body: JSON.stringify({ id, data }) });
      if (!res.ok) { const e = await res.json() as { error?: string }; throw new Error(e.error ?? `HTTP ${res.status}`); }
      setUsers(p => p.map(u => u.id === id ? { ...editUser } : u));
      setMsg("✓ Saved"); setTimeout(() => setMsg(""), 2500);
    } catch (e) { setMsg("✗ " + (e as Error).message); }
    setSaving(false);
  }, [token, users]);

  const noRefreshTabs = new Set(["email", "logs", "kanban", "access", "marketing", "extension"]);
  const logout = () => { sessionStorage.removeItem("admin_token"); onLogout?.(); };
  const paid = analytics ? analytics.planCounts.pro + analytics.planCounts.premium : 0;

  return (
    <div className="min-h-screen flex bg-canvas text-fg">

      {/* ── Sidebar ── */}
      {!isMobile && (
        <aside className="w-60 bg-sidebar-bg border-r border-line-soft flex flex-col shrink-0 h-screen sticky top-0">
          <div className="px-4 h-14 flex items-center gap-2.5 shrink-0">
            <img src="/logo.png" alt="" className="w-7 h-7 shrink-0 object-contain rounded-[8px]" />
            <div className="text-[15px] font-bold text-fg tracking-tight flex-1 min-w-0 truncate">Preciprocal</div>
            <span className="badge badge-brand h-[18px]! px-1.5! text-[10px]! uppercase tracking-wider">ERP</span>
          </div>

          {me && (
            <div className="mx-3 mb-1 px-2.5 py-2 rounded-lg flex items-center gap-2.5 bg-hover border border-line-soft">
              <div className="relative shrink-0">
                <div className="w-7 h-7 rounded-full bg-brand-soft text-brand-fg text-[11px] font-semibold flex items-center justify-center">
                  {(me.name || me.email || "?").split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase()}
                </div>
                <span className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-success border-2 border-sidebar-bg" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-[12px] font-semibold text-fg truncate">{me.name || "Admin"}</div>
                <div className="text-[11px] text-fg-4 truncate" title={me.email}>{me.email}</div>
              </div>
            </div>
          )}

          <nav className="px-3 pb-3 flex-1 overflow-y-auto scrollbar-hide" aria-label="ERP sections">
            {NAV_GROUPS.map(({ g, ids }) => (
              <div key={g} className="pt-4">
                <div className="px-2.5 pb-1.5 text-[10px] font-semibold text-fg-5 uppercase tracking-[0.16em] select-none">{g}</div>
                {NAV.filter(n => ids.includes(n.id)).map(n => {
                  const active = nav === n.id;
                  const Icon = n.icon;
                  return (
                    <button
                      key={n.id}
                      onClick={() => setNav(n.id)}
                      aria-current={active ? "page" : undefined}
                      className={`group relative w-full flex items-center gap-2.5 px-2.5 h-8 rounded-lg text-[13px] font-medium transition-colors duration-150 border-0 text-left mb-px font-[inherit] ${
                        active ? "bg-active text-fg" : "bg-transparent text-fg-3 hover:bg-hover hover:text-fg"
                      }`}
                    >
                      {active && <span className="absolute left-0 top-1/2 -translate-y-1/2 h-4 w-[3px] rounded-r-full bg-brand" aria-hidden="true" />}
                      <Icon className={`w-4 h-4 shrink-0 ${active ? "text-brand-fg" : "text-fg-4 group-hover:text-fg-3"}`} strokeWidth={1.75} />
                      <span className="truncate">{n.label}</span>
                      {n.id === "email" && emailUnread > 0 && (
                        <span className="ml-auto badge badge-brand h-[18px]! px-1.5! num">{emailUnread}</span>
                      )}
                    </button>
                  );
                })}
              </div>
            ))}
          </nav>

          <div className="p-3 border-t border-line-soft shrink-0">
            {analytics ? (
              <div className="rounded-lg px-3 py-2.5 bg-subtle border border-line-soft">
                <div className="label">Monthly revenue</div>
                <div className="flex items-baseline gap-1 mt-1">
                  <span className="text-[17px] font-semibold text-fg num tracking-tight">${analytics.revenue.toFixed(0)}</span>
                  <span className="text-[11px] text-fg-4">/mo</span>
                </div>
                <div className="text-[11px] text-fg-4 mt-0.5 num">{analytics.total} users · <span className="text-success-fg">{paid} paid</span></div>
              </div>
            ) : (
              <div className="skeleton h-[74px] rounded-lg" />
            )}
          </div>
        </aside>
      )}

      {/* ── Main ── */}
      <div className={`flex-1 flex flex-col min-w-0 h-screen overflow-hidden ${isMobile ? "pb-16" : ""}`}>

        <header className="bg-canvas border-b border-line-soft px-4 md:px-6 h-14 flex items-center gap-2 shrink-0">
          {isMobile && <img src="/logo.png" alt="" className="w-6 h-6 shrink-0 object-contain rounded-md mr-1" />}
          <div className="flex-1 min-w-0 flex items-center gap-2">
            {!isMobile && (
              <>
                <span className="text-[13px] text-fg-4 shrink-0">{groupOf(nav)}</span>
                <ChevronRight className="w-3.5 h-3.5 text-fg-5 shrink-0" aria-hidden="true" />
              </>
            )}
            <h1 className="text-[14px] font-semibold text-fg tracking-tight truncate">{NAV_TITLES[nav] ?? nav}</h1>
            {!isMobile && NAV_DESCRIPTIONS[nav] && (
              <span className="hidden lg:inline text-[13px] text-fg-4 truncate pl-2 ml-1 border-l border-line">{NAV_DESCRIPTIONS[nav]}</span>
            )}
          </div>

          {!isMobile && (
            <button onClick={() => setShowRefs(s => !s)} className={`btn btn-sm btn-secondary ${showRefs ? "btn-on" : ""}`}>
              <Code2 className="w-3.5 h-3.5" /> Code refs
            </button>
          )}

          {!noRefreshTabs.has(nav) && (
            <button onClick={() => { _usersCache = null; void loadUsers(true); }} disabled={loading}
              className="btn btn-sm btn-secondary btn-icon" title={loading ? "Loading…" : "Refresh"} aria-label="Refresh">
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
            </button>
          )}

          <span className="hidden md:inline-flex badge badge-success h-7! px-2.5! rounded-lg! font-medium!" title="Supabase project">
            <span className="dot bg-success" />{SUPABASE_PROJECT}
          </span>

          <button onClick={() => setTheme(t => t === "dark" ? "light" : "dark")}
            title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"} aria-label="Toggle theme"
            className="btn btn-sm btn-secondary btn-icon">
            {theme === "dark" ? <Sun className="w-3.5 h-3.5" /> : <Moon className="w-3.5 h-3.5" />}
          </button>

          <button onClick={logout} className="btn btn-sm btn-secondary hover:text-danger-fg! hover:border-danger-line!" aria-label="Log out">
            <LogOut className="w-3.5 h-3.5" />{!isMobile && "Log out"}
          </button>
        </header>

        {/* Code references */}
        {showRefs && !isMobile && (
          <div className="bg-subtle border-b border-line-soft px-6 py-3 shrink-0">
            <div className="label mb-2">Codebase references</div>
            <div className="grid gap-1.5" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))" }}>
              {Object.entries(CODE_REFS).map(([k, v]) => (
                <div key={k} title={v.desc} className="flex gap-2 rounded-lg px-2.5 py-1.5 border border-line-soft bg-surface cursor-help">
                  <Code2 className="w-3 h-3 mt-0.5 shrink-0 text-brand-fg" />
                  <div className="min-w-0">
                    <div className="font-mono text-[11px] text-brand-fg mb-0.5 truncate">{v.file}</div>
                    <div className="text-[11px] text-fg-4">{v.desc}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Load error */}
        {loadError && (
          loadError === "__auth__" ? (
            <div className="shrink-0 mx-4 md:mx-6 mt-3 px-4 py-3 bg-warning-soft border border-warning-line rounded-xl flex items-center gap-3">
              <Lock className="w-4 h-4 text-warning-fg shrink-0" />
              <div className="flex-1 min-w-0 text-[13px] text-warning-fg">
                <span className="font-semibold">Session expired.</span> Your admin sign-in is no longer valid.
              </div>
              <button onClick={logout} className="btn btn-sm btn-secondary">Sign in again</button>
            </div>
          ) : (
            <div className="shrink-0 mx-4 md:mx-6 mt-3 px-4 py-3 bg-danger-soft border border-danger-line rounded-xl flex items-center gap-3">
              <AlertCircle className="w-4 h-4 text-danger-fg shrink-0" />
              <div className="flex-1 min-w-0 text-[13px] text-danger-fg">
                <span className="font-semibold">Couldn&apos;t load users:</span> {loadError}
              </div>
              <button onClick={() => { _usersCache = null; void loadUsers(true); }} className="btn btn-sm btn-secondary">Retry</button>
            </div>
          )
        )}

        <AdminTokenContext.Provider value={token}>
          <main className="flex-1 flex overflow-hidden bg-canvas">
            {nav === "overview"  && <OverviewTab  analytics={analytics} users={users} loading={loading} token={token} />}
            {nav === "users"     && <UsersTab users={users} filtered={filtered} loading={loading} analytics={analytics} search={search} setSearch={setSearch} planF={planF} setPlanF={setPlanF} sortF={sortF} setSortF={setSortF} sortD={sortD} setSortD={setSortD} saveUser={saveUser} saving={saving} msg={msg} token={token} />}
            {nav === "analytics" && <AnalyticsTab users={users} loading={loading} token={token} theme={theme} />}
            {nav === "logs"      && <LogsTab      users={users} token={token} />}
            {nav === "email"     && <EmailTab onUnreadChange={setEmailUnread} />}
            {nav === "kanban"    && <KanbanTab token={token} currentUser={me ? { uid: me.uid, name: me.name, email: me.email } : undefined} />}
            {nav === "usage"     && <UsageTab    token={token} />}
            {nav === "support"   && <SupportTab  token={token} />}
            {nav === "access"    && <AccessTab   token={token} />}
            {nav === "marketing" && <MarketingTab token={token} />}
            {nav === "extension" && <ExtensionTab token={token} />}
          </main>
        </AdminTokenContext.Provider>
      </div>

      {/* Mobile bottom nav: 11 tabs don't fit, so fixed-width items scroll sideways */}
      {isMobile && (
        <nav className="fixed bottom-0 left-0 right-0 z-50 bg-sidebar-bg border-t border-line h-16 flex items-stretch overflow-x-auto scrollbar-hide" aria-label="ERP sections">
          {NAV.map(n => {
            const active = nav === n.id;
            const Icon = n.icon;
            return (
              <button
                key={n.id}
                onClick={() => setNav(n.id)}
                ref={el => { if (el && active) el.scrollIntoView({ block: "nearest", inline: "nearest" }); }}
                className={`relative flex-1 min-w-[68px] shrink-0 flex flex-col items-center justify-center gap-1 border-0 bg-transparent font-[inherit] transition-colors ${active ? "text-fg" : "text-fg-4"}`}
              >
                {active && <span className="absolute top-0 left-1/2 -translate-x-1/2 w-6 h-[2px] rounded-b-full bg-brand" />}
                <Icon className={`w-[18px] h-[18px] ${active ? "text-brand-fg" : ""}`} strokeWidth={1.75} />
                <span className="text-[11px] font-medium whitespace-nowrap">{n.label}</span>
              </button>
            );
          })}
        </nav>
      )}
    </div>
  );
}
