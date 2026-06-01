// components/admin/LogsTab.tsx
"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { User, Avatar, Card, CardTitle, SL, Spinner, LineChart, BarChart, Donut, useIsMobile } from "./admin-shared";

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
}

type FilterType = "all" | "login" | "signup" | "action" | "logout" | "error";
type FilterDevice = "all" | "desktop" | "mobile" | "tablet";
type TimeRange = "1h" | "24h" | "7d" | "30d" | "all";

interface Props { users: User[]; token?: string; }

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtRelative(iso: string, now: number) {
  const diff = now - new Date(iso).getTime();
  if (diff < 60_000)   return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
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
    login:    { label: "Login",    cls: "bg-indigo-50 text-indigo-700 border-indigo-200" },
    signup:   { label: "Signup",   cls: "bg-green-50 text-green-700 border-green-200"   },
    action:   { label: "Action",   cls: "bg-blue-50 text-blue-700 border-blue-200"      },
    logout:   { label: "Logout",   cls: "bg-gray-50 text-gray-600 border-gray-200"      },
    error:    { label: "Error",    cls: "bg-red-50 text-red-700 border-red-200"         },
    pageview: { label: "Page",     cls: "bg-gray-50 text-gray-500 border-gray-100"      },
  };
  const { label, cls } = map[type] ?? { label: type, cls: "bg-gray-50 text-gray-600 border-gray-200" };
  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold border ${cls} whitespace-nowrap shrink-0`}>
      {label}
    </span>
  );
}

function countryFlag(code?: string) {
  if (!code || code.length !== 2) return "🌐";
  return String.fromCodePoint(...[...code.toUpperCase()].map(c => 0x1F1E6 + c.charCodeAt(0) - 65));
}

// Maps a Firebase auth provider to the most likely browser
function providerToBrowser(provider?: string): string {
  if (provider === "google")   return "Chrome";
  if (provider === "facebook") return "Facebook App";
  if (provider === "apple")    return "Safari";
  if (provider === "github")   return "Chrome";
  return "Browser";  // email/password — unknown but at least not "Unknown"
}

// Derive synthetic log entries from user collection (fallback if no logs collection exists)
function deriveLogsFromUsers(users: User[]): LogEntry[] {
  const entries: LogEntry[] = [];
  users.forEach(u => {
    // Signup event
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

    // Login event — use lastLogin if available, else fall back to updatedAt/createdAt
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

    // Action events — one per feature that has non-zero usage
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

    // Plan entry — show subscription events
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
  return entries.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
}

// ─── Stat Card ────────────────────────────────────────────────────────────────

function StatCard({ label, value, sub, color, icon }: { label: string; value: string | number; sub?: string; color: string; icon: React.ReactNode }) {
  return (
    <div className="bg-white border border-gray-100 rounded-xl p-4 flex items-start gap-3">
      <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0" style={{ background: color + "18" }}>
        <span style={{ color }}>{icon}</span>
      </div>
      <div className="min-w-0">
        <div className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-0.5">{label}</div>
        <div className="text-2xl font-extrabold tracking-tight leading-none" style={{ color }}>{value}</div>
        {sub && <div className="text-[11px] text-gray-400 mt-1">{sub}</div>}
      </div>
    </div>
  );
}

// ─── Log Row ──────────────────────────────────────────────────────────────────

function LogRow({ log, isMobile, onClick, selected, now }: { log: LogEntry; isMobile: boolean; onClick: () => void; selected: boolean; now: number }) {
  return (
    <button
      onClick={onClick}
      className={`w-full text-left px-4 py-3 border-b border-gray-50 hover:bg-gray-50/80 transition-colors cursor-pointer border-none border-l-2 ${selected ? "bg-indigo-50/40 border-l-indigo-400" : "bg-white border-l-transparent"}`}
      style={{ borderLeft: selected ? "2px solid #6366F1" : "2px solid transparent" }}>
      <div className="flex items-start gap-3">
        <Avatar name={log.userName ?? log.userEmail ?? "?"} size={28} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-0.5">
            <span className="text-[12px] font-semibold text-gray-800 truncate max-w-[140px]">
              {log.userName ?? log.userEmail?.split("@")[0] ?? "Unknown"}
            </span>
            {typeBadge(log.type)}
            {log.action && (
              <span className="text-[10px] text-gray-400 font-mono truncate">{log.action.replace(/_/g, " ")}</span>
            )}
          </div>
          <div className="flex items-center gap-2.5 flex-wrap">
            <span className="text-[11px] text-gray-400">{log.userEmail ?? log.userId.slice(0, 12)}</span>
            {!isMobile && log.city && (
              <span className="text-[11px] text-gray-400 flex items-center gap-1">
                <span>{countryFlag(log.countryCode)}</span>
                <span>{log.city}, {log.country}</span>
              </span>
            )}
            {!isMobile && log.device && (
              <span className="text-[11px] text-gray-400 flex items-center gap-1">
                <span className="text-gray-300">{deviceIcon(log.device)}</span>
                <span className="capitalize">{log.browser ?? log.device}</span>
              </span>
            )}
            {log.ip && !isMobile && (
              <span className="text-[10px] font-mono text-gray-300">{log.ip}</span>
            )}
          </div>
        </div>
        <div className="shrink-0 text-right">
          <div className="text-[11px] text-gray-400 whitespace-nowrap">{fmtRelative(log.timestamp, now)}</div>
          {!isMobile && (
            <div className="text-[10px] text-gray-300 mt-0.5 whitespace-nowrap">{new Date(log.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</div>
          )}
        </div>
      </div>
    </button>
  );
}

// ─── Detail Panel ─────────────────────────────────────────────────────────────

function DetailPanel({ log, onClose }: { log: LogEntry; onClose: () => void }) {
  return (
    <div className="w-72 shrink-0 border-l border-gray-100 bg-white flex flex-col overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
        <span className="text-[13px] font-bold text-gray-900">Event Detail</span>
        <button onClick={onClose} className="w-6 h-6 rounded-full hover:bg-gray-100 flex items-center justify-center cursor-pointer border-none bg-transparent text-gray-400">
          <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* User */}
        <div className="flex items-center gap-3 p-3 bg-gray-50 rounded-xl">
          <Avatar name={log.userName ?? log.userEmail ?? "?"} size={36} />
          <div className="min-w-0">
            <div className="text-[13px] font-semibold text-gray-800 truncate">{log.userName ?? "Unknown"}</div>
            <div className="text-[11px] text-gray-400 truncate">{log.userEmail ?? log.userId}</div>
          </div>
        </div>

        {/* Event */}
        <div>
          <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2">Event</div>
          <div className="space-y-2">
            {[
              ["Type",      typeBadge(log.type)],
              ["Time",      <span key="t" className="text-[12px] text-gray-700">{fmtFull(log.timestamp)}</span>],
              ["User ID",   <span key="u" className="font-mono text-[11px] text-indigo-600">{log.userId.slice(0,16)}…</span>],
              log.action ? ["Action",  <span key="a" className="text-[12px] text-gray-700 font-mono">{log.action}</span>] : null,
              log.path   ? ["Path",    <span key="p" className="text-[12px] text-gray-700 font-mono">{log.path}</span>]   : null,
            ].filter(Boolean).map((row, i) => (
              <div key={i} className="flex items-start justify-between gap-2">
                <span className="text-[10px] font-semibold text-gray-400 shrink-0 mt-0.5">{(row as [string, React.ReactNode])[0]}</span>
                <span className="text-right">{(row as [string, React.ReactNode])[1]}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Location */}
        {(log.ip || log.city || log.country) && (
          <div>
            <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2">Location</div>
            <div className="space-y-2">
              {log.ip      && <div className="flex justify-between"><span className="text-[10px] text-gray-400 font-semibold">IP</span><span className="font-mono text-[11px] text-gray-700">{log.ip}</span></div>}
              {log.city    && <div className="flex justify-between"><span className="text-[10px] text-gray-400 font-semibold">City</span><span className="text-[12px] text-gray-700">{log.city}</span></div>}
              {log.country && <div className="flex justify-between"><span className="text-[10px] text-gray-400 font-semibold">Country</span><span className="text-[12px] text-gray-700">{countryFlag(log.countryCode)} {log.country}</span></div>}
            </div>
          </div>
        )}

        {/* Device */}
        {(log.device || log.browser || log.os) && (
          <div>
            <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2">Device</div>
            <div className="space-y-2">
              {log.device  && <div className="flex justify-between"><span className="text-[10px] text-gray-400 font-semibold">Type</span><span className="text-[12px] text-gray-700 capitalize flex items-center gap-1">{deviceIcon(log.device)} {log.device}</span></div>}
              {log.browser && <div className="flex justify-between"><span className="text-[10px] text-gray-400 font-semibold">Browser</span><span className="text-[12px] text-gray-700">{log.browser}</span></div>}
              {log.os      && <div className="flex justify-between"><span className="text-[10px] text-gray-400 font-semibold">OS</span><span className="text-[12px] text-gray-700">{log.os}</span></div>}
            </div>
          </div>
        )}

        {/* Extra details */}
        {log.details && Object.keys(log.details).length > 0 && (
          <div>
            <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2">Details</div>
            <div className="bg-gray-50 rounded-lg p-2.5 overflow-x-auto">
              <pre className="text-[10px] font-mono text-gray-600 whitespace-pre-wrap">{JSON.stringify(log.details, null, 2)}</pre>
            </div>
          </div>
        )}

        {/* UA */}
        {log.userAgent && (
          <div>
            <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2">User Agent</div>
            <div className="bg-gray-50 rounded-lg p-2.5">
              <p className="text-[10px] font-mono text-gray-500 break-all leading-relaxed">{log.userAgent}</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Main LogsTab ─────────────────────────────────────────────────────────────

export default function LogsTab({ users, token = "" }: Props) {
  const isMobile = useIsMobile();

  const [logs,      setLogs]      = useState<LogEntry[]>([]);
  const [loading,   setLoading]   = useState(true);
  const [error,     setError]     = useState("");
  const [isDerived, setIsDerived] = useState(false);

  // Filters
  const [search,     setSearch]     = useState("");
  const [typeF,      setTypeF]      = useState<FilterType>("all");
  const [deviceF,    setDeviceF]    = useState<FilterDevice>("all");
  const [timeRange,  setTimeRange]  = useState<TimeRange>("30d");
  const [userFilter, setUserFilter] = useState<string>("all");
  const [page,       setPage]       = useState(0);
  const PAGE_SIZE = 50;
  const [selected,   setSelected]   = useState<LogEntry | null>(null);
  const [showDetail, setShowDetail] = useState(false);
  // Snapshot of "now" — updated after each load so memos stay pure
  const [now, setNow] = useState(() => Date.now());

  // ── Fetch logs ──────────────────────────────────────────────────────────────
  // All setState calls live inside the async chain, never synchronously in the
  // effect body, so the React compiler's cascading-render rule is satisfied.
  const [loadingMore, setLoadingMore] = useState(false);
  const [totalFetched, setTotalFetched] = useState(0);

  const loadLogs = useCallback(() => {
    // Fetch all pages from Firebase by following the cursor until hasMore is false
    void (async () => {
      setLoading(true);
      setError("");
      setNow(Date.now());
      setTotalFetched(0);

      const allLogs: LogEntry[] = [];
      let cursor: string | null = null;
      let page = 0;
      const MAX_PAGES = 20; // safety cap — 20 × 500 = 10 000 logs max

      try {
        while (page < MAX_PAGES) {
          const url = cursor
            ? `/api/admin?action=logs&limit=500&before=${encodeURIComponent(cursor)}`
            : "/api/admin?action=logs&limit=500";

          const r = await fetch(url, {
            headers: token ? { "x-firebase-token": token } : {},
          });
          const json = await r.json() as { logs?: LogEntry[]; hasMore?: boolean; oldestTimestamp?: string | null; error?: string };

          if (json.error) throw new Error(json.error);

          const batch = json.logs ?? [];
          allLogs.push(...batch);
          setTotalFetched(allLogs.length);

          if (!json.hasMore || !json.oldestTimestamp) break;
          cursor = json.oldestTimestamp;
          page++;

          // Show progress to the user while fetching
          if (page === 1) setLoadingMore(true);
        }

        // Always derive entries from ALL users in the users collection,
        // then merge with any real Firebase logs — real logs take precedence
        // for users who have them, derived entries fill the gap for everyone else.
        if (users.length > 0) {
          const derived = deriveLogsFromUsers(users);
          if (allLogs.length === 0) {
            // No real logs at all — use fully derived
            setLogs(derived);
            setIsDerived(true);
          } else {
            // Merge: keep all real logs, add derived entries only for users
            // who have zero real logs (so every user appears in the list)
            const realUserIds = new Set(allLogs.map(l => l.userId));
            const derivedForMissing = derived.filter(l => !realUserIds.has(l.userId));
            const merged = [...allLogs, ...derivedForMissing]
              .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
            setLogs(merged);
            setIsDerived(derivedForMissing.length > 0); // partial derive
          }
        } else {
          setLogs(allLogs);
          setIsDerived(false);
        }
      } catch {
        // On error, fall back to fully derived logs for all users
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

  // Re-derive whenever users array changes — ensures all users always appear
  useEffect(() => {
    if (users.length === 0) return;
    void Promise.resolve().then(() => {
      setLogs(prev => {
        const realLogs = prev.filter(l => !l.id.startsWith("signup_") && !l.id.startsWith("login_") && !l.id.startsWith("action_") && !l.id.startsWith("sub_"));
        if (realLogs.length === 0) {
          // No real logs yet — fully derived
          return deriveLogsFromUsers(users);
        }
        // Merge: real logs + derived for users with no real logs
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

  // ── Time range filter ───────────────────────────────────────────────────────
  const cutoff = useMemo(() => {
    if (timeRange === "all") return 0;
    const ms = { "1h": 3_600_000, "24h": 86_400_000, "7d": 7 * 86_400_000, "30d": 30 * 86_400_000 };
    return now - (ms[timeRange] ?? ms["24h"]);
  }, [timeRange, now]);

  // ── Filtered & searched logs ────────────────────────────────────────────────
  const filtered = useMemo(() => {
    // For derived data or "all" range skip the time cutoff
    let f = (isDerived || timeRange === "all")
      ? [...logs]
      : logs.filter(l => new Date(l.timestamp).getTime() >= cutoff);
    if (typeF      !== "all") f = f.filter(l => l.type === typeF);
    if (deviceF    !== "all") f = f.filter(l => l.device === deviceF);
    if (userFilter !== "all") f = f.filter(l => l.userId === userFilter);
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
  }, [logs, cutoff, typeF, deviceF, search, userFilter, timeRange]);

  // ── Unique users in logs (for the user filter dropdown) ────────────────────
  const logUsers = useMemo(() => {
    const seen = new Map<string, { id: string; name?: string; email?: string }>();
    logs.forEach(l => {
      if (!seen.has(l.userId)) seen.set(l.userId, { id: l.userId, name: l.userName, email: l.userEmail });
    });
    return [...seen.values()].sort((a, b) => (a.name ?? a.email ?? "").localeCompare(b.name ?? b.email ?? ""));
  }, [logs]);

  // ── CSV export ──────────────────────────────────────────────────────────────
  const exportCSV = useCallback(() => {
    const header = ["Time", "User Name", "Email", "User ID", "Type", "Action", "Device", "Browser", "OS", "IP", "City", "Country"];
    const rows = filtered.map(l => [
      fmtFull(l.timestamp),
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

  // ── Stats ───────────────────────────────────────────────────────────────────
  const stats = useMemo(() => {
    const inRange = isDerived ? logs : logs.filter(l => new Date(l.timestamp).getTime() >= cutoff);
    const today   = isDerived ? logs : logs.filter(l => now - new Date(l.timestamp).getTime() < 86_400_000);

    const logins          = today.filter(l => l.type === "login").length;
    const uniqueUsers     = new Set(inRange.map(l => l.userId)).size;
    const devices         = inRange.reduce((m, l) => { if (l.device) m[l.device] = (m[l.device] ?? 0) + 1; return m; }, {} as Record<string, number>);
    const topDevice       = Object.entries(devices).sort((a,b) => b[1]-a[1])[0]?.[0] ?? "—";
    const countries       = inRange.reduce((m, l) => { if (l.country) m[l.country] = (m[l.country] ?? 0) + 1; return m; }, {} as Record<string, number>);
    const topCountry      = Object.entries(countries).sort((a,b) => b[1]-a[1])[0]?.[0] ?? "—";
    const mobileCount     = devices["mobile"] ?? 0;
    const mobilePercent   = inRange.length ? Math.round(mobileCount / inRange.length * 100) : 0;
    const errors          = inRange.filter(l => l.type === "error").length;

    return { logins, uniqueUsers, topDevice, topCountry, mobilePercent, errors, total: inRange.length };
  }, [logs, cutoff, now]);

  // ── Activity chart (logins per hour / day) ──────────────────────────────────
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

    logs.filter(l => new Date(l.timestamp).getTime() >= cutoff).forEach(l => {
      const ts = l.timestamp;
      const key = timeRange === "1h"   ? ts.slice(0, 16) :
                  timeRange === "24h"  ? ts.slice(0, 13) :
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
  }, [logs, cutoff, timeRange, now]);

  // ── Device breakdown for donut ───────────────────────────────────────────────
  const deviceBreakdown = useMemo(() => {
    const inRange = isDerived ? logs : logs.filter(l => new Date(l.timestamp).getTime() >= cutoff);
    const m: Record<string, number> = {};
    inRange.forEach(l => { const d = l.device ?? "unknown"; m[d] = (m[d] ?? 0) + 1; });
    const colors: Record<string, string> = { desktop: "#6366F1", mobile: "#10B981", tablet: "#F59E0B", unknown: "#D1D5DB" };
    return Object.entries(m).map(([d, v]) => ({ label: d, value: v, color: colors[d] ?? "#9CA3AF" }));
  }, [logs, cutoff, now]);

  // ── Browser breakdown ────────────────────────────────────────────────────────
  const browserChart = useMemo(() => {
    const inRange = isDerived ? logs : logs.filter(l => new Date(l.timestamp).getTime() >= cutoff);
    const m: Record<string, number> = {};
    inRange.forEach(l => { if (l.browser) m[l.browser] = (m[l.browser] ?? 0) + 1; });
    const sorted = Object.entries(m).sort((a,b) => b[1]-a[1]).slice(0, 6);
    return { labels: sorted.map(e => e[0]), values: sorted.map(e => e[1]) };
  }, [logs, cutoff, now]);

  // ── Country breakdown ─────────────────────────────────────────────────────── 
  const countryData = useMemo(() => {
    const inRange = isDerived ? logs : logs.filter(l => new Date(l.timestamp).getTime() >= cutoff);
    const m: Record<string, { count: number; code?: string }> = {};
    inRange.forEach(l => {
      if (l.country) {
        if (!m[l.country]) m[l.country] = { count: 0, code: l.countryCode };
        m[l.country].count++;
      }
    });
    return Object.entries(m).sort((a,b) => b[1].count - a[1].count).slice(0, 8);
  }, [logs, cutoff, now]);

  // ─────────────────────────────────────────────────────────────────────────────

  if (loading && !loadingMore) return <Spinner />;

  const RANGES: { id: TimeRange; label: string }[] = [
    { id: "1h", label: "1h" }, { id: "24h", label: "24h" },
    { id: "7d",  label: "7d" }, { id: "30d", label: "30d" },
    { id: "all", label: "All" },
  ];
  const TYPES: { id: FilterType; label: string }[] = [
    { id: "all", label: "All" }, { id: "login",  label: "Logins" },
    { id: "signup", label: "Signups" }, { id: "action", label: "Actions" },
    { id: "logout", label: "Logouts" }, { id: "error", label: "Errors" },
  ];

  return (
    <div className="flex-1 flex overflow-hidden">
      {/* Main area */}
      <div className="flex-1 flex flex-col overflow-hidden min-w-0">
        <div className="flex-1 overflow-y-auto p-4 md:p-6">
          {/* Fetch-progress banner */}
          {loadingMore && (
            <div className="mb-4 px-4 py-3 bg-indigo-50 border border-indigo-200 rounded-xl flex items-center gap-3">
              <svg width="14" height="14" fill="none" stroke="#6366F1" strokeWidth="2" viewBox="0 0 24 24" className="shrink-0 animate-spin"><path d="M23 4v6h-6M1 20v-6h6M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/></svg>
              <div className="text-[12px] text-indigo-800">
                <strong>Fetching all historical logs…</strong> {totalFetched.toLocaleString()} events loaded so far. This may take a moment.
              </div>
            </div>
          )}

          {/* Stats row */}
          <section className="mb-5">
            <SL>Activity Summary · Last {timeRange === "1h" ? "Hour" : timeRange === "24h" ? "24 Hours" : timeRange === "7d" ? "7 Days" : "30 Days"}</SL>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <StatCard label="Logins Today" value={stats.logins} color="#6366F1"
                sub="Unique sign-ins"
                icon={<svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><polyline points="10 17 15 12 10 7"/><line x1="15" y1="12" x2="3" y2="12"/></svg>} />
              <StatCard label="Unique Users" value={stats.uniqueUsers} color="#10B981"
                sub={`in last ${timeRange}`}
                icon={<svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>} />
              <StatCard label="Mobile" value={`${stats.mobilePercent}%`} color="#F59E0B"
                sub={`Top: ${stats.topDevice}`}
                icon={<svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><rect x="7" y="2" width="10" height="20" rx="2"/><line x1="12" y1="18" x2="12.01" y2="18"/></svg>} />
              <StatCard label="Top Country" value={stats.topCountry} color="#8B5CF6"
                sub={`${stats.total} total events`}
                icon={<svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>} />
            </div>
          </section>

          {/* Charts */}
          <section className="mb-5">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {/* Activity line chart */}
              <div className="md:col-span-2">
                <Card>
                  <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
                    <CardTitle>Login Activity</CardTitle>
                    <div className="flex gap-1">
                      {RANGES.map(r => (
                        <button key={r.id} onClick={() => setTimeRange(r.id)}
                          className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold cursor-pointer border-none transition-colors ${timeRange === r.id ? "bg-indigo-600 text-white" : "bg-gray-100 text-gray-500 hover:bg-gray-200"}`}>
                          {r.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <LineChart
                    data={[activityChart.logins, activityChart.signups]}
                    labels={activityChart.labels}
                    color="#6366F1"
                    h={isMobile ? 80 : 110}
                    area
                  />
                  <div className="flex items-center gap-4 mt-2">
                    <div className="flex items-center gap-1.5"><div className="w-2.5 h-2.5 rounded-full bg-indigo-500"/><span className="text-[11px] text-gray-400">Logins</span></div>
                    <div className="flex items-center gap-1.5"><div className="w-2.5 h-2.5 rounded-full bg-green-500"/><span className="text-[11px] text-gray-400">Signups</span></div>
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
                              <span className="text-[11px] text-gray-500 flex-1 capitalize">{d.label}</span>
                              <span className="text-[11px] font-bold text-gray-800">{d.value}</span>
                              <span className="text-[10px] text-gray-400 w-7 text-right">{pct}%</span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ) : (
                    <div className="text-center py-6 text-[12px] text-gray-400">No device data</div>
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
                  <BarChart data={browserChart.labels.map((l, i) => ({ l, v: browserChart.values[i] }))} color="#0EA5E9" h={isMobile ? 60 : 90} />
                ) : (
                  <div className="text-center py-6 text-[12px] text-gray-400">No browser data</div>
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
                          <span className="text-[11px] text-gray-700 font-medium shrink-0 w-24 truncate">{country}</span>
                          <div className="flex-1 bg-gray-100 rounded-full h-1.5 overflow-hidden">
                            <div className="h-full rounded-full" style={{ width: `${pct}%`, background: "#8B5CF6" }} />
                          </div>
                          <span className="text-[11px] font-bold text-gray-800 shrink-0 w-5 text-right">{count}</span>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="text-center py-6 text-[12px] text-gray-400">No location data</div>
                )}
              </Card>
            </div>
          </section>

          {/* Log table section header */}
          <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
            <SL>Event Log · {filtered.length} events across {logUsers.length} users</SL>
            <div className="flex items-center gap-2">
              <button onClick={exportCSV} className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-semibold text-indigo-600 border border-indigo-200 rounded-lg hover:bg-indigo-50 cursor-pointer bg-white">
                <svg width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                Export CSV
              </button>
              <button onClick={loadLogs} className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-semibold text-gray-500 border border-gray-200 rounded-lg hover:bg-gray-50 cursor-pointer bg-white">
                <svg width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M23 4v6h-6M1 20v-6h6M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/></svg>
                Refresh
              </button>
            </div>
          </div>

          {/* Filter bar */}
          <div className="flex flex-wrap gap-2 mb-3">
            {/* Search */}
            <div className="flex items-center gap-2 bg-white border border-gray-200 rounded-lg px-3 py-1.5 flex-1 min-w-[180px]">
              <svg width="12" height="12" fill="none" stroke="#9CA3AF" strokeWidth="2" viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
              <input value={search} onChange={e => { setSearch(e.target.value); setPage(0); }}
                placeholder="Search name, email, IP, action…"
                className="text-[12px] bg-transparent border-none outline-none text-gray-700 placeholder-gray-400 flex-1 min-w-0" />
              {search && <button onClick={() => setSearch("")} className="text-gray-300 hover:text-gray-500 border-none bg-transparent cursor-pointer text-[12px]">✕</button>}
            </div>

            {/* User filter */}
            <select value={userFilter} onChange={e => { setUserFilter(e.target.value); setPage(0); }}
              className="border border-gray-200 rounded-lg px-2.5 py-1.5 text-[11px] text-gray-600 bg-white outline-none cursor-pointer font-[inherit] max-w-[180px]">
              <option value="all">All Users ({logUsers.length})</option>
              {logUsers.map(u => (
                <option key={u.id} value={u.id}>{u.name ?? u.email ?? u.id.slice(0,12)}</option>
              ))}
            </select>

            {/* Type filter */}
            <div className="flex gap-1 bg-gray-100 rounded-lg p-0.5">
              {TYPES.map(t => (
                <button key={t.id} onClick={() => { setTypeF(t.id); setPage(0); }}
                  className={`px-2.5 py-1 rounded text-[11px] font-semibold border-none cursor-pointer transition-colors whitespace-nowrap ${typeF === t.id ? "bg-white text-gray-900 shadow-sm" : "bg-transparent text-gray-500 hover:text-gray-700"}`}>
                  {t.label}
                </button>
              ))}
            </div>

            {/* Device filter */}
            <select value={deviceF} onChange={e => { setDeviceF(e.target.value as FilterDevice); setPage(0); }}
              className="border border-gray-200 rounded-lg px-2.5 py-1.5 text-[11px] text-gray-600 bg-white outline-none cursor-pointer font-[inherit]">
              <option value="all">All Devices</option>
              <option value="desktop">Desktop</option>
              <option value="mobile">Mobile</option>
              <option value="tablet">Tablet</option>
            </select>
          </div>

          {/* Log list */}
          {error ? (
            <div className="text-center py-8 text-[13px] text-red-500">{error}</div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-12 text-gray-400">
              <svg width="28" height="28" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24" className="mx-auto mb-2 opacity-40">
                <path d="M9 12h6M9 16h6M17 21H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l5 5v11a2 2 0 0 1-2 2z"/>
              </svg>
              <p className="text-[12px]">{search || typeF !== "all" ? "No events match your filters" : "No events in this time range"}</p>
            </div>
          ) : (
            <div className="bg-white border border-gray-100 rounded-xl overflow-hidden">
              {filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE).map(log => (
                <LogRow
                  key={log.id}
                  log={log}
                  isMobile={isMobile}
                  selected={selected?.id === log.id}
                  now={now}
                  onClick={() => {
                    setSelected(log);
                    setShowDetail(true);
                  }}
                />
              ))}
              {/* Pagination footer */}
              {filtered.length > PAGE_SIZE && (
                <div className="px-4 py-3 flex items-center justify-between border-t border-gray-50">
                  <span className="text-[11px] text-gray-400">
                    Showing {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, filtered.length)} of {filtered.length} events
                  </span>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => setPage(p => Math.max(0, p - 1))}
                      disabled={page === 0}
                      className="px-2.5 py-1 text-[11px] font-semibold border border-gray-200 rounded-lg bg-white text-gray-500 hover:bg-gray-50 disabled:opacity-30 cursor-pointer disabled:cursor-default">
                      ← Prev
                    </button>
                    <span className="text-[11px] text-gray-400 px-2">
                      {page + 1} / {Math.ceil(filtered.length / PAGE_SIZE)}
                    </span>
                    <button
                      onClick={() => setPage(p => Math.min(Math.ceil(filtered.length / PAGE_SIZE) - 1, p + 1))}
                      disabled={(page + 1) * PAGE_SIZE >= filtered.length}
                      className="px-2.5 py-1 text-[11px] font-semibold border border-gray-200 rounded-lg bg-white text-gray-500 hover:bg-gray-50 disabled:opacity-30 cursor-pointer disabled:cursor-default">
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

      {/* Detail panel (mobile — bottom sheet) */}
      {showDetail && selected && isMobile && (
        <div className="fixed inset-0 z-50 flex flex-col justify-end" onClick={() => setShowDetail(false)}>
          <div className="absolute inset-0 bg-black/30" />
          <div className="relative bg-white rounded-t-2xl max-h-[80vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="w-8 h-1 bg-gray-200 rounded-full mx-auto mt-3 mb-2" />
            <DetailPanel log={selected} onClose={() => { setShowDetail(false); setSelected(null); }} />
          </div>
        </div>
      )}
    </div>
  );
}