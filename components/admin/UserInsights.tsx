// components/admin/UserInsights.tsx
// The read-only "everything about this user" panels on the user page:
// Overview, Job search, Activity and Support, plus the About card on Profile.
// Data comes from /api/admin?action=user_360 (lib/user-360.ts) in one request.
"use client";
import { ReactNode, useCallback, useEffect, useState } from "react";
import type { User360 } from "@/lib/user-360";
import { User, fmt, fmtFull, daysAgo, Chip } from "./admin-shared";
import { Block, Empty, Stat, Table, Pill, Muted, dash, human, Primary } from "./ui-kit";

// ─── Data hook ────────────────────────────────────────────────────────────────

export function useUser360(userId: string, token: string) {
  const [data, setData]   = useState<User360 | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const res  = await fetch(`/api/admin?action=user_360&id=${encodeURIComponent(userId)}`, { headers: { "x-admin-token": token }, cache: "no-store" });
      const json = await res.json() as User360 & { error?: string };
      if (!res.ok || json.error) throw new Error(json.error ?? `HTTP ${res.status}`);
      setData(json);
    } catch (e) { setError((e as Error).message); }
    setLoading(false);
  }, [userId, token]);
  useEffect(() => { void Promise.resolve().then(load); }, [load]);
  return { data, error, loading, reload: load };
}

const money = (usd: number) => usd >= 100 ? `$${usd.toFixed(0)}` : `$${usd.toFixed(2)}`;
const cents = (c?: number | null) => c == null ? null : `$${(c / 100).toFixed(2)}`;
const scoreTone = (s?: number | null) => s == null ? undefined : s >= 75 ? "#3ecf8e" : s >= 55 ? "#f5a623" : "#f55";

function Loading() {
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">{Array.from({ length: 4 }).map((_, i) => <div key={i} className="skeleton h-20 rounded-xl" />)}</div>
      <div className="skeleton h-40 rounded-xl" /><div className="skeleton h-56 rounded-xl" />
    </div>
  );
}

function Failed({ error, retry }: { error: string; retry: () => void }) {
  return (
    <div className="flex items-center justify-between gap-3 px-4 py-3 rounded-xl border border-[rgba(255,68,68,0.2)] bg-[rgba(255,68,68,0.05)]">
      <span className="text-[13px] text-[#f55]">Couldn&apos;t load this user&apos;s data: {error}</span>
      <button onClick={retry} className="text-[12px] font-medium text-[#f55] border border-[rgba(255,68,68,0.3)] bg-transparent rounded-md px-2.5 py-1 cursor-pointer">Retry</button>
    </div>
  );
}

type PanelProps = { user: User; d: User360 | null; loading: boolean; error: string; reload: () => void; token?: string };
function Guard({ d, loading, error, reload, children }: Omit<PanelProps, "user" | "token"> & { children: (d: User360) => ReactNode }) {
  if (error) return <Failed error={error} retry={reload} />;
  if (loading || !d) return <Loading />;
  return <>{children(d)}</>;
}

// ─── Signals (rule-based, the things a PM would point out) ────────────────────

function signals(user: User, d: User360): { tone: "warn" | "good" | "info"; text: string }[] {
  const s = d.stats, out: { tone: "warn" | "good" | "info"; text: string }[] = [];
  const idleDays = s.lastSeenAt ? Math.floor((Date.now() - Date.parse(s.lastSeenAt)) / 86_400_000) : null;
  if (s.openTickets) out.push({ tone: "warn", text: `${s.openTickets} open support ticket${s.openTickets > 1 ? "s" : ""} — check the Support tab` });
  if (d.flags.some(f => f.status === "open" || f.status === "reviewing")) out.push({ tone: "warn", text: "Account is flagged for review" });
  if (d.refunds.some(r => r.status === "pending")) out.push({ tone: "warn", text: "Refund request waiting for a decision" });
  if (idleDays != null && idleDays >= 14) out.push({ tone: "warn", text: `Hasn't been seen in ${idleDays} days — churn risk` });
  if (s.applied >= 10 && (s.responseRate ?? 0) === 0) out.push({ tone: "warn", text: `${s.applied} applications, no responses yet — resume or targeting may need work` });
  if (s.avgInterviewScore != null && s.avgInterviewScore < 60) out.push({ tone: "warn", text: `Average mock interview score is ${s.avgInterviewScore} — a good candidate for coaching content` });
  if (!s.resumes && !s.interviews && !s.applications) out.push({ tone: "info", text: "Hasn't used any core feature yet — not activated" });
  else if (!s.resumes) out.push({ tone: "info", text: "No resume uploaded yet" });
  if (s.interviewsLanded) out.push({ tone: "good", text: `Landed ${s.interviewsLanded} real interview${s.interviewsLanded > 1 ? "s" : ""} from tracked applications` });
  if (user.student?.status === "claimed") out.push({ tone: "good", text: "Verified student who claimed the free month" });
  if ((user.subscription?.plan ?? "free") === "free" && s.resumes + s.interviews >= 5) out.push({ tone: "info", text: "Engaged free user — upgrade candidate" });
  return out.slice(0, 6);
}

// ─── Overview ─────────────────────────────────────────────────────────────────

const KIND_COLOR: Record<string, string> = {
  account: "#ededed", session: "#555", resume: "#0070f3", interview: "#f5a623", application: "#3ecf8e", cover_letter: "#38bdf8",
  debrief: "#a855f7", support: "#f472b6", feedback: "#c084fc", email: "#888", billing: "#3ecf8e", risk: "#f55",
};

export function OverviewPanel({ user, d, loading, error, reload }: PanelProps) {
  return (
    <Guard d={d} loading={loading} error={error} reload={reload}>
      {d => {
        const s = d.stats;
        // The ledger knows about student claims; the 360 loader only sees subscriptions.
        const milestones = d.milestones.map(m => m.key === "paid" && !m.at && user.student?.claimedAt
          ? { ...m, label: "Claimed student offer", at: user.student.claimedAt } : m);
        const reached = milestones.filter(m => m.at).length;
        const sig = signals(user, d);
        const maxFeat = Math.max(1, ...d.features.map(f => f.views + f.clicks));
        return (
          <div className="flex flex-col gap-7">
            {/* Key numbers */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <Stat label="Last seen" value={s.lastSeenAt ? daysAgo(s.lastSeenAt) : "—"} sub={`${s.activeSessions} active device${s.activeSessions === 1 ? "" : "s"}`} />
              <Stat label="Resumes" value={s.resumes} sub={s.bestResumeScore != null ? `best score ${s.bestResumeScore}` : "none analysed"} />
              <Stat label="Mock interviews" value={s.interviews} sub={s.avgInterviewScore != null ? `avg score ${s.avgInterviewScore}` : `${s.completedInterviews} completed`} tone={undefined} />
              <Stat label="Applications" value={s.applications} sub={s.responseRate != null ? `${s.responseRate}% response rate` : "none tracked"} />
              <Stat label="Support" value={s.tickets} sub={s.openTickets ? `${s.openTickets} open` : "no open tickets"} tone={s.openTickets ? "#f5a623" : undefined} />
              <Stat label="AI interview cost" value={money(s.aiCostUsd)} sub="Vapi voice calls" />
              <Stat label="Emails" value={s.emailsSent} sub={s.emailsSent ? `${s.emailsOpened} opened` : "none sent"} />
              <Stat label="Active days" value={s.activeDays30} sub="last 30 days" />
            </div>

            {/* Signals */}
            {sig.length > 0 && (
              <Block title="Signals">
                <ul className="divide-y divide-[#0f0f0f]">
                  {sig.map((x, i) => (
                    <li key={i} className="flex items-start gap-3 px-4 py-2.5">
                      <span className="mt-1.5 w-1.5 h-1.5 rounded-full shrink-0" style={{ background: x.tone === "warn" ? "#f5a623" : x.tone === "good" ? "#3ecf8e" : "#555" }} />
                      <span className="text-[13px] text-[#bbb] leading-relaxed">{x.text}</span>
                    </li>
                  ))}
                </ul>
              </Block>
            )}

            {/* Lifecycle */}
            <Block title="Lifecycle" count={`${reached} of ${milestones.length}`}>
              <ol className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-px bg-[#0f0f0f]">
                {milestones.map(m => (
                  <li key={m.key} className="flex items-center gap-3 px-4 py-3 bg-[#0a0a0a]">
                    <span className={`w-5 h-5 rounded-full shrink-0 flex items-center justify-center border ${m.at ? "bg-[rgba(62,207,142,0.12)] border-[rgba(62,207,142,0.35)] text-[#3ecf8e]" : "border-[#2a2a2a] text-transparent"}`}>
                      <svg width="10" height="10" fill="none" stroke="currentColor" strokeWidth="3" viewBox="0 0 24 24" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>
                    </span>
                    <div className="min-w-0">
                      <div className={`text-[13px] truncate ${m.at ? "text-[#ddd]" : "text-[#555]"}`}>{m.label}</div>
                      <div className="text-[12px] text-[#555]">{m.at ? fmt(m.at) : "Not yet"}</div>
                    </div>
                  </li>
                ))}
              </ol>
            </Block>

            <div className="grid grid-cols-1 xl:grid-cols-5 gap-7">
              {/* Recent activity */}
              <div className="xl:col-span-3 min-w-0">
                <Block title="Recent activity" count={d.timeline.length > 12 ? `12 of ${d.timeline.length}` : d.timeline.length}>
                  {d.timeline.length ? (
                    <ul className="divide-y divide-[#0f0f0f]">
                      {d.timeline.slice(0, 12).map((t, i) => (
                        <li key={i} className="flex items-start gap-3 px-4 py-2.5">
                          <span className="mt-1.5 w-1.5 h-1.5 rounded-full shrink-0" style={{ background: KIND_COLOR[t.kind] ?? "#555" }} />
                          <div className="flex-1 min-w-0">
                            <div className="text-[13px] text-[#ccc] truncate">{t.title}</div>
                            {t.detail && <div className="text-[12px] text-[#555] truncate">{t.detail}</div>}
                          </div>
                          <time className="text-[12px] text-[#555] whitespace-nowrap shrink-0" title={fmtFull(t.at)} dateTime={t.at}>{daysAgo(t.at)}</time>
                        </li>
                      ))}
                    </ul>
                  ) : <Empty>No activity yet</Empty>}
                </Block>
              </div>

              {/* Engagement */}
              <div className="xl:col-span-2 min-w-0">
                <Block title="Engagement by feature">
                  {d.features.length ? (
                    <ul className="px-4 py-3 flex flex-col gap-2.5">
                      {d.features.slice(0, 8).map(f => (
                        <li key={f.feature} className="flex items-center gap-3">
                          <span className="w-24 shrink-0 text-[12px] text-[#888] capitalize truncate">{f.feature.replace(/[-_]/g, " ")}</span>
                          <span className="flex-1 h-1.5 rounded-full bg-[#141414] overflow-hidden">
                            <span className="block h-full rounded-full bg-[#ededed]" style={{ width: `${Math.round(((f.views + f.clicks) / maxFeat) * 100)}%`, opacity: 0.75 }} />
                          </span>
                          <span className="w-16 shrink-0 text-right text-[12px] text-[#666] tabular-nums">{f.views + f.clicks}</span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <div className="px-4 py-3 flex flex-col gap-2">
                      {([["Resumes", s.resumes], ["Mock interviews", s.interviews], ["Job tracker", s.applications], ["Cover letters", s.coverLetters], ["LinkedIn", s.linkedin], ["Outreach", s.outreach], ["Contact searches", s.contactSearches]] as [string, number][])
                        .map(([l, v]) => (
                          <div key={l} className="flex items-center justify-between text-[12px]"><span className="text-[#888]">{l}</span><span className="text-[#ccc] tabular-nums">{v}</span></div>
                        ))}
                      <p className="text-[11px] text-[#444] mt-1">No click analytics for this user yet — showing totals from their data.</p>
                    </div>
                  )}
                </Block>
              </div>
            </div>
          </div>
        );
      }}
    </Guard>
  );
}

// ─── Job search ───────────────────────────────────────────────────────────────

export function JobSearchPanel(p: PanelProps) {
  return (
    <Guard {...p}>
      {d => {
        const s = d.stats;
        return (
          <div className="flex flex-col gap-7">
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <Stat label="Applied" value={s.applied} sub={`${s.applications} tracked`} />
              <Stat label="Response rate" value={s.responseRate != null ? `${s.responseRate}%` : "—"} sub={`${s.interviewsLanded} reached interview`} />
              <Stat label="Avg interview score" value={s.avgInterviewScore ?? "—"} sub={`${s.completedInterviews} of ${s.interviews} completed`} tone={scoreTone(s.avgInterviewScore)} />
              <Stat label="Best resume score" value={s.bestResumeScore ?? "—"} sub={`${s.resumes} resume${s.resumes === 1 ? "" : "s"}`} tone={scoreTone(s.bestResumeScore)} />
            </div>

            {s.extensionJobs > 0 && (
              <p className="text-[12px] text-[#888] -mt-3">
                Uses the Chrome extension · <span className="text-[#ededed]">{s.extensionJobs}</span> job{s.extensionJobs === 1 ? "" : "s"} saved with it
                {s.extensionLastAt ? <> · last used <span title={fmtFull(s.extensionLastAt)}>{daysAgo(s.extensionLastAt)}</span></> : null}
              </p>
            )}

            <Block title="Applications" count={d.applications.length}>
              <Table rows={d.applications} rowKey={a => a.id} empty="No jobs in the tracker yet" cols={[
                { label: "Role", cell: a => <Primary sub={[a.company, a.location, a.workType].filter(Boolean).join(" · ") || undefined}>
                    {a.jobUrl ? <a href={a.jobUrl} target="_blank" rel="noreferrer" className="hover:underline text-[#ddd]">{a.jobTitle || "Untitled role"}</a> : (a.jobTitle || "Untitled role")}
                  </Primary> },
                { label: "Status", cell: a => <Pill status={a.status} /> },
                { label: "Applied", hide: "sm", cell: a => a.appliedDate ? fmt(a.appliedDate) : dash },
                { label: "Response", hide: "md", cell: a => a.reachedInterviewAt ? <span className="text-[#3ecf8e]">Interview · {fmt(a.reachedInterviewAt)}</span> : a.firstResponseAt ? fmt(a.firstResponseAt) : dash },
                { label: "Source", hide: "lg", cell: a => a.viaExtension ? <span title="Saved with the Chrome extension">Extension · {a.viaExtension}</span> : human(a.source) ?? dash },
                { label: "Updated", hide: "lg", cell: a => <span title={fmtFull(a.updatedAt)}>{daysAgo(a.updatedAt)}</span> },
              ]} />
            </Block>

            <Block title="Mock interviews" count={d.interviews.length}>
              <Table rows={d.interviews} rowKey={i => i.id} empty="No mock interviews yet" cols={[
                { label: "Interview", cell: i => <Primary sub={[i.type, i.level, i.company].filter(Boolean).join(" · ") || undefined}>{i.role || "Interview"}</Primary> },
                { label: "Status", cell: i => <span title={i.abandonedReason ?? undefined}><Pill status={i.status} /></span> },
                { label: "Score", cell: i => i.score != null ? <span className="font-semibold tabular-nums" style={{ color: scoreTone(i.score) }}>{i.score}</span> : dash },
                { label: "Call", hide: "md", cell: i => i.callSeconds ? `${Math.round(i.callSeconds / 60)} min · ${money(i.costUsd ?? 0)}` : dash },
                { label: "Date", hide: "sm", cell: i => <span title={fmtFull(i.createdAt)}>{fmt(i.createdAt)}</span> },
              ]} />
            </Block>

            <Block title="Resumes" count={d.resumes.length}>
              <Table rows={d.resumes} rowKey={r => r.id} empty="No resumes uploaded" cols={[
                { label: "Resume", cell: r => <Primary sub={r.fileName ?? undefined}>{r.title}</Primary> },
                { label: "Score", cell: r => r.score != null ? <span className="font-semibold tabular-nums" style={{ color: scoreTone(r.score) }}>{r.score}</span> : <Pill status={r.status} /> },
                { label: "Analyses", hide: "md", cell: r => r.extras.length ? <div className="flex flex-wrap gap-1">{r.extras.map(x => <span key={x} className="text-[11px] text-[#888] border border-[#1f1f1f] rounded px-1.5 py-px">{x}</span>)}</div> : dash },
                { label: "Uploaded", hide: "sm", cell: r => <span title={fmtFull(r.createdAt)}>{fmt(r.createdAt)}</span> },
              ]} />
            </Block>

            {d.tailored.length > 0 && (
              <Block title="Tailored resumes" count={d.tailored.length}>
                <Table rows={d.tailored} rowKey={(t, i) => String(t.id ?? i)} empty="" cols={[
                  { label: "For", cell: t => <Primary>{String(t.title)}</Primary> },
                  { label: "ATS score", cell: t => t.before != null || t.after != null
                      ? <span className="tabular-nums">{String(t.before ?? "—")} <Muted>→</Muted> <span className="text-[#3ecf8e] font-semibold">{String(t.after ?? "—")}</span></span> : dash },
                  { label: "Created", hide: "sm", cell: t => fmt(t.createdAt as string) },
                ]} />
              </Block>
            )}

            <div className="grid grid-cols-1 2xl:grid-cols-2 gap-7">
              <Block title="Cover letters" count={d.coverLetters.length}>
                <Table rows={d.coverLetters} rowKey={(c, i) => String(c.id ?? i)} empty="No cover letters" cols={[
                  { label: "Role", cell: c => <Primary sub={(c.company as string) ?? undefined}>{String(c.role ?? "Cover letter")}</Primary> },
                  { label: "Words", hide: "sm", cell: c => c.words != null ? String(c.words) : dash },
                  { label: "Date", cell: c => fmt(c.createdAt as string) },
                ]} />
              </Block>
              <Block title="Interview debriefs" count={d.debriefs.length}>
                <Table rows={d.debriefs} rowKey={(x, i) => String(x.id ?? i)} empty="No debriefs logged" cols={[
                  { label: "Interview", cell: x => <Primary sub={[x.company, x.stage].filter(Boolean).join(" · ") || undefined}>{String(x.role ?? "Interview")}</Primary> },
                  { label: "Outcome", cell: x => <Pill status={x.outcome as string | null} /> },
                  { label: "Self score", hide: "sm", cell: x => x.selfScore != null ? String(x.selfScore) : dash },
                ]} />
              </Block>
            </div>

            <Block title="Study plans & networking">
              <div className="grid grid-cols-2 md:grid-cols-5 divide-x divide-y md:divide-y-0 divide-[#0f0f0f]">
                {([
                  ["Study plans", s.plans, d.plans[0]?.createdAt as string | undefined],
                  ["LinkedIn optimisations", s.linkedin, s.linkedinLastAt],
                  ["Outreach messages", s.outreach, s.outreachLastAt],
                  ["Contact searches", s.contactSearches, undefined],
                  ["Job analyses", s.jobAnalyses, undefined],
                ] as [string, number, string | null | undefined][]).map(([l, v, last]) => (
                  <div key={l} className="px-4 py-3 min-w-0">
                    <div className="text-[11px] text-[#555] uppercase tracking-wider truncate">{l}</div>
                    <div className="text-[18px] font-semibold text-[#ededed] tabular-nums mt-0.5">{v}</div>
                    {last && <div className="text-[12px] text-[#555]">last {daysAgo(last)}</div>}
                  </div>
                ))}
              </div>
            </Block>
          </div>
        );
      }}
    </Guard>
  );
}

// ─── Activity ─────────────────────────────────────────────────────────────────

export function ActivityPanel(p: PanelProps) {
  const [revoking, setRevoking] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function signOutEverywhere() {
    if (!confirm(`Sign ${p.user.name ?? p.user.email} out of every device? They'll need to sign in again.`)) return;
    setRevoking(true); setMsg(null);
    try {
      const res  = await fetch("/api/admin", { method: "POST", headers: { "Content-Type": "application/json", "x-admin-token": p.token ?? "" }, body: JSON.stringify({ action: "revoke_sessions", id: p.user.id }) });
      const json = await res.json() as { revoked?: number; error?: string };
      if (!res.ok || json.error) throw new Error(json.error ?? `HTTP ${res.status}`);
      setMsg({ ok: true, text: `Signed out of ${json.revoked ?? 0} session${json.revoked === 1 ? "" : "s"}` });
      p.reload();
    } catch (e) { setMsg({ ok: false, text: (e as Error).message }); }
    setRevoking(false);
  }

  return (
    <Guard {...p}>
      {d => {
        const active = d.sessions.filter(s => !s.revokedAt);
        const prefs = d.profile.emailPrefs;
        return (
          <div className="flex flex-col gap-7">
            <Block title="Devices" count={`${active.length} active`} action={
              <div className="flex items-center gap-3">
                {msg && <span className={`text-[12px] ${msg.ok ? "text-[#3ecf8e]" : "text-[#f55]"}`}>{msg.text}</span>}
                <button onClick={signOutEverywhere} disabled={revoking || !active.length}
                  className="h-7 px-2.5 rounded-md border border-[#2a2a2a] bg-transparent text-[12px] font-medium text-[#888] cursor-pointer hover:text-[#f55] hover:border-[rgba(255,68,68,0.3)] disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
                  {revoking ? "Signing out…" : "Sign out everywhere"}
                </button>
              </div>
            }>
              <Table rows={d.sessions} rowKey={s => s.id} empty="No sessions recorded" cols={[
                { label: "Device", cell: s => <Primary sub={[s.os, s.device].filter(v => v && v !== "Unknown").join(" · ") || undefined}>{s.browser === "Unknown" ? "Browser" : s.browser}</Primary> },
                { label: "Location", hide: "sm", cell: s => <Primary sub={s.ip ?? undefined}>{[s.city, s.country].filter(Boolean).join(", ") || "—"}</Primary> },
                { label: "Signed in", hide: "md", cell: s => <span title={fmtFull(s.createdAt)}>{fmt(s.createdAt)}</span> },
                { label: "Last seen", cell: s => <span title={fmtFull(s.lastSeenAt)}>{daysAgo(s.lastSeenAt)}</span> },
                { label: "Status", cell: s => s.revokedAt ? <span title={s.revokedReason ?? undefined}><Pill status="revoked" /></span> : <Pill status="active" /> },
              ]} />
            </Block>

            <Block title="Product usage" count={d.features.length ? `${d.features.length} areas` : undefined}>
              <Table rows={d.features} rowKey={f => f.feature} empty="No click analytics for this user yet" cols={[
                { label: "Area", cell: f => <span className="text-[#ddd] capitalize">{f.feature.replace(/[-_]/g, " ")}</span> },
                { label: "Page views", cell: f => <span className="tabular-nums">{f.views}</span> },
                { label: "Clicks", cell: f => <span className="tabular-nums">{f.clicks}</span> },
                { label: "Time", hide: "sm", cell: f => f.timeMs ? `${Math.max(1, Math.round(f.timeMs / 60000))} min` : dash },
                { label: "Last used", hide: "md", cell: f => daysAgo(f.last) },
              ]} />
            </Block>

            <div className="grid grid-cols-1 xl:grid-cols-5 gap-7">
              <div className="xl:col-span-3 min-w-0">
                <Block title="Emails" count={d.emails.length}>
                  <Table rows={d.emails} rowKey={(e, i) => `${e.sentAt}-${i}`} empty="No emails sent to this user" cols={[
                    { label: "Email", cell: e => <Primary sub={human(e.type) ?? undefined}>{e.subject ?? human(e.type)}</Primary> },
                    { label: "Sent", hide: "sm", cell: e => <span title={fmtFull(e.sentAt)}>{daysAgo(e.sentAt)}</span> },
                    { label: "Engagement", cell: e => e.bounced ? <Pill status="rejected" />
                        : <span className="text-[12px]">{e.clicked ? <span className="text-[#3ecf8e]">Clicked</span> : e.opened ? <span className="text-[#0070f3]">Opened</span> : e.delivered ? "Delivered" : <Muted>Sent</Muted>}</span> },
                  ]} />
                </Block>
              </div>
              <div className="xl:col-span-2 min-w-0">
                <Block title="Email preferences">
                  <ul className="divide-y divide-[#0f0f0f]">
                    {([
                      ["Weekly digest", prefs.weeklyDigest, prefs.weeklyDigestSentAt ? `last ${daysAgo(prefs.weeklyDigestSentAt as string)}` : null],
                      ["Activation nudges", prefs.activation, prefs.activationCount ? `${prefs.activationCount} sent${prefs.activationLastStep ? ` · ${prefs.activationLastStep}` : ""}` : null],
                      ["Application updates", prefs.applications, null],
                      ["Welcome email", !!prefs.welcomeSentAt, prefs.welcomeSentAt ? fmt(prefs.welcomeSentAt as string) : "not sent"],
                    ] as [string, boolean, string | null][]).map(([l, on, sub]) => (
                      <li key={l} className="flex items-center justify-between gap-3 px-4 py-2.5">
                        <div className="min-w-0"><div className="text-[13px] text-[#ccc]">{l}</div>{sub && <div className="text-[12px] text-[#555] truncate">{sub}</div>}</div>
                        <span className={`text-[12px] font-medium ${on ? "text-[#3ecf8e]" : "text-[#555]"}`}>{on ? (l === "Welcome email" ? "Sent" : "On") : (l === "Welcome email" ? "—" : "Opted out")}</span>
                      </li>
                    ))}
                  </ul>
                </Block>
              </div>
            </div>

            <Block title="Notifications" count={d.notifications.length}>
              <Table rows={d.notifications} rowKey={(n, i) => String(n.id ?? i)} empty="No notifications" cols={[
                { label: "Notification", cell: n => <Primary sub={human(n.type as string) ?? undefined}>{String(n.title ?? "Notification")}</Primary> },
                { label: "Read", cell: n => n.read ? <Muted>Read</Muted> : <span className="text-[#0070f3] text-[12px] font-medium">Unread</span> },
                { label: "Date", hide: "sm", cell: n => daysAgo(n.createdAt as string) },
              ]} />
            </Block>

            <Block title="Full timeline" count={d.timeline.length}>
              {d.timeline.length ? (
                <ul className="divide-y divide-[#0f0f0f] max-h-[480px] overflow-y-auto">
                  {d.timeline.map((t, i) => (
                    <li key={i} className="flex items-start gap-3 px-4 py-2">
                      <span className="mt-1.5 w-1.5 h-1.5 rounded-full shrink-0" style={{ background: KIND_COLOR[t.kind] ?? "#555" }} />
                      <div className="flex-1 min-w-0"><span className="text-[13px] text-[#ccc]">{t.title}</span>{t.detail && <span className="text-[12px] text-[#555]"> · {t.detail}</span>}</div>
                      <time className="text-[12px] text-[#555] whitespace-nowrap shrink-0" dateTime={t.at}>{fmtFull(t.at)}</time>
                    </li>
                  ))}
                </ul>
              ) : <Empty>No activity yet</Empty>}
            </Block>
          </div>
        );
      }}
    </Guard>
  );
}

// ─── Support ──────────────────────────────────────────────────────────────────

export function SupportPanel(p: PanelProps) {
  return (
    <Guard {...p}>
      {d => (
        <div className="flex flex-col gap-7">
          <Block title="Support tickets" count={d.tickets.length}>
            <Table rows={d.tickets} rowKey={(t, i) => String(t.id ?? i)} empty="No support tickets" cols={[
              { label: "Ticket", cell: t => <Primary sub={(t.category as string) ?? undefined}>
                  <a href={`/?tab=support&ticket=${t.id}`} className="text-[#ddd] hover:underline">{String(t.subject ?? "Untitled")}</a></Primary> },
              { label: "Status", cell: t => <Pill status={t.status as string} /> },
              { label: "Priority", hide: "sm", cell: t => <span className="capitalize">{String(t.priority ?? "—")}</span> },
              { label: "Replies", hide: "md", cell: t => <span className="tabular-nums">{String(t.replies)}{t.lastReplyBy ? <Muted> · last by {String(t.lastReplyBy)}</Muted> : null}</span> },
              { label: "Opened", hide: "sm", cell: t => fmt(t.createdAt as string) },
            ]} />
          </Block>

          <div className="grid grid-cols-1 2xl:grid-cols-2 gap-7">
            <Block title="Surveys" count={d.surveys.length}>
              <Table rows={d.surveys} rowKey={(s, i) => String(s.id ?? i)} empty="No survey responses" cols={[
                { label: "Page", cell: s => <Primary sub={(s.improvement as string) ?? undefined}>{String(s.page)}</Primary> },
                { label: "Rating", cell: s => <span className="tabular-nums">{String(s.rating)}/5</span> },
                { label: "NPS", hide: "sm", cell: s => s.nps != null ? String(s.nps) : dash },
                { label: "Date", hide: "sm", cell: s => fmt(s.createdAt as string) },
              ]} />
            </Block>
            <Block title="Feature ratings" count={d.ratings.length}>
              <Table rows={d.ratings} rowKey={(r, i) => String(r.id ?? i)} empty="No feature ratings" cols={[
                { label: "Feature", cell: r => <Primary sub={(r.comment as string) ?? undefined}>{String(r.feature)}</Primary> },
                { label: "Rating", cell: r => r.rating != null ? `${r.rating}/5` : dash },
                { label: "Date", hide: "sm", cell: r => fmt(r.createdAt as string) },
              ]} />
            </Block>
          </div>

          <div className="grid grid-cols-1 2xl:grid-cols-2 gap-7">
            <Block title="Refund requests" count={d.refunds.length}>
              <Table rows={d.refunds} rowKey={(r, i) => String(r.id ?? i)} empty="No refund requests" cols={[
                { label: "Request", cell: r => <Primary sub={(r.note as string) ?? undefined}>{String(r.reason ?? "Refund request")}</Primary> },
                { label: "Status", cell: r => <Pill status={r.status as string} /> },
                { label: "Amount", hide: "sm", cell: r => cents(r.quotedCents as number | null) ?? dash },
                { label: "Date", hide: "sm", cell: r => fmt(r.createdAt as string) },
              ]} />
            </Block>
            <Block title="Account flags" count={d.flags.length}>
              <Table rows={d.flags} rowKey={(f, i) => String(f.id ?? i)} empty="No flags — account in good standing" cols={[
                { label: "Reason", cell: f => <Primary sub={(f.note as string) ?? undefined}>{String(f.reason).replace(/[-_]/g, " ")}</Primary> },
                { label: "Status", cell: f => <Pill status={f.status as string} /> },
                { label: "Date", hide: "sm", cell: f => fmt(f.createdAt as string) },
              ]} />
            </Block>
          </div>
        </div>
      )}
    </Guard>
  );
}

// ─── About (read-only career profile, shown on the Profile tab) ───────────────

export function AboutCard(p: PanelProps) {
  if (p.error || !p.d) return null;
  const a = p.d.profile;
  const link = (href: unknown, label: string) => {
    if (typeof href !== "string" || !href) return null;
    const url = /^https?:\/\//.test(href) ? href : `https://${href}`;
    return <a href={url} target="_blank" rel="noreferrer" className="text-[13px] text-[#ddd] hover:underline">{label}</a>;
  };
  const rows: [string, ReactNode][] = [
    ["Target role", (a.targetRole as string) || null],
    ["Experience", (a.experienceLevel as string) || null],
    ["Location", a.location],
    ["Phone", a.phone ? <span>{String(a.phone)} {a.phoneVerified ? <span className="text-[#3ecf8e] text-[12px] ml-1">Verified</span> : <span className="text-[#555] text-[12px] ml-1">Unverified</span>}</span> : null],
    ["Links", [link(a.linkedIn, "LinkedIn"), link(a.github, "GitHub"), link(a.website, "Website")].some(Boolean)
      ? <span className="flex gap-3">{link(a.linkedIn, "LinkedIn")}{link(a.github, "GitHub")}{link(a.website, "Website")}</span> : null],
    ["Tech", a.preferredTech.length ? <span className="flex flex-wrap gap-1">{a.preferredTech.map(t => <Chip key={t} label={t} className="border border-[#1f1f1f] text-[#999] text-[11px]" />)}</span> : null],
    ["Career goals", (a.careerGoals as string) || null],
    ["Bio", (a.bio as string) || null],
    ["Files", [a.resumeFile && `Resume: ${a.resumeFile}`, a.transcriptFile && `Transcript: ${a.transcriptFile}`].filter(Boolean).join(" · ") || null],
  ];
  const filled = rows.filter(([, v]) => v);
  return (
    <Block title="Career profile" count={`${filled.length} of ${rows.length} filled`}>
      <dl className="divide-y divide-[#0f0f0f]">
        {rows.map(([l, v]) => (
          <div key={l} className="flex flex-col sm:flex-row sm:items-start gap-1 sm:gap-4 px-4 py-2.5">
            <dt className="sm:w-32 shrink-0 text-[12px] font-medium text-[#555] uppercase tracking-wider pt-0.5">{l}</dt>
            <dd className="flex-1 min-w-0 text-[13px] text-[#ccc] leading-relaxed break-words">{v ?? <Muted>Not provided</Muted>}</dd>
          </div>
        ))}
      </dl>
    </Block>
  );
}
