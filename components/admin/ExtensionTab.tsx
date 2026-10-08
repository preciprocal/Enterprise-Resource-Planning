// components/admin/ExtensionTab.tsx
// Growth → Extension: who uses the Chrome extension, how much, and what each
// person did with it. Data: /api/admin?action=extension (lib/extension-usage.ts).
// An extension user is someone who saved at least one job through it; installs
// and job analyses leave no trace server-side, so they can't be counted.
"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { Select, LineChart } from "./admin-shared";
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
  return <p className="text-[12px] text-[#666] leading-relaxed">{children}</p>;
}

function Bars({ items }: { items: { label: string; value: number; right: React.ReactNode }[] }) {
  if (!items.length) return <Empty>Nothing in this range</Empty>;
  const max = Math.max(...items.map(i => i.value), 1);
  return (
    <ul className="px-4 py-3 flex flex-col gap-2.5">
      {items.map(i => (
        <li key={i.label}>
          <div className="flex items-baseline justify-between gap-3 text-[13px]">
            <span className="text-[#ddd] truncate">{i.label}</span>
            <span className="text-[12px] text-[#888] tabular-nums shrink-0">{i.right}</span>
          </div>
          <span className="mt-1.5 block h-1.5 rounded-full bg-[#141414] overflow-hidden">
            <span className="block h-full rounded-full bg-[#ededed]" style={{ width: `${(100 * i.value) / max}%`, opacity: 0.55 }} />
          </span>
        </li>
      ))}
    </ul>
  );
}

const STATUS_COLOR: Record<string, string> = { applied: "#888", interview: "#0070f3", interviewing: "#0070f3", offer: "#3ecf8e", rejected: "#f44", saved: "#666" };

// ─── Tab ──────────────────────────────────────────────────────────────────────

const RANGES = [{ v: "7", l: "Last 7 days" }, { v: "30", l: "Last 30 days" }, { v: "90", l: "Last 90 days" }, { v: "365", l: "Last 12 months" }, { v: "3650", l: "All time" }];

export default function ExtensionTab({ token }: { token: string }) {
  const [days, setDays] = useState("30");
  const q = useAdmin<Overview>(`action=extension&days=${days}`, token);
  const d = q.data, t = d?.totals;
  const chart = useMemo(() => d ? series(d.saves, d.range.days) : null, [d]);
  const rangeLabel = RANGES.find(r => r.v === days)?.l.toLowerCase() ?? "";

  return (
    <div className="flex-1 flex flex-col min-h-0 min-w-0 bg-black">
      <div className="px-4 md:px-8 pt-6 pb-4 border-b border-[#111] shrink-0">
        <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-3">
          <div>
            <h1 className="text-[20px] font-semibold text-[#ededed] tracking-tight">Chrome extension</h1>
            <p className="text-[13px] text-[#666] mt-1">Who uses it and what they do with it · times in your time zone ({zone()})</p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => void q.reload()} className="h-8 px-3 rounded-md text-[12px] text-[#888] hover:text-[#ededed] bg-transparent border border-[#1a1a1a] cursor-pointer">Refresh</button>
            <Select value={days} onChange={e => setDays(e.target.value)} leading="Range" wrapperClassName="w-auto" className="h-8 text-[12px]" aria-label="Date range">
              {RANGES.map(r => <option key={r.v} value={r.v}>{r.l}</option>)}
            </Select>
          </div>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-auto">
        <div className="px-4 md:px-8 py-6 flex flex-col gap-7">
          {q.error ? (
            <div className="text-[13px] text-[#f44]">Couldn&apos;t load extension data: {q.error} <button onClick={() => void q.reload()} className="ml-2 text-[#888] underline bg-transparent border-none cursor-pointer">Retry</button></div>
          ) : !d || !t ? (
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">{[0, 1, 2, 3].map(i => <div key={i} className="skeleton h-24 rounded-xl" />)}</div>
          ) : (<>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <Stat label="Extension users" value={n(t.users)} sub={t.shareOfUsersPct != null ? `${t.shareOfUsersPct}% of ${n(t.totalUsers)} users · all time` : "all time"} />
              <Stat label="Active users" value={n(t.activeInRange)} sub={`${rangeLabel} · ${n(t.active7)} in last 7 days`} />
              <Stat label="Jobs saved" value={n(t.jobsInRange)} sub={days === "3650" ? "all time" : `${rangeLabel} · ${n(t.jobsAllTime)} all time`} />
              <Stat label="Reached interview" value={n(t.interviewsInRange)} sub={`${n(t.respondedInRange)} got a response`} tone={t.interviewsInRange ? "#3ecf8e" : undefined} />
            </div>

            <Block title={chart?.weekly ? "Jobs saved per week" : "Jobs saved per day"}>
              {chart && chart.labels.length > 1 && t.jobsInRange > 0 ? (
                <div className="px-2 pt-2">
                  <LineChart data={[chart.jobs, chart.users]} labels={chart.labels} h={200} area smooth={false} />
                  <div className="flex gap-4 px-3 pb-3 text-[11px] text-[#666]">
                    <span className="inline-flex items-center gap-1.5"><span className="w-2.5 h-0.5 bg-[#0070f3] rounded" />Jobs saved</span>
                    <span className="inline-flex items-center gap-1.5"><span className="w-2.5 h-0.5 bg-[#3ecf8e] rounded" />Active users</span>
                  </div>
                </div>
              ) : <Empty>No jobs saved through the extension {rangeLabel}</Empty>}
            </Block>

            <div className="grid grid-cols-1 xl:grid-cols-2 gap-7">
              <Block title="Where they use it" count={d.platforms.length || undefined}>
                <Bars items={d.platforms.map(p => ({ label: p.platform, value: p.jobs, right: <>{n(p.jobs)} job{p.jobs === 1 ? "" : "s"} · {n(p.users)} user{p.users === 1 ? "" : "s"}</> }))} />
              </Block>
              <Block title="Status of saved jobs">
                <Bars items={d.statuses.map(s => ({ label: human(s.status) ?? s.status, value: s.n, right: <span style={{ color: STATUS_COLOR[s.status] }}>{n(s.n)}</span> }))} />
              </Block>
            </div>

            {(d.upsell.shown + d.upsell.clicked + d.upsell.dismissed) > 0 && (
              <Block title="Pro prompt in the extension">
                <div className="px-4 py-3 text-[13px] text-[#bbb]">
                  Shown {n(d.upsell.shown)} · dismissed {n(d.upsell.dismissed)} · clicked <span className="text-[#3ecf8e]">{n(d.upsell.clicked)}</span>
                  {d.upsell.shown > 0 && <span className="text-[#666]"> · {Math.round((100 * d.upsell.clicked) / d.upsell.shown)}% click-through</span>}
                </div>
              </Block>
            )}

            <UsersBlock users={d.users} token={token} />

            <Note>
              <b className="text-[#999] font-medium">How this is measured.</b>{" "}An extension user is anyone who saved at least one job through it.
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
      action={users.length > 5 ? <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search users…" aria-label="Search users"
        className="h-7 w-44 px-2.5 rounded-md text-[12px] bg-[#0a0a0a] border border-[#1a1a1a] text-[#ededed] placeholder:text-[#444] outline-none focus:border-[#333]" /> : undefined}>
      {list.length === 0 ? <Empty>{users.length ? "No users match" : "No one has saved a job through the extension yet"}</Empty> : (
        <ul className="divide-y divide-[#111]">
          {list.map(u => (
            <Fragment key={u.id}>
              <li>
                <button onClick={() => setOpen(o => o === u.id ? null : u.id)} aria-expanded={open === u.id}
                  className={`w-full text-left px-4 py-3 border-none cursor-pointer transition-colors grid grid-cols-[1fr_auto] md:grid-cols-[minmax(0,2fr)_minmax(0,1.4fr)_auto] gap-x-4 gap-y-1 items-center ${open === u.id ? "bg-[#111]" : "bg-transparent hover:bg-[#0d0d0d]"}`}>
                  <span className="min-w-0">
                    <span className="block text-[13px] text-[#ddd] truncate">{u.name ?? u.email ?? u.id.slice(0, 8)} <span className="ml-1 text-[11px] text-[#666]">{human(u.plan)}</span></span>
                    <span className="block text-[12px] text-[#555] truncate">{u.email}</span>
                  </span>
                  <span className="hidden md:block text-[12px] text-[#777] truncate">{u.platforms.map(p => `${p.name} ${p.n}`).join(" · ")}</span>
                  <span className="text-right">
                    <span className="block text-[13px] text-[#ededed] tabular-nums">{n(u.jobs)} job{u.jobs === 1 ? "" : "s"}{u.interviews ? <span className="text-[#3ecf8e]"> · {u.interviews} interview{u.interviews === 1 ? "" : "s"}</span> : null}</span>
                    <span className="block text-[12px] text-[#555]" title={`First used ${when(u.firstUsedAt)} · last used ${when(u.lastUsedAt)}`}>last used {ago(u.lastUsedAt)}</span>
                  </span>
                </button>
              </li>
              {open === u.id && <li className="bg-[#070707]"><UserActivity user={u} token={token} /></li>}
            </Fragment>
          ))}
        </ul>
      )}
    </Block>
  );
}

function UserActivity({ user, token }: { user: ExtUser; token: string }) {
  const q = useAdmin<Activity>(`action=extension_user&id=${encodeURIComponent(user.id)}`, token);
  if (q.error) return <div className="px-4 py-3 text-[12px] text-[#f44]">Couldn&apos;t load activity: {q.error}</div>;
  if (!q.data) return <div className="px-4 py-3"><div className="skeleton h-20 rounded-lg" /></div>;
  // One timeline: saved jobs and Pro-prompt events, newest first.
  const items = [
    ...q.data.jobs.map(j => ({ at: j.savedAt, kind: "job" as const, j })),
    ...q.data.upsell.map(e => ({ at: e.at, kind: "upsell" as const, e })),
  ].sort((a, b) => b.at.localeCompare(a.at));
  return (
    <div className="px-4 py-4 flex flex-col gap-3">
      <div className="text-[12px] text-[#666]">
        First used {when(user.firstUsedAt)} · last used {when(user.lastUsedAt)} · {n(user.jobs)} job{user.jobs === 1 ? "" : "s"} saved
      </div>
      <ol className="relative border-l border-[#1f1f1f] ml-1.5 flex flex-col gap-3.5">
        {items.map((it, i) => (
          <li key={i} className="pl-4 relative">
            <span className="absolute -left-1.25 top-1.5 w-2.5 h-2.5 rounded-full border-2 border-black"
              style={{ background: it.kind === "upsell" ? "#a855f7" : STATUS_COLOR[it.j.status ?? ""] ?? "#888" }} />
            {it.kind === "job" ? (
              <>
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-[13px] text-[#ddd] min-w-0 truncate">
                    Saved {it.j.url ? <a href={it.j.url} target="_blank" rel="noopener noreferrer" className="text-[#ddd] underline decoration-[#333] underline-offset-2 hover:decoration-[#888]">{it.j.title ?? "a job"}</a> : (it.j.title ?? "a job")}
                    {it.j.company ? <span className="text-[#888]"> at {it.j.company}</span> : null}
                  </span>
                  <time dateTime={it.at} className="shrink-0 text-[11px] text-[#666] tabular-nums">{when(it.at)}</time>
                </div>
                <div className="text-[12px] text-[#555] mt-0.5">
                  {[it.j.platform, human(it.j.status),
                    it.j.firstResponseAt ? `response ${day(it.j.firstResponseAt)}` : null,
                    it.j.reachedInterviewAt ? `interview ${day(it.j.reachedInterviewAt)}` : null].filter(Boolean).join(" · ")}
                </div>
              </>
            ) : (
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-[13px] text-[#bbb]">Pro prompt {it.e.event}<span className="text-[#555]"> · {human(it.e.variant)}</span></span>
                <time dateTime={it.at} className="shrink-0 text-[11px] text-[#666] tabular-nums">{when(it.at)}</time>
              </div>
            )}
          </li>
        ))}
      </ol>
      {q.data.jobs.length >= 200 && <Note>Showing the 200 most recent saves.</Note>}
    </div>
  );
}
