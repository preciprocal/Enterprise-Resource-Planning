// components/admin/LogsTab.tsx
"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { User, USAGE_FIELDS, Avatar, Card, CardTitle, SL, Spinner, LineChart, BarChart, Donut, useIsMobile, Select, tint } from "./admin-shared";

// Map derived action keys → display label + color (matches USAGE_FIELDS colors)
const FEATURE_ACTIONS: Record<string, { label: string; color: string }> = {
  resume_analyse:  { label: "Resume",        color: "#5b6cff" },
  cover_letter:    { label: "Cover Letter",  color: "#10b981" },
  interview_start: { label: "Interview",     color: "#f59e0b" },
  study_plan:      { label: "Study Plan",    color: "#a855f7" },
  debrief:         { label: "Debrief",       color: "#ec4899" },
  linkedin_opt:    { label: "LinkedIn",      color: "#0ea5e9" },
  cold_outreach:   { label: "Cold Outreach", color: "#ef4444"    },
  find_contacts:   { label: "Contacts",      color: "#06b6d4" },
  job_tracker:     { label: "Job Tracker",   color: "var(--fg-3)"    },
};

// ─── Types ────────────────────────────────────────────────────────────────────

export interface LogEntry {
  id: string;
  userId:     string;
  userName?:  string;
  userEmail?: string;
  type:       "login" | "signup" | "action" | "logout" | "error" | "pageview";
  timestamp:  string;
  ip?:        string;
  city?:      string;
  country?:   string;
  countryCode?: string;
  device?:    "desktop" | "mobile" | "tablet" | string;
  browser?:   string;
  os?:        string;
  userAgent?: string;
  action?:    string;
  path?:      string;
  details?:   Record<string, unknown>;
  app?:       LogApp;
}

type LogApp = "erp" | "dashboard";
type FilterApp = "all" | LogApp;
type FilterType = "all" | "login" | "signup" | "action" | "logout" | "error";
type FilterDevice = "all" | "desktop" | "mobile" | "tablet";
type TimeRange = "1h" | "24h" | "7d" | "30d" | "all";

interface Props { users: User[]; token?: string; }

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtRelative(iso: string, now: number) {
  const diff = now - new Date(iso).getTime();
  if (diff < 60_000)    return "just now";
  if (diff < 3_600_000)  return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  if (diff < 7 * 86_400_000) return `${Math.floor(diff / 86_400_000)}d ago`;
  return new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
}

function fmtFull(iso: string) {
  return new Date(iso).toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function deviceIcon(device?: string) {
  if (device === "mobile")  return <svg width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><rect x="7" y="2" width="10" height="20" rx="2"/><line x1="12" y1="18" x2="12.01" y2="18"/></svg>;
  if (device === "tablet")  return <svg width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><rect x="4" y="2" width="16" height="20" rx="2"/><line x1="12" y1="18" x2="12.01" y2="18"/></svg>;
  return <svg width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><rect x="2" y="3" width="20" height="14" rx="2"/><polyline points="8 21 12 17 16 21"/></svg>;
}

function typeBadge(type: LogEntry["type"]) {
  const map: Record<string, { label: string; cls: string }> = {
    login:    { label: "Login",   cls: "badge-brand"   },
    signup:   { label: "Signup",  cls: "badge-success" },
    action:   { label: "Action",  cls: "badge-brand"   },
    logout:   { label: "Logout",  cls: "badge-neutral" },
    error:    { label: "Error",   cls: "badge-danger"  },
    pageview: { label: "Page",    cls: "badge-neutral" },
  };
  const { label, cls } = map[type] ?? { label: type, cls: "badge-neutral" };
  return (
    <span className={`badge ${cls} shrink-0`}>
      {label}
    </span>
  );
}

// Which product the event happened in. Older rows without `app` are Dashboard.
const APPS: Record<LogApp, { label: string; dot: string }> = {
  dashboard: { label: "Dashboard", dot: "#06b6d4" },
  erp:       { label: "ERP",       dot: "#a855f7" },
};

function appBadge(app: LogApp = "dashboard") {
  const { label, dot } = APPS[app];
  return (
    <span title={app === "erp" ? "Signed in to the admin ERP" : "Signed in to the Preciprocal app"}
      className="badge badge-neutral shrink-0">
      <span className="dot" style={{ background: dot }} />
      {label}
    </span>
  );
}

function actionBadge(action: string) {
  const meta = FEATURE_ACTIONS[action];
  if (!meta) {
    // Subscription events
    if (action.startsWith("subscribed_")) {
      const plan = action.replace("subscribed_", "");
      return (
        <span className="badge badge-success">
          Subscribed · {plan}
        </span>
      );
    }
    return <span className="text-[11px] text-fg-4 font-mono">{action.replace(/_/g, " ")}</span>;
  }
  const bg = tint(meta.color, "12"), border = tint(meta.color, "40");
  return (
    <span className="badge" style={{ color: meta.color, background: bg, borderColor: border }}>
      {meta.label}
    </span>
  );
}

function countryFlag(code?: string) {
  if (!code || code.length !== 2) return "🌐";
  return String.fromCodePoint(...[...code.toUpperCase()].map(c => 0x1F1E6 + c.charCodeAt(0) - 65));
}

function providerToBrowser(provider?: string): string {
  if (provider === "google")   return "Chrome";
  if (provider === "facebook") return "Facebook App";
  if (provider === "apple")    return "Safari";
  if (provider === "github")   return "Chrome";
  return "Browser";
}

function deriveLogsFromUsers(users: User[]): LogEntry[] {
  const entries: LogEntry[] = [];
  users.forEach(u => {
    if (u.createdAt) {
      entries.push({
        id: `signup_${u.id}`, userId: u.id,
        userName: u.name, userEmail: u.email,
        type: "signup", timestamp: u.createdAt,
        device: "desktop",
        browser: providerToBrowser(u.provider),
        os: "Unknown",
        details: { provider: u.provider ?? "email" },
      });
    }

    const loginTs = u.lastLogin ?? u.updatedAt ?? u.createdAt;
    if (loginTs) {
      entries.push({
        id: `login_${u.id}`, userId: u.id,
        userName: u.name, userEmail: u.email,
        type: "login", timestamp: loginTs,
        device: "desktop",
        browser: providerToBrowser(u.provider),
        os: "Unknown",
        details: { provider: u.provider ?? "email" },
      });
    }

    if (u.usage) {
      const fields = [
        ["resumesUsed",               "resume_analyse"  ],
        ["coverLettersUsed",          "cover_letter"    ],
        ["interviewsUsed",            "interview_start" ],
        ["studyPlansUsed",            "study_plan"      ],
        ["interviewDebriefsUsed",     "debrief"         ],
        ["linkedinOptimisationsUsed", "linkedin_opt"    ],
        ["coldOutreachUsed",          "cold_outreach"   ],
        ["findContactsUsed",          "find_contacts"   ],
        ["jobTrackerUsed",            "job_tracker"     ],
      ] as const;
      const refTs = u.lastLogin ?? u.updatedAt ?? u.createdAt;
      fields.forEach(([key, action]) => {
        const count = (u.usage?.[key] as number) ?? 0;
        if (count > 0 && refTs) {
          entries.push({
            id: `action_${u.id}_${action}`,
            userId: u.id, userName: u.name, userEmail: u.email,
            type: "action", timestamp: refTs,
            browser: providerToBrowser(u.provider),
            device: "desktop",
            action, details: { count },
          });
        }
      });
    }

    const plan = u.subscription?.plan;
    if (plan && plan !== "free" && u.subscription?.currentPeriodStart) {
      entries.push({
        id: `sub_${u.id}`,
        userId: u.id, userName: u.name, userEmail: u.email,
        type: "action", timestamp: u.subscription.currentPeriodStart,
        browser: providerToBrowser(u.provider),
        device: "desktop",
        action: `subscribed_${plan}`,
        details: { plan, status: u.subscription.status },
      });
    }
  });
  return entries
    .map(e => ({ ...e, app: "dashboard" as const }))
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
}

// ─── Stat Card ────────────────────────────────────────────────────────────────

function StatCard({ label, value, sub, color, icon }: { label: string; value: string | number; sub?: string; color: string; icon: React.ReactNode }) {
  return (
    <div className="card px-4 py-3.5 flex flex-col gap-1 min-w-0">
      <div className="flex items-center justify-between gap-2">
        <div className="label truncate">{label}</div>
        <span className="shrink-0 [&>svg]:w-3.5 [&>svg]:h-3.5" style={{ color }}>{icon}</span>
      </div>
      <div className="text-[24px] font-semibold leading-none tracking-tight mt-1.5 num truncate" style={{ color }}>{value}</div>
      {sub && <div className="text-caption mt-1 truncate">{sub}</div>}
    </div>
  );
}

// ─── Log Row ──────────────────────────────────────────────────────────────────

type ActivityEntry = { feats: { key: string; label: string; color: string; count: number }[]; total: number };

function LogRow({ log, isMobile, onClick, selected, now, activityMap }: {
  log: LogEntry; isMobile: boolean; onClick: () => void; selected: boolean; now: number;
  activityMap: Record<string, ActivityEntry>;
}) {
  const activity = activityMap[log.userId];
  return (
    <button
      onClick={onClick}
      className={`w-full text-left px-4 py-3 border-b border-line-soft last:border-b-0 cursor-pointer transition-colors ${selected ? "bg-active" : "hover:bg-hover"}`}
      style={{ borderLeft: selected ? "2px solid var(--brand)" : "2px solid transparent" }}>
      <div className="flex items-start gap-3">
        <Avatar name={log.userName ?? log.userEmail ?? "?"} size={28} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-0.5">
            <span className="text-[13px] font-semibold text-fg truncate max-w-[140px]">
              {log.userName ?? log.userEmail?.split("@")[0] ?? "Unknown"}
            </span>
            {typeBadge(log.type)}
            {appBadge(log.app)}
            {log.action && actionBadge(log.action)}
            {log.type === "action" && typeof log.details?.count === "number" && log.details.count > 1 && (
              <span className="text-[11px] text-fg-4">×{log.details.count}</span>
            )}
          </div>
          <div className="flex items-center gap-2.5 flex-wrap">
            <span className="text-[12px] text-fg-3">{log.userEmail ?? log.userId.slice(0, 12)}</span>
            {!isMobile && log.city && (
              <span className="text-[12px] text-fg-4 flex items-center gap-1">
                <span>{countryFlag(log.countryCode)}</span>
                <span>{log.city}, {log.country}</span>
              </span>
            )}
            {!isMobile && log.device && (
              <span className="text-[12px] text-fg-4 flex items-center gap-1">
                <span className="text-fg-5">{deviceIcon(log.device)}</span>
                <span className="capitalize">{log.browser ?? log.device}</span>
              </span>
            )}
            {log.ip && !isMobile && (
              <span className="text-[11px] font-mono text-fg-5">{log.ip}</span>
            )}
          </div>
          {activity && !isMobile && (
            <div className="flex items-center gap-1 mt-1.5 flex-wrap">
              {activity.feats.slice(0, 4).map(f => (
                <span key={f.key}
                  className="badge"
                  style={{ color: f.color, background: tint(f.color, "12"), borderColor: tint(f.color, "33") }}>
                  {f.label} {f.count}
                </span>
              ))}
              {activity.feats.length > 4 && (
                <span className="text-[11px] text-fg-5">+{activity.feats.length - 4} more</span>
              )}
            </div>
          )}
        </div>
        <div className="shrink-0 text-right">
          <div className="text-[12px] text-fg-4 whitespace-nowrap">{fmtRelative(log.timestamp, now)}</div>
          {!isMobile && (
            <div className="text-[11px] text-fg-5 mt-0.5 whitespace-nowrap">{new Date(log.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</div>
          )}
          {activity && !isMobile && (
            <div className="text-[11px] font-semibold text-success-fg mt-1 num">{activity.total} uses</div>
          )}
        </div>
      </div>
    </button>
  );
}

// ─── Detail Panel ─────────────────────────────────────────────────────────────

function DetailPanel({ log, onClose }: { log: LogEntry; onClose: () => void }) {
  return (
    <div className="w-72 shrink-0 border-l border-line bg-surface flex flex-col overflow-hidden">
      <div className="card-header">
        <span className="section-title">Event Detail</span>
        <button onClick={onClose} aria-label="Close" className="btn btn-ghost btn-sm btn-icon">
          <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* User */}
        <div className="flex items-center gap-3 p-3 bg-subtle border border-line-soft rounded-lg">
          <Avatar name={log.userName ?? log.userEmail ?? "?"} size={36} />
          <div className="min-w-0">
            <div className="text-[14px] font-semibold text-fg truncate">{log.userName ?? "Unknown"}</div>
            <div className="text-[12px] text-fg-3 truncate">{log.userEmail ?? log.userId}</div>
          </div>
        </div>

        {/* Event */}
        <div>
          <div className="label mb-2">Event</div>
          <div className="space-y-2">
            {[
              ["Type",    typeBadge(log.type)],
              ["App",     appBadge(log.app)],
              ["Time",    <span key="t" className="text-[13px] text-fg">{fmtFull(log.timestamp)}</span>],
              ["User ID", <span key="u" className="font-mono text-[12px] text-brand-fg">{log.userId.slice(0,16)}…</span>],
              log.action ? ["Action", <span key="a" className="text-[13px] text-fg font-mono">{log.action}</span>] : null,
              log.path   ? ["Path",   <span key="p" className="text-[13px] text-fg font-mono">{log.path}</span>]   : null,
            ].filter(Boolean).map((row, i) => (
              <div key={i} className="flex items-start justify-between gap-2">
                <span className="text-[11px] font-semibold text-fg-4 shrink-0 mt-0.5">{(row as [string, React.ReactNode])[0]}</span>
                <span className="text-right">{(row as [string, React.ReactNode])[1]}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Location */}
        {(log.ip || log.city || log.country) && (
          <div>
            <div className="label mb-2">Location</div>
            <div className="space-y-2">
              {log.ip      && <div className="flex justify-between"><span className="text-[11px] text-fg-4 font-semibold">IP</span><span className="font-mono text-[12px] text-fg">{log.ip}</span></div>}
              {log.city    && <div className="flex justify-between"><span className="text-[11px] text-fg-4 font-semibold">City</span><span className="text-[13px] text-fg">{log.city}</span></div>}
              {log.country && <div className="flex justify-between"><span className="text-[11px] text-fg-4 font-semibold">Country</span><span className="text-[13px] text-fg">{countryFlag(log.countryCode)} {log.country}</span></div>}
            </div>
          </div>
        )}

        {/* Device */}
        {(log.device || log.browser || log.os) && (
          <div>
            <div className="label mb-2">Device</div>
            <div className="space-y-2">
              {log.device  && <div className="flex justify-between"><span className="text-[11px] text-fg-4 font-semibold">Type</span><span className="text-[13px] text-fg capitalize flex items-center gap-1">{deviceIcon(log.device)} {log.device}</span></div>}
              {log.browser && <div className="flex justify-between"><span className="text-[11px] text-fg-4 font-semibold">Browser</span><span className="text-[13px] text-fg">{log.browser}</span></div>}
              {log.os      && <div className="flex justify-between"><span className="text-[11px] text-fg-4 font-semibold">OS</span><span className="text-[13px] text-fg">{log.os}</span></div>}
            </div>
          </div>
        )}

        {/* Extra details */}
        {log.details && Object.keys(log.details).length > 0 && (
          <div>
            <div className="label mb-2">Details</div>
            <div className="bg-subtle border border-line-soft rounded-lg p-2.5 overflow-x-auto">
              <pre className="text-[11px] font-mono text-fg-3 whitespace-pre-wrap">{JSON.stringify(log.details, null, 2)}</pre>
            </div>
          </div>
        )}

        {/* UA */}
        {log.userAgent && (
          <div>
            <div className="label mb-2">User Agent</div>
            <div className="bg-subtle border border-line-soft rounded-lg p-2.5">
              <p className="text-[11px] font-mono text-fg-4 break-all leading-relaxed">{log.userAgent}</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Filter chip ─────────────────────────────────────────────────────────────

function FilterChip({ label, color, onClear }: { label: string; color: string; onClear: () => void }) {
  return (
    <span className="badge" style={{ color, background: tint(color, "14"), borderColor: tint(color, "44") }}>
      {label}
      <button onClick={onClear} aria-label={`Clear ${label}`} className="ml-0.5 p-0 leading-none cursor-pointer hover:opacity-70 transition-opacity"
        style={{ color }}>✕</button>
    </span>
  );
}

// ─── Main LogsTab ─────────────────────────────────────────────────────────────

export default function LogsTab({ users, token = "" }: Props) {
  const isMobile = useIsMobile();

  const [logs,      setLogs]      = useState<LogEntry[]>([]);
  const [loading,   setLoading]   = useState(true);
  const [error,     setError]     = useState("");
  const [isDerived, setIsDerived] = useState(false);

  const [search,     setSearch]     = useState("");
  const [appF,       setAppF]       = useState<FilterApp>("all");
  const [typeF,      setTypeF]      = useState<FilterType>("all");
  const [deviceF,    setDeviceF]    = useState<FilterDevice>("all");
  const [featureF,   setFeatureF]   = useState<string>("all");
  const [planF,      setPlanF]      = useState<string>("all");
  const [timeRange,  setTimeRange]  = useState<TimeRange>("30d");
  const [userFilter, setUserFilter] = useState<string>("all");
  const [page,       setPage]       = useState(0);
  const PAGE_SIZE = 50;
  const [selected,   setSelected]   = useState<LogEntry | null>(null);
  const [showDetail, setShowDetail] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  const [loadingMore, setLoadingMore]       = useState(false);
  const [totalFetched, setTotalFetched]     = useState(0);
  const [activitySearch, setActivitySearch] = useState("");

  const loadLogs = useCallback(() => {
    void (async () => {
      setLoading(true);
      setError("");
      setNow(Date.now());
      setTotalFetched(0);

      const allLogs: LogEntry[] = [];
      let cursor: string | null = null;
      let page = 0;
      const MAX_PAGES = 20;

      try {
        while (page < MAX_PAGES) {
          const url = cursor
            ? `/api/admin?action=logs&limit=500&before=${encodeURIComponent(cursor)}`
            : "/api/admin?action=logs&limit=500";

          const r = await fetch(url, {
            headers: token ? { "x-admin-token": token } : {},
          });
          const json = await r.json() as { logs?: LogEntry[]; hasMore?: boolean; oldestTimestamp?: string | null; error?: string };

          if (json.error) throw new Error(json.error);

          const batch = json.logs ?? [];
          allLogs.push(...batch);
          setTotalFetched(allLogs.length);

          if (!json.hasMore || !json.oldestTimestamp) break;
          cursor = json.oldestTimestamp;
          page++;

          if (page === 1) setLoadingMore(true);
        }

        if (users.length > 0) {
          const derived = deriveLogsFromUsers(users);
          if (allLogs.length === 0) {
            setLogs(derived);
            setIsDerived(true);
          } else {
            const realUserIds = new Set(allLogs.map(l => l.userId));
            const derivedForMissing = derived.filter(l => !realUserIds.has(l.userId));
            const merged = [...allLogs, ...derivedForMissing]
              .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
            setLogs(merged);
            setIsDerived(derivedForMissing.length > 0);
          }
        } else {
          setLogs(allLogs);
          setIsDerived(false);
        }
      } catch {
        if (users.length > 0) {
          setLogs(deriveLogsFromUsers(users));
          setIsDerived(true);
        } else {
          setError("Could not load logs.");
        }
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    })();
  }, [token, users]);

  useEffect(() => { loadLogs(); }, [loadLogs]);

  useEffect(() => {
    if (users.length === 0) return;
    void Promise.resolve().then(() => {
      setLogs(prev => {
        const realLogs = prev.filter(l => !l.id.startsWith("signup_") && !l.id.startsWith("login_") && !l.id.startsWith("action_") && !l.id.startsWith("sub_"));
        if (realLogs.length === 0) {
          return deriveLogsFromUsers(users);
        }
        const realUserIds = new Set(realLogs.map(l => l.userId));
        const derived = deriveLogsFromUsers(users);
        const derivedForMissing = derived.filter(l => !realUserIds.has(l.userId));
        return [...realLogs, ...derivedForMissing]
          .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
      });
      setLoading(false);
      setNow(Date.now());
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [users]);

  // The app filter scopes the whole tab (stats, charts and the log), so
  // "Dashboard" gives a customer-only picture without admin sign-ins.
  const scoped = useMemo(
    () => appF === "all" ? logs : logs.filter(l => (l.app ?? "dashboard") === appF),
    [logs, appF],
  );

  const cutoff = useMemo(() => {
    if (timeRange === "all") return 0;
    const ms = { "1h": 3_600_000, "24h": 86_400_000, "7d": 7 * 86_400_000, "30d": 30 * 86_400_000 };
    return now - (ms[timeRange] ?? ms["24h"]);
  }, [timeRange, now]);

  const userPlanMap = useMemo(() => {
    const m: Record<string, string> = {};
    users.forEach(u => { m[u.id] = u.subscription?.plan ?? "free"; });
    return m;
  }, [users]);

  const filtered = useMemo(() => {
    let f = (isDerived || timeRange === "all")
      ? [...scoped]
      : scoped.filter(l => new Date(l.timestamp).getTime() >= cutoff);
    if (typeF      !== "all") f = f.filter(l => l.type === typeF);
    if (deviceF    !== "all") f = f.filter(l => l.device === deviceF);
    if (userFilter !== "all") f = f.filter(l => l.userId === userFilter);
    if (featureF   !== "all") f = f.filter(l =>
      featureF === "subscribed"
        ? l.action?.startsWith("subscribed_")
        : l.action === featureF
    );
    if (planF !== "all") f = f.filter(l => (userPlanMap[l.userId] ?? "free") === planF);
    if (search.trim()) {
      const q = search.toLowerCase();
      f = f.filter(l =>
        l.userName?.toLowerCase().includes(q) ||
        l.userEmail?.toLowerCase().includes(q) ||
        l.action?.toLowerCase().includes(q) ||
        l.ip?.includes(q) ||
        l.city?.toLowerCase().includes(q) ||
        l.browser?.toLowerCase().includes(q)
      );
    }
    return f;
  }, [scoped, cutoff, typeF, deviceF, search, userFilter, timeRange, featureF, planF, userPlanMap]);

  const logUsers = useMemo(() => {
    const seen = new Map<string, { id: string; name?: string; email?: string }>();
    scoped.forEach(l => {
      if (!seen.has(l.userId)) seen.set(l.userId, { id: l.userId, name: l.userName, email: l.userEmail });
    });
    return [...seen.values()].sort((a, b) => (a.name ?? a.email ?? "").localeCompare(b.name ?? b.email ?? ""));
  }, [scoped]);

  const exportCSV = useCallback(() => {
    const header = ["Time", "App", "User Name", "Email", "User ID", "Type", "Action", "Device", "Browser", "OS", "IP", "City", "Country"];
    const rows = filtered.map(l => [
      fmtFull(l.timestamp),
      APPS[l.app ?? "dashboard"].label,
      l.userName ?? "",
      l.userEmail ?? "",
      l.userId,
      l.type,
      l.action ?? "",
      l.device ?? "",
      l.browser ?? "",
      l.os ?? "",
      l.ip ?? "",
      l.city ?? "",
      l.country ?? "",
    ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(","));
    const csv = [header.join(","), ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `activity-logs-${new Date().toISOString().slice(0,10)}.csv`;
    a.click(); URL.revokeObjectURL(url);
  }, [filtered]);

  const stats = useMemo(() => {
    const inRange = isDerived ? scoped : scoped.filter(l => new Date(l.timestamp).getTime() >= cutoff);
    const today   = scoped.filter(l => now - new Date(l.timestamp).getTime() < 86_400_000);

    // Count unique users who logged in today — not raw event count (same user can fire many login events)
    const todayLogins     = today.filter(l => l.type === "login");
    const logins          = new Set(todayLogins.map(l => l.userId)).size;
    const loginsByApp     = (app: LogApp) => new Set(todayLogins.filter(l => (l.app ?? "dashboard") === app).map(l => l.userId)).size;
    const dashLogins      = loginsByApp("dashboard");
    const erpLogins       = loginsByApp("erp");
    const uniqueUsers     = new Set(inRange.map(l => l.userId)).size;
    const devices         = inRange.reduce((m, l) => { if (l.device) m[l.device] = (m[l.device] ?? 0) + 1; return m; }, {} as Record<string, number>);
    const topDevice       = Object.entries(devices).sort((a,b) => b[1]-a[1])[0]?.[0] ?? "";
    const countries       = inRange.reduce((m, l) => { if (l.country) m[l.country] = (m[l.country] ?? 0) + 1; return m; }, {} as Record<string, number>);
    const topCountry      = Object.entries(countries).sort((a,b) => b[1]-a[1])[0]?.[0] ?? "";
    const mobileCount     = devices["mobile"] ?? 0;
    const mobilePercent   = inRange.length ? Math.round(mobileCount / inRange.length * 100) : 0;
    const errors          = inRange.filter(l => l.type === "error").length;

    return { logins, dashLogins, erpLogins, uniqueUsers, topDevice, topCountry, mobilePercent, errors, total: inRange.length };
  }, [scoped, cutoff, now]);

  const activityChart = useMemo(() => {
    const buckets = timeRange === "1h"
      ? Array.from({ length: 60 }, (_, i) => { const d = new Date(now - (59 - i) * 60_000); return { label: `${d.getHours()}:${String(d.getMinutes()).padStart(2,"0")}`, key: d.toISOString().slice(0, 16) }; })
      : timeRange === "24h"
      ? Array.from({ length: 24 }, (_, i) => { const d = new Date(now - (23 - i) * 3_600_000); return { label: `${d.getHours()}:00`, key: `${d.toISOString().slice(0,13)}` }; })
      : timeRange === "7d"
      ? Array.from({ length: 7 }, (_, i)  => { const d = new Date(now - (6 - i) * 86_400_000); return { label: d.toLocaleDateString("en-GB", { weekday: "short" }), key: d.toISOString().slice(0,10) }; })
      : Array.from({ length: 30 }, (_, i) => { const d = new Date(now - (29 - i) * 86_400_000); return { label: String(d.getDate()), key: d.toISOString().slice(0,10) }; });

    const loginMap: Record<string, number> = {};
    const signupMap: Record<string, number> = {};
    buckets.forEach(b => { loginMap[b.key] = 0; signupMap[b.key] = 0; });

    scoped.filter(l => new Date(l.timestamp).getTime() >= cutoff).forEach(l => {
      const ts = l.timestamp;
      const key = timeRange === "1h"  ? ts.slice(0, 16) :
                  timeRange === "24h" ? ts.slice(0, 13) :
                  ts.slice(0, 10);
      if (key in loginMap) {
        if (l.type === "login")  loginMap[key]++;
        if (l.type === "signup") signupMap[key]++;
      }
    });

    return {
      labels:  buckets.map(b => b.label),
      logins:  buckets.map(b => loginMap[b.key] ?? 0),
      signups: buckets.map(b => signupMap[b.key] ?? 0),
    };
  }, [scoped, cutoff, timeRange, now]);

  const deviceBreakdown = useMemo(() => {
    const inRange = isDerived ? scoped : scoped.filter(l => new Date(l.timestamp).getTime() >= cutoff);
    const m: Record<string, number> = {};
    inRange.forEach(l => { const d = l.device ?? "unknown"; m[d] = (m[d] ?? 0) + 1; });
    const colors: Record<string, string> = { desktop: "#5b6cff", mobile: "#10b981", tablet: "#f59e0b", unknown: "var(--fg-5)" };
    return Object.entries(m).map(([d, v]) => ({ label: d, value: v, color: colors[d] ?? "var(--fg-4)" }));
  }, [scoped, cutoff, now]);

  const browserChart = useMemo(() => {
    const inRange = isDerived ? scoped : scoped.filter(l => new Date(l.timestamp).getTime() >= cutoff);
    const m: Record<string, number> = {};
    inRange.forEach(l => { if (l.browser) m[l.browser] = (m[l.browser] ?? 0) + 1; });
    const sorted = Object.entries(m).sort((a,b) => b[1]-a[1]).slice(0, 6);
    return { labels: sorted.map(e => e[0]), values: sorted.map(e => e[1]) };
  }, [scoped, cutoff, now]);

  const countryData = useMemo(() => {
    const inRange = isDerived ? scoped : scoped.filter(l => new Date(l.timestamp).getTime() >= cutoff);
    const m: Record<string, { count: number; code?: string }> = {};
    inRange.forEach(l => {
      if (l.country) {
        if (!m[l.country]) m[l.country] = { count: 0, code: l.countryCode };
        m[l.country].count++;
      }
    });
    return Object.entries(m).sort((a,b) => b[1].count - a[1].count).slice(0, 8);
  }, [scoped, cutoff, now]);

  const featureUsage = useMemo(() => {
    return USAGE_FIELDS.map(({ key, label, color }) => ({
      key, label, color,
      total: users.reduce((sum, u) => sum + ((u.usage?.[key] as number) ?? 0), 0),
    })).sort((a, b) => b.total - a.total);
  }, [users]);

  const mostActiveUsers = useMemo(() => {
    return users.map(u => ({
      id: u.id, name: u.name, email: u.email,
      totalUsage: USAGE_FIELDS.reduce((s, { key }) => s + ((u.usage?.[key] as number) ?? 0), 0),
    })).filter(u => u.totalUsage > 0).sort((a, b) => b.totalUsage - a.totalUsage);
  }, [users]);

  const userActivityMap = useMemo(() => {
    const m: Record<string, { feats: { key: string; label: string; color: string; count: number }[]; total: number }> = {};
    users.forEach(u => {
      const feats = USAGE_FIELDS
        .map(({ key, label, color }) => ({ key: key as string, label, color, count: (u.usage?.[key] as number) ?? 0 }))
        .filter(f => f.count > 0)
        .sort((a, b) => b.count - a.count);
      if (feats.length > 0) m[u.id] = { feats, total: feats.reduce((s, f) => s + f.count, 0) };
    });
    return m;
  }, [users]);

  const userActivity = useMemo(() => {
    const q = activitySearch.toLowerCase();
    return users
      .map(u => {
        const feats = USAGE_FIELDS
          .map(({ key, label, color }) => ({ key, label, color, count: (u.usage?.[key] as number) ?? 0 }))
          .filter(f => f.count > 0)
          .sort((a, b) => b.count - a.count);
        const total = feats.reduce((s, f) => s + f.count, 0);
        const lastActive = u.lastLogin ?? u.updatedAt ?? u.createdAt ?? "";
        return { ...u, feats, total, lastActive };
      })
      .filter(u => u.total > 0 && (!q || u.name?.toLowerCase().includes(q) || u.email?.toLowerCase().includes(q)))
      .sort((a, b) => b.total - a.total);
  }, [users, activitySearch]);

  if (loading && !loadingMore) return <Spinner />;

  const RANGES: { id: TimeRange; label: string }[] = [
    { id: "1h", label: "1h" }, { id: "24h", label: "24h" },
    { id: "7d",  label: "7d" }, { id: "30d", label: "30d" },
    { id: "all", label: "All" },
  ];
  const TYPES: { id: FilterType; label: string }[] = [
    { id: "all", label: "All" }, { id: "login",  label: "Login" },
    { id: "signup", label: "Signup" }, { id: "action", label: "Action" },
    { id: "logout", label: "Logout" }, { id: "error", label: "Error" },
  ];
  const APP_FILTERS: { id: FilterApp; label: string }[] = [
    { id: "all", label: "All apps" },
    { id: "dashboard", label: APPS.dashboard.label },
    { id: "erp", label: APPS.erp.label },
  ];
  const FEATURES = [
    { value: "all",         label: "All Features" },
    ...Object.entries(FEATURE_ACTIONS).map(([k, { label }]) => ({ value: k, label })),
    { value: "subscribed",  label: "Subscription" },
  ];

  const hasActiveFilters = search.trim() || appF !== "all" || typeF !== "all" || featureF !== "all" || planF !== "all" || deviceF !== "all" || userFilter !== "all";

  function clearAllFilters() {
    setSearch(""); setAppF("all"); setTypeF("all"); setFeatureF("all"); setPlanF("all"); setDeviceF("all"); setUserFilter("all"); setPage(0);
  }

  return (
    <div className="flex-1 flex overflow-hidden bg-canvas">
      {/* Main area */}
      <div className="flex-1 flex flex-col overflow-hidden min-w-0">
        <div className="flex-1 overflow-y-auto p-4 md:p-6">
          {/* Fetch-progress banner */}
          {loadingMore && (
            <div className="mb-4 px-4 py-3 bg-brand-soft border border-brand-line rounded-xl flex items-center gap-3">
              <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" className="shrink-0 animate-spin text-brand-fg"><path d="M23 4v6h-6M1 20v-6h6M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/></svg>
              <div className="text-[13px] text-brand-fg">
                <strong>Fetching all historical logs…</strong> {totalFetched.toLocaleString()} events loaded so far. This may take a moment.
              </div>
            </div>
          )}

          {/* Stats row */}
          <section className="mb-5">
            <SL>Activity Summary · Last {timeRange === "1h" ? "Hour" : timeRange === "24h" ? "24 Hours" : timeRange === "7d" ? "7 Days" : "30 Days"}</SL>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <StatCard label="Unique Logins Today" value={stats.logins} color="#5b6cff"
                sub={appF === "all" ? `${stats.dashLogins} Dashboard · ${stats.erpLogins} ERP` : `${APPS[appF].label} only`}
                icon={<svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><polyline points="10 17 15 12 10 7"/><line x1="15" y1="12" x2="3" y2="12"/></svg>} />
              <StatCard label="Unique Users" value={stats.uniqueUsers} color="#10b981"
                sub={`in last ${timeRange}`}
                icon={<svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>} />
              <StatCard label="Mobile" value={`${stats.mobilePercent}%`} color="#f59e0b"
                sub={`Top: ${stats.topDevice}`}
                icon={<svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><rect x="7" y="2" width="10" height="20" rx="2"/><line x1="12" y1="18" x2="12.01" y2="18"/></svg>} />
              <StatCard label="Top Country" value={stats.topCountry} color="var(--fg-3)"
                sub={`${stats.total} total events`}
                icon={<svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>} />
            </div>
          </section>

          {/* Feature Usage */}
          <section className="mb-5">
            <SL>Feature Usage · All Users</SL>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Card>
                <CardTitle>Top Features</CardTitle>
                <div className="space-y-2.5 mt-1">
                  {featureUsage.filter(f => f.total > 0).slice(0, 9).map(f => {
                    const max = featureUsage.find(x => x.total > 0)?.total || 1;
                    const pct = Math.round(f.total / max * 100);
                    return (
                      <div key={f.key as string} className="flex items-center gap-2.5">
                        <span className="text-[12px] text-fg font-medium shrink-0 w-36 truncate">{f.label}</span>
                        <div className="flex-1 bg-raised-2 rounded-full h-1.5 overflow-hidden">
                          <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: f.color }} />
                        </div>
                        <span className="text-[12px] font-semibold shrink-0 w-7 text-right num" style={{ color: f.color }}>{f.total}</span>
                      </div>
                    );
                  })}
                  {featureUsage.every(f => f.total === 0) && (
                    <div className="text-center py-4 text-[13px] text-fg-4">No feature usage data</div>
                  )}
                </div>
              </Card>
              <Card>
                <CardTitle>Most Active Users</CardTitle>
                <div className="space-y-1 mt-1">
                  {mostActiveUsers.slice(0, 6).map((u, i) => (
                    <div key={u.id} className="flex items-center gap-2.5 py-1.5 border-b border-line-soft last:border-0">
                      <span className="text-[11px] font-semibold text-fg-5 w-4 shrink-0 text-center num">{i + 1}</span>
                      <Avatar name={u.name} size={26} />
                      <div className="flex-1 min-w-0">
                        <div className="text-[13px] font-semibold text-fg truncate">{u.name ?? "Unknown"}</div>
                        <div className="text-[11px] text-fg-4 truncate">{u.email}</div>
                      </div>
                      <span className="text-[12px] font-semibold text-success-fg shrink-0 num">{u.totalUsage}</span>
                    </div>
                  ))}
                  {mostActiveUsers.length === 0 && (
                    <div className="text-center py-4 text-[13px] text-fg-4">No usage data</div>
                  )}
                </div>
              </Card>
            </div>
          </section>

          {/* User Activity Monitor */}
          <section className="mb-5">
            <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
              <SL>User Activity Monitor · {userActivity.length} active users</SL>
              <div className="relative">
                <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-4 pointer-events-none" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
                <input value={activitySearch} onChange={e => setActivitySearch(e.target.value)}
                  placeholder="Filter users..."
                  className="field field-sm pl-8 w-44" />
              </div>
            </div>
            <div className="card overflow-hidden">
              {userActivity.length === 0 ? (
                <div className="empty">No feature usage recorded yet</div>
              ) : (
                <>
                  {userActivity.slice(0, 20).map((u, i) => (
                    <button key={u.id}
                      onClick={() => { setUserFilter(u.id); setPage(0); }}
                      className={`w-full text-left flex items-center gap-3 px-4 py-3 border-b border-line-soft last:border-b-0 cursor-pointer transition-colors ${
                        userFilter === u.id ? "bg-active" : "hover:bg-hover"
                      }`}
                      style={{ borderLeft: userFilter === u.id ? "2px solid var(--brand)" : "2px solid transparent" }}>
                      <span className="text-[11px] font-semibold text-fg-5 w-4 shrink-0 text-center num">{i + 1}</span>
                      <Avatar name={u.name} size={30} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-[13px] font-semibold text-fg truncate">{u.name ?? "Unknown"}</span>
                          <span className="text-[11px] text-fg-4 truncate hidden sm:block">{u.email}</span>
                        </div>
                        <div className="flex gap-1 flex-wrap">
                          {u.feats.slice(0, 7).map(f => (
                            <span key={f.key as string}
                              className="badge"
                              style={{ color: f.color, background: tint(f.color, "12"), borderColor: tint(f.color, "44") }}>
                              {f.label} {f.count}
                            </span>
                          ))}
                          {u.feats.length > 7 && (
                            <span className="text-[11px] text-fg-4 px-1">+{u.feats.length - 7} more</span>
                          )}
                        </div>
                      </div>
                      <div className="text-right shrink-0 ml-2">
                        <div className="text-[13px] font-semibold text-fg num">{u.total}</div>
                        <div className="text-[11px] text-fg-4">{u.lastActive ? fmtRelative(u.lastActive, now) : "—"}</div>
                      </div>
                    </button>
                  ))}
                  {userFilter !== "all" && (
                    <div className="px-4 py-2 flex items-center gap-2 bg-surface border-t border-line-soft">
                      <span className="text-[12px] text-brand-fg">Showing log for 1 user</span>
                      <button onClick={() => setUserFilter("all")} className="link text-[12px]">
                        Clear filter
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>
          </section>

          {/* Charts */}
          <section className="mb-5">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {/* Activity line chart */}
              <div className="md:col-span-2">
                <Card>
                  <CardTitle>Login Activity · {timeRange === "all" ? "All time" : `Last ${timeRange}`}</CardTitle>
                  <LineChart
                    data={[activityChart.logins, activityChart.signups]}
                    labels={activityChart.labels}
                    color="#5b6cff"
                    h={isMobile ? 80 : 110}
                    area
                  />
                  <div className="flex items-center gap-4 mt-2">
                    <div className="flex items-center gap-1.5"><div className="w-2.5 h-2.5 rounded-full bg-brand"/><span className="text-[12px] text-fg-3">Logins</span></div>
                    <div className="flex items-center gap-1.5"><div className="w-2.5 h-2.5 rounded-full bg-success"/><span className="text-[12px] text-fg-3">Signups</span></div>
                  </div>
                </Card>
              </div>

              {/* Device donut */}
              <div>
                <Card>
                  <CardTitle>Device Breakdown</CardTitle>
                  {deviceBreakdown.length > 0 ? (
                    <div className="flex flex-col items-center">
                      <Donut segments={deviceBreakdown} size={120} label={String(stats.total)} />
                      <div className="mt-3 space-y-1.5 w-full">
                        {deviceBreakdown.map(d => {
                          const pct = stats.total ? Math.round(d.value / stats.total * 100) : 0;
                          return (
                            <div key={d.label} className="flex items-center gap-2">
                              <div className="w-2 h-2 rounded-full shrink-0" style={{ background: d.color }} />
                              <span className="text-[12px] text-fg-3 flex-1 capitalize">{d.label}</span>
                              <span className="text-[12px] font-semibold text-fg num">{d.value}</span>
                              <span className="text-[11px] text-fg-4 w-7 text-right">{pct}%</span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ) : (
                    <div className="text-center py-6 text-[13px] text-fg-4">No device data</div>
                  )}
                </Card>
              </div>
            </div>
          </section>

          {/* Browser + Country */}
          <section className="mb-5">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Card>
                <CardTitle>Top Browsers</CardTitle>
                {browserChart.labels.length > 0 ? (
                  <BarChart data={browserChart.labels.map((l, i) => ({ l, v: browserChart.values[i] }))} color="#5b6cff" h={isMobile ? 60 : 90} />
                ) : (
                  <div className="text-center py-6 text-[13px] text-fg-4">No browser data</div>
                )}
              </Card>
              <Card>
                <CardTitle>Top Countries</CardTitle>
                {countryData.length > 0 ? (
                  <div className="space-y-2.5">
                    {countryData.map(([country, { count, code }]) => {
                      const max = countryData[0]?.[1].count ?? 1;
                      const pct = Math.round(count / max * 100);
                      return (
                        <div key={country} className="flex items-center gap-2.5">
                          <span className="text-[14px] leading-none">{countryFlag(code)}</span>
                          <span className="text-[12px] text-fg font-medium shrink-0 w-24 truncate">{country}</span>
                          <div className="flex-1 bg-raised-2 rounded-full h-1.5 overflow-hidden">
                            <div className="h-full rounded-full" style={{ width: `${pct}%`, background: "var(--fg-3)" }} />
                          </div>
                          <span className="text-[12px] font-semibold text-fg shrink-0 w-5 text-right num">{count}</span>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="text-center py-6 text-[13px] text-fg-4">No location data</div>
                )}
              </Card>
            </div>
          </section>

          {/* Log table header */}
          <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
            <div className="flex items-center gap-2">
              <span className="label">Event Log</span>
              <span className="text-[12px] text-fg-4">
                {filtered.length} event{filtered.length !== 1 ? "s" : ""}{hasActiveFilters ? " (filtered)" : ""} · {logUsers.length} users
              </span>
            </div>
            <div className="flex items-center gap-2">
              {hasActiveFilters && (
                <button onClick={clearAllFilters}
                  className="btn btn-sm btn-danger">
                  <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                  Clear filters
                </button>
              )}
              <button onClick={exportCSV} className="btn btn-sm btn-secondary">
                <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                Export CSV
              </button>
              <button onClick={loadLogs} className="btn btn-sm btn-secondary">
                <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M23 4v6h-6M1 20v-6h6M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/></svg>
                Refresh
              </button>
            </div>
          </div>

          {/* Filter bar */}
          <div className="flex flex-col gap-2 mb-3">
            {/* Row 1: Search + Time range */}
            <div className="flex gap-2 items-center flex-wrap">
              <div className="relative flex-1 min-w-52">
                <svg className="absolute left-3 top-1/2 -translate-y-1/2 text-fg-4 pointer-events-none" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
                <input value={search} onChange={e => { setSearch(e.target.value); setPage(0); }}
                  placeholder="Search name, email, IP, city, action…"
                  className="field pl-9 pr-9" />
                {search && (
                  <button onClick={() => { setSearch(""); setPage(0); }} aria-label="Clear search"
                    className="btn btn-ghost btn-sm btn-icon absolute right-1 top-1/2 -translate-y-1/2">✕</button>
                )}
              </div>
              <div className="seg shrink-0">
                {RANGES.map(r => (
                  <button key={r.id} onClick={() => { setTimeRange(r.id); setPage(0); }}
                    className={`seg-item ${timeRange === r.id ? "seg-item-active" : ""}`}>
                    {r.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Row 2: App | Type | Feature | Plan | User | Device */}
            <div className="flex gap-2 items-center flex-wrap">
              {/* App */}
              <div role="group" aria-label="App" className="seg shrink-0">
                {APP_FILTERS.map(a => (
                  <button key={a.id} onClick={() => { setAppF(a.id); setPage(0); }} aria-pressed={appF === a.id}
                    className={`seg-item ${appF === a.id ? "seg-item-active" : ""}`}>
                    {a.id !== "all" && <span className="dot" style={{ background: APPS[a.id].dot }} />}
                    {a.label}
                  </button>
                ))}
              </div>

              {/* Event type pills */}
              <div className="seg shrink-0">
                {TYPES.map(t => (
                  <button key={t.id} onClick={() => { setTypeF(t.id); setPage(0); }}
                    className={`seg-item ${typeF === t.id ? "seg-item-active" : ""}`}>
                    {t.label}
                  </button>
                ))}
              </div>

              {/* Feature */}
              <Select value={featureF} onChange={e => { setFeatureF(e.target.value); setPage(0); }} wrapperClassName="min-w-[130px]">
                {FEATURES.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
              </Select>

              {/* Plan */}
              <Select value={planF} onChange={e => { setPlanF(e.target.value); setPage(0); }} wrapperClassName="min-w-[100px]">
                <option value="all">All Plans</option>
                <option value="free">Free</option>
                <option value="pro">Pro</option>
                <option value="premium">Premium</option>
                <option value="enterprise">Enterprise</option>
              </Select>

              {/* User */}
              <Select value={userFilter} onChange={e => { setUserFilter(e.target.value); setPage(0); }} wrapperClassName="max-w-44">
                <option value="all">All Users ({logUsers.length})</option>
                {logUsers.map(u => (
                  <option key={u.id} value={u.id}>{u.name ?? u.email ?? u.id.slice(0,12)}</option>
                ))}
              </Select>

              {/* Device */}
              <Select value={deviceF} onChange={e => { setDeviceF(e.target.value as FilterDevice); setPage(0); }} wrapperClassName="min-w-[110px]">
                <option value="all">All Devices</option>
                <option value="desktop">Desktop</option>
                <option value="mobile">Mobile</option>
                <option value="tablet">Tablet</option>
              </Select>
            </div>

            {/* Row 3: Active filter chips — only when something is active */}
            {hasActiveFilters && (
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="label shrink-0 mr-0.5">Active:</span>
                {appF       !== "all" && <FilterChip label={APPS[appF].label}                                       color={APPS[appF].dot} onClear={() => { setAppF("all");   setPage(0); }} />}
                {typeF      !== "all" && <FilterChip label={typeF}                                                  color="#5b6cff" onClear={() => { setTypeF("all");      setPage(0); }} />}
                {featureF   !== "all" && <FilterChip label={FEATURE_ACTIONS[featureF]?.label ?? featureF}           color="#10b981" onClear={() => { setFeatureF("all");   setPage(0); }} />}
                {planF      !== "all" && <FilterChip label={`${planF} plan`}                                        color="#f59e0b" onClear={() => { setPlanF("all");      setPage(0); }} />}
                {userFilter !== "all" && <FilterChip label={logUsers.find(u => u.id === userFilter)?.name ?? "1 user"} color="#a855f7" onClear={() => { setUserFilter("all"); setPage(0); }} />}
                {deviceF    !== "all" && <FilterChip label={deviceF}                                                color="var(--fg-3)"    onClear={() => { setDeviceF("all");   setPage(0); }} />}
                {search.trim()        && <FilterChip label={`"${search}"`}                                          color="var(--fg-3)"    onClear={() => { setSearch("");        setPage(0); }} />}
              </div>
            )}
          </div>

          {/* Log list */}
          {error ? (
            <div className="empty text-danger-fg">{error}</div>
          ) : filtered.length === 0 ? (
            <div className="empty py-12">
              <svg width="28" height="28" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24" className="mb-1 opacity-40">
                <path d="M9 12h6M9 16h6M17 21H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l5 5v11a2 2 0 0 1-2 2z"/>
              </svg>
              <p className="text-[13px]">{hasActiveFilters ? "No events match the current filters" : "No events in this time range"}</p>
              {hasActiveFilters && (
                <button onClick={clearAllFilters} className="link mt-1 text-[12px]">
                  Clear all filters
                </button>
              )}
            </div>
          ) : (
            <div className="card overflow-hidden">
              {filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE).map(log => (
                <LogRow
                  key={log.id}
                  log={log}
                  isMobile={isMobile}
                  selected={selected?.id === log.id}
                  now={now}
                  activityMap={userActivityMap}
                  onClick={() => {
                    setSelected(log);
                    setShowDetail(true);
                  }}
                />
              ))}
              {/* Pagination footer */}
              {filtered.length > PAGE_SIZE && (
                <div className="px-4 py-3 flex items-center justify-between border-t border-line-soft">
                  <span className="text-[12px] text-fg-4">
                    Showing {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, filtered.length)} of {filtered.length} events
                  </span>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => setPage(p => Math.max(0, p - 1))}
                      disabled={page === 0}
                      className="btn btn-sm btn-secondary">
                      ← Prev
                    </button>
                    <span className="text-[12px] text-fg-4 px-2 num">
                      {page + 1} / {Math.ceil(filtered.length / PAGE_SIZE)}
                    </span>
                    <button
                      onClick={() => setPage(p => Math.min(Math.ceil(filtered.length / PAGE_SIZE) - 1, p + 1))}
                      disabled={(page + 1) * PAGE_SIZE >= filtered.length}
                      className="btn btn-sm btn-secondary">
                      Next →
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Detail panel (desktop) */}
      {showDetail && selected && !isMobile && (
        <DetailPanel log={selected} onClose={() => { setShowDetail(false); setSelected(null); }} />
      )}

      {/* Detail panel (mobile - bottom sheet) */}
      {showDetail && selected && isMobile && (
        <div className="fixed inset-0 z-50 flex flex-col justify-end" onClick={() => setShowDetail(false)}>
          <div className="absolute inset-0 bg-scrim backdrop-blur-[2px]" />
          <div className="relative bg-surface border-t border-line rounded-t-xl max-h-[80vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="w-8 h-1 bg-strong rounded-full mx-auto mt-3 mb-2" />
            <DetailPanel log={selected} onClose={() => { setShowDetail(false); setSelected(null); }} />
          </div>
        </div>
      )}
    </div>
  );
}
