// components/admin/ExtensionTab.tsx
// Growth → Extension: who uses the Chrome extension, how much, and what each
// person did with it. Data: /api/admin?action=extension (lib/extension-usage.ts).
// An extension user is someone who saved at least one job through it; installs
// and job analyses leave no trace server-side, so they can't be counted.
"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { LineChart } from "./admin-shared";
import { Block, Empty, Stat, human } from "./ui-kit";

// ─── Types / data ─────────────────────────────────────────────────────────────

interface ExtUser {
  id: string; name: string | null; email: string | null; plan: string;
  firstUsedAt: string; lastUsedAt: string; jobs: number; jobsInRange: number; interviews: number;
  platforms: { name: string; n: number }[];
}
interface Overview {
  range: { days: number; from: string };
  totals: { users: number; activeInRange: number; active7: number; active30: number; jobsInRange: number; jobsAllTime: number;
    totalUsers: number; shareOfUsersPct: number | null; interviewsInRange: number; respondedInRange: number };
  saves: { at: string; userId: string }[];
  platforms: { platform: string; jobs: number; users: number }[];
  statuses: { status: string; n: number }[];
  upsell: { shown: number; dismissed: number; clicked: number };
  users: ExtUser[];
}
interface Activity {
  jobs: { id: string; company: string | null; title: string | null; status: string | null; platform: string; url: string | null;
    savedAt: string; firstResponseAt: string | null; reachedInterviewAt: string | null }[];
  upsell: { event: string; variant: string; at: string }[];
}

function useAdmin<T>(query: string, token: string) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const r = await fetch(`/api/admin?${query}`, { headers: token ? { "x-admin-token": token } : {}, cache: "no-store" });
      const j = await r.json() as T & { error?: string };
      if (!r.ok || j.error) throw new Error(j.error ?? `HTTP ${r.status}`);
      setData(j);
    } catch (e) { setError((e as Error).message); }
    setLoading(false);
  }, [query, token]);
  useEffect(() => { void Promise.resolve().then(load); }, [load]);
  return { data, error, loading, reload: load };
}

// ─── Formatting (viewer's time zone) ─────────────────────────────────────────

const n = (v?: number | null) => (v == null ? "—" : v.toLocaleString());
const when = (iso: string) => new Date(iso).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
const day = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
const zone = () => new Intl.DateTimeFormat("en-US", { timeZoneName: "short" }).formatToParts(new Date()).find(p => p.type === "timeZoneName")?.value ?? "";
function ago(iso: string) {
  const d = Math.floor((Date.now() - Date.parse(iso)) / 86_400_000);
  return d <= 0 ? "today" : d === 1 ? "yesterday" : d < 30 ? `${d}d ago` : day(iso);
}
const localKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** Saves per local day (or per week for long ranges), zero-filled, plus distinct users per bucket. */
function series(saves: Overview["saves"], days: number) {
  const weekly = days > 120;
  const span = Math.min(days, 3650);
  const start = new Date(); start.setHours(0, 0, 0, 0); start.setDate(start.getDate() - (span - 1));
  if (days >= 3650 && saves.length) { const first = new Date(saves.reduce((m, s) => s.at < m ? s.at : m, saves[0].at)); first.setHours(0, 0, 0, 0); start.setTime(first.getTime()); }
  const keyOf = (d: Date) => { if (!weekly) return localKey(d); const w = new Date(d); w.setDate(w.getDate() - ((w.getDay() + 6) % 7)); return localKey(w); };
  const buckets = new Map<string, { jobs: number; users: Set<string> }>();
  for (const d = new Date(start); d <= new Date(); d.setDate(d.getDate() + 1)) { const k = keyOf(d); if (!buckets.has(k)) buckets.set(k, { jobs: 0, users: new Set() }); }
  for (const s of saves) { const b = buckets.get(keyOf(new Date(s.at))); if (b) { b.jobs++; b.users.add(s.userId); } }
  const keys = [...buckets.keys()];
  return {
    weekly,
    labels: keys.map(k => new Date(`${k}T00:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short" })),
    jobs: keys.map(k => buckets.get(k)!.jobs),
    users: keys.map(k => buckets.get(k)!.users.size),
  };
}

// ─── Small pieces ─────────────────────────────────────────────────────────────

function Note({ children }: { children: React.ReactNode }) {
  return <p className="text-[12px] text-fg-4 leading-relaxed">{children}</p>;
}

function Bars({ items }: { items: { label: string; value: number; right: React.ReactNode }[] }) {
  if (!items.length) return <Empty>Nothing in this range</Empty>;
  const max = Math.max(...items.map(i => i.value), 1);
  return (
    <ul className="px-4 py-3 flex flex-col gap-2.5">
      {items.map(i => (
        <li key={i.label}>
          <div className="flex items-baseline justify-between gap-3 text-[13px]">
            <span className="text-fg-2 truncate">{i.label}</span>
            <span className="text-[12px] text-fg-3 num shrink-0">{i.right}</span>
          </div>
          <span className="mt-1.5 block h-1.5 rounded-full bg-raised-2 overflow-hidden">
            <span className="block h-full rounded-full bg-brand" style={{ width: `${(100 * i.value) / max}%` }} />
          </span>
        </li>
      ))}
    </ul>
  );
}

const STATUS_COLOR: Record<string, string> = { applied: "var(--fg-3)", interview: "#5b6cff", interviewing: "#5b6cff", offer: "#10b981", rejected: "#ef4444", saved: "var(--fg-4)" };

// ─── Tab ──────────────────────────────────────────────────────────────────────

const RANGES = [{ v: "7", l: "Last 7 days" }, { v: "30", l: "Last 30 days" }, { v: "90", l: "Last 90 days" }, { v: "365", l: "Last 12 months" }, { v: "3650", l: "All time" }];

export default function ExtensionTab({ token }: { token: string }) {
  const [days, setDays] = useState("30");
  const q = useAdmin<Overview>(`action=extension&days=${days}`, token);
  const d = q.data, t = d?.totals;
  const chart = useMemo(() => d ? series(d.saves, d.range.days) : null, [d]);
  const rangeLabel = RANGES.find(r => r.v === days)?.l.toLowerCase() ?? "";

  return (
    <div className="flex-1 flex flex-col min-h-0 min-w-0 bg-canvas">
      <div className="px-4 md:px-6 pt-5 pb-4 border-b border-line-soft shrink-0">
        <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-3">
          <div className="min-w-0">
            <h1 className="page-title">Chrome extension</h1>
            <p className="text-caption mt-1">Who uses it and what they do with it · times in your time zone ({zone()})</p>
          </div>
          <div className="flex items-center gap-2 min-w-0 flex-wrap">
            <button onClick={() => void q.reload()} className="btn btn-secondary shrink-0">Refresh</button>
            <div className="seg max-w-full overflow-x-auto" role="group" aria-label="Date range">
              {RANGES.map(r => (
                <button key={r.v} type="button" onClick={() => setDays(r.v)} aria-pressed={days === r.v}
                  className={`seg-item ${days === r.v ? "seg-item-active" : ""}`}>
                  {r.l}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-auto">
        <div className="p-4 md:p-6 flex flex-col gap-5">
          {q.error ? (
            <div className="text-[13px] text-danger-fg">Couldn&apos;t load extension data: {q.error} <button onClick={() => void q.reload()} className="link ml-2 text-[13px]">Retry</button></div>
          ) : !d || !t ? (
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">{[0, 1, 2, 3].map(i => <div key={i} className="skeleton h-24 rounded-xl" />)}</div>
          ) : (<>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <Stat label="Extension users" value={n(t.users)} sub={t.shareOfUsersPct != null ? `${t.shareOfUsersPct}% of ${n(t.totalUsers)} users · all time` : "all time"} />
              <Stat label="Active users" value={n(t.activeInRange)} sub={`${rangeLabel} · ${n(t.active7)} in last 7 days`} />
              <Stat label="Jobs saved" value={n(t.jobsInRange)} sub={days === "3650" ? "all time" : `${rangeLabel} · ${n(t.jobsAllTime)} all time`} />
              <Stat label="Reached interview" value={n(t.interviewsInRange)} sub={`${n(t.respondedInRange)} got a response`} tone={t.interviewsInRange ? "var(--success-fg)" : undefined} />
            </div>

            <Block title={chart?.weekly ? "Jobs saved per week" : "Jobs saved per day"}>
              {chart && chart.labels.length > 1 && t.jobsInRange > 0 ? (
                <div className="px-2 pt-2">
                  <LineChart data={[chart.jobs, chart.users]} labels={chart.labels} h={200} area smooth={false} />
                  <div className="flex gap-4 px-3 pb-3 text-[11px] text-fg-4">
                    <span className="inline-flex items-center gap-1.5"><span className="w-2.5 h-0.5 bg-brand rounded-full" />Jobs saved</span>
                    <span className="inline-flex items-center gap-1.5"><span className="w-2.5 h-0.5 bg-success rounded-full" />Active users</span>
                  </div>
                </div>
              ) : <Empty>No jobs saved through the extension {rangeLabel}</Empty>}
            </Block>

            <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
              <Block title="Where they use it" count={d.platforms.length || undefined}>
                <Bars items={d.platforms.map(p => ({ label: p.platform, value: p.jobs, right: <>{n(p.jobs)} job{p.jobs === 1 ? "" : "s"} · {n(p.users)} user{p.users === 1 ? "" : "s"}</> }))} />
              </Block>
              <Block title="Status of saved jobs">
                <Bars items={d.statuses.map(s => ({ label: human(s.status) ?? s.status, value: s.n, right: <span style={{ color: STATUS_COLOR[s.status] }}>{n(s.n)}</span> }))} />
              </Block>
            </div>

            {(d.upsell.shown + d.upsell.clicked + d.upsell.dismissed) > 0 && (
              <Block title="Pro prompt in the extension">
                <div className="px-4 py-3 text-[13px] text-fg-2">
                  Shown {n(d.upsell.shown)} · dismissed {n(d.upsell.dismissed)} · clicked <span className="text-success-fg">{n(d.upsell.clicked)}</span>
                  {d.upsell.shown > 0 && <span className="text-fg-4"> · {Math.round((100 * d.upsell.clicked) / d.upsell.shown)}% click-through</span>}
                </div>
              </Block>
            )}

            <UsersBlock users={d.users} token={token} />

            <Note>
              <b className="text-fg-3 font-medium">How this is measured.</b>{" "}An extension user is anyone who saved at least one job through it.
              The extension signs in with the user&apos;s normal session, so installing or connecting it isn&apos;t recorded, and neither are job analyses or auto-apply runs.
              Saves are recognised by the platform label the extension writes (LinkedIn, Greenhouse, Ashby, Workday…); a job typed into the tracker by hand with the exact same label would also count.
            </Note>
          </>)}
        </div>
      </div>
    </div>
  );
}

// ─── Users + per-user activity ────────────────────────────────────────────────

function UsersBlock({ users, token }: { users: ExtUser[]; token: string }) {
  const [open, setOpen] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const list = users.filter(u => !search.trim() || `${u.name ?? ""} ${u.email ?? ""}`.toLowerCase().includes(search.toLowerCase()));
  return (
    <Block title="Users" count={users.length}
      action={users.length > 5 ? (
        <div className="relative w-44">
          <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-fg-4 pointer-events-none" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" />
          </svg>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search users…" aria-label="Search users"
            className="field field-sm w-full pl-8" />
        </div>
      ) : undefined}>
      {list.length === 0 ? <Empty>{users.length ? "No users match" : "No one has saved a job through the extension yet"}</Empty> : (
        <ul className="divide-y divide-line-soft">
          {list.map(u => (
            <Fragment key={u.id}>
              <li>
                <button onClick={() => setOpen(o => o === u.id ? null : u.id)} aria-expanded={open === u.id}
                  className={`w-full text-left px-4 py-3 border-0 cursor-pointer transition-colors grid grid-cols-[1fr_auto] md:grid-cols-[minmax(0,2fr)_minmax(0,1.4fr)_auto] gap-x-4 gap-y-1 items-center ${open === u.id ? "bg-active" : "bg-transparent hover:bg-hover"}`}>
                  <span className="min-w-0">
                    <span className="block text-[13px] text-fg-2 truncate">{u.name ?? u.email ?? u.id.slice(0, 8)} <span className="badge badge-neutral ml-1.5 align-middle">{human(u.plan)}</span></span>
                    <span className="block text-[12px] text-fg-4 truncate">{u.email}</span>
                  </span>
                  <span className="hidden md:block text-[12px] text-fg-3 truncate">{u.platforms.map(p => `${p.name} ${p.n}`).join(" · ")}</span>
                  <span className="text-right">
                    <span className="block text-[13px] text-fg num">{n(u.jobs)} job{u.jobs === 1 ? "" : "s"}{u.interviews ? <span className="text-success-fg"> · {u.interviews} interview{u.interviews === 1 ? "" : "s"}</span> : null}</span>
                    <span className="block text-[12px] text-fg-4" title={`First used ${when(u.firstUsedAt)} · last used ${when(u.lastUsedAt)}`}>last used {ago(u.lastUsedAt)}</span>
                  </span>
                </button>
              </li>
              {open === u.id && <li className="bg-subtle"><UserActivity user={u} token={token} /></li>}
            </Fragment>
          ))}
        </ul>
      )}
    </Block>
  );
}

function UserActivity({ user, token }: { user: ExtUser; token: string }) {
  const q = useAdmin<Activity>(`action=extension_user&id=${encodeURIComponent(user.id)}`, token);
  if (q.error) return <div className="px-4 py-3 text-[12px] text-danger-fg">Couldn&apos;t load activity: {q.error}</div>;
  if (!q.data) return <div className="px-4 py-3"><div className="skeleton h-20 rounded-lg" /></div>;
  // One timeline: saved jobs and Pro-prompt events, newest first.
  const items = [
    ...q.data.jobs.map(j => ({ at: j.savedAt, kind: "job" as const, j })),
    ...q.data.upsell.map(e => ({ at: e.at, kind: "upsell" as const, e })),
  ].sort((a, b) => b.at.localeCompare(a.at));
  return (
    <div className="px-4 py-4 flex flex-col gap-3">
      <div className="text-[12px] text-fg-4">
        First used {when(user.firstUsedAt)} · last used {when(user.lastUsedAt)} · {n(user.jobs)} job{user.jobs === 1 ? "" : "s"} saved
      </div>
      <ol className="relative border-l border-line ml-1.5 flex flex-col gap-3.5">
        {items.map((it, i) => (
          <li key={i} className="pl-4 relative">
            <span className="absolute -left-1.25 top-1.5 w-2.5 h-2.5 rounded-full border-2 border-line"
              style={{ background: it.kind === "upsell" ? "#a855f7" : STATUS_COLOR[it.j.status ?? ""] ?? "var(--fg-3)" }} />
            {it.kind === "job" ? (
              <>
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-[13px] text-fg-2 min-w-0 truncate">
                    Saved {it.j.url ? <a href={it.j.url} target="_blank" rel="noopener noreferrer" className="text-fg-2 underline decoration-line-hover underline-offset-2 hover:decoration-fg-3">{it.j.title ?? "a job"}</a> : (it.j.title ?? "a job")}
                    {it.j.company ? <span className="text-fg-3"> at {it.j.company}</span> : null}
                  </span>
                  <time dateTime={it.at} className="shrink-0 text-[11px] text-fg-4 num">{when(it.at)}</time>
                </div>
                <div className="text-[12px] text-fg-4 mt-0.5">
                  {[it.j.platform, human(it.j.status),
                    it.j.firstResponseAt ? `response ${day(it.j.firstResponseAt)}` : null,
                    it.j.reachedInterviewAt ? `interview ${day(it.j.reachedInterviewAt)}` : null].filter(Boolean).join(" · ")}
                </div>
              </>
            ) : (
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-[13px] text-fg-2">Pro prompt {it.e.event}<span className="text-fg-4"> · {human(it.e.variant)}</span></span>
                <time dateTime={it.at} className="shrink-0 text-[11px] text-fg-4 num">{when(it.at)}</time>
              </div>
            )}
          </li>
        ))}
      </ol>
      {q.data.jobs.length >= 200 && <Note>Showing the 200 most recent saves.</Note>}
    </div>
  );
}
