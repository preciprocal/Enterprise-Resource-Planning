// components/admin/UserPanels.tsx
// More of the user page, rendered from the same /api/admin?action=user_360
// payload (lib/user-360.ts): Dashboard clickstream, Chrome extension, career
// tools, connected accounts, billing extras, and which sections have data.
// Pure views: UserInsights.tsx wraps them with the loading/error guard.
"use client";
import { Fragment, ReactNode, useState } from "react";
import type { User360 } from "@/lib/user-360";
import { EXT_AUTOFILL_NOTE, EXT_TRACKING_NOTE, extEventLabel } from "@/lib/extension-events";
import { fmt, fmtFull, daysAgo } from "./admin-shared";
import { Block, Empty, Stat, Table, Pill, Muted, dash, human, Primary } from "./ui-kit";

type D = User360;

const mins = (ms: number) => ms < 60_000 ? (ms ? "<1 min" : "0 min") : ms < 3_600_000 ? `${Math.round(ms / 60_000)} min` : `${(ms / 3_600_000).toFixed(1)} h`;
const plural = (n: number, w: string) => `${n.toLocaleString()} ${w}${n === 1 ? "" : "s"}`;
const When = ({ at, full }: { at?: string | null; full?: boolean }) => at
  ? <time dateTime={at} title={fmtFull(at)}>{full ? fmtFull(at) : daysAgo(at)}</time> : dash;
const userHref = (id: string, tab?: string) => `/?tab=users&user=${encodeURIComponent(id)}${tab ? `&utab=${tab}` : ""}`;

function Note({ children }: { children: ReactNode }) {
  return <p className="text-caption leading-relaxed">{children}</p>;
}

function Bars({ items, empty }: { items: { key: string; label: ReactNode; value: number; right: ReactNode }[]; empty: string }) {
  if (!items.length) return <Empty>{empty}</Empty>;
  const max = Math.max(1, ...items.map(i => i.value));
  return (
    <ul className="px-4 py-3 flex flex-col gap-2.5">
      {items.map(i => (
        <li key={i.key}>
          <div className="flex items-baseline justify-between gap-3 text-[13px]">
            <span className="text-fg-2 truncate min-w-0">{i.label}</span>
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

// ─── Dashboard clickstream (Activity tab) ─────────────────────────────────────

function DayStrip({ days }: { days: D["activity"]["days"] }) {
  const score = (x: D["activity"]["days"][number]) => x.timeMs / 60_000 + x.views + x.clicks * 0.5;
  const max = Math.max(1, ...days.map(score));
  const active = days.filter(x => score(x) > 0).length;
  const label = (k: string) => new Date(`${k}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
  return (
    <div className="px-4 py-3">
      <div className="flex items-end gap-px h-16" role="img" aria-label={`Active on ${active} of the last ${days.length} days`}>
        {days.map(x => {
          const s = score(x);
          return (
            <span key={x.day} className="flex-1 min-w-0 h-full flex items-end"
              title={`${label(x.day)}: ${plural(x.views, "page view")}, ${plural(x.clicks, "click")}, ${mins(x.timeMs)}`}>
              <span className={`block w-full rounded-sm ${s ? "bg-brand" : "bg-raised-2"}`}
                style={{ height: s ? `${Math.max(12, (100 * s) / max)}%` : "12%", opacity: s ? 0.35 + 0.65 * (s / max) : 1 }} />
            </span>
          );
        })}
      </div>
      <div className="flex justify-between mt-1.5 text-[11px] text-fg-4 num">
        <span>{days[0] && label(days[0].day)}</span>
        <span>Active {active} of {days.length} days · UTC days</span>
        <span>{days.length > 0 && label(days[days.length - 1].day)}</span>
      </div>
    </div>
  );
}

function SessionList({ sessions }: { sessions: D["activity"]["recentSessions"] }) {
  const [open, setOpen] = useState<string | null>(sessions[0]?.id ?? null);
  if (!sessions.length) return <Empty>No sessions in the last 90 days</Empty>;
  return (
    <ul className="divide-y divide-line-soft">
      {sessions.map(s => (
        <Fragment key={s.id}>
          <li>
            <button onClick={() => setOpen(o => o === s.id ? null : s.id)} aria-expanded={open === s.id}
              className={`w-full text-left px-4 py-2.5 border-0 cursor-pointer transition-colors flex items-center gap-3 ${open === s.id ? "bg-active" : "bg-transparent hover:bg-hover"}`}>
              <svg className={`shrink-0 text-fg-4 transition-transform ${open === s.id ? "rotate-90" : ""}`} width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 18l6-6-6-6"/></svg>
              <span className="flex-1 min-w-0">
                <span className="block text-[13px] text-fg-2 truncate">{fmtFull(s.start)}</span>
                <span className="block text-[12px] text-fg-4 truncate">
                  {[plural(s.views, "page"), s.clicks ? plural(s.clicks, "click") : null, s.timeMs ? mins(s.timeMs) : null, s.source ? `from ${human(s.source)}` : null].filter(Boolean).join(" · ")}
                </span>
              </span>
              <span className="text-[12px] text-fg-4 shrink-0"><When at={s.end} /></span>
            </button>
          </li>
          {open === s.id && (
            <li className="bg-subtle px-4 py-3">
              <ol className="relative border-l border-line ml-1.5 flex flex-col gap-2">
                {s.steps.map((st, i) => (
                  <li key={i} className="pl-4 relative">
                    <span className={`absolute -left-[4.5px] top-1.5 w-2 h-2 rounded-full ${st.event === "click" ? "bg-fg-4" : "bg-brand"}`} />
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="text-[13px] text-fg-2 min-w-0 truncate">
                        {st.event === "page_view"
                          ? <>Viewed <span className="text-fg">{st.label || st.path}</span></>
                          : <>Clicked <span className="text-fg">“{st.label || "element"}”</span>{st.target ? <span className="text-fg-4"> → {st.target}</span> : null}</>}
                      </span>
                      <time dateTime={st.at} className="shrink-0 text-[11px] text-fg-4 num">{new Date(st.at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}</time>
                    </div>
                    <div className="text-[12px] text-fg-4 truncate">{st.path}{st.feature ? ` · ${human(st.feature)}` : ""}</div>
                  </li>
                ))}
              </ol>
              {s.steps.length >= 80 && <div className="text-caption mt-2">Showing the last 80 steps of this session.</div>}
            </li>
          )}
        </Fragment>
      ))}
    </ul>
  );
}

export function ClickstreamView({ d }: { d: D }) {
  const a = d.activity;
  return (
    <>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Stat label="Engaged time" value={mins(a.engagedMs)} sub={`last ${a.windowDays} days`} />
        <Stat label="Page views" value={a.views.toLocaleString()} sub={`${a.pages.length} different pages`} />
        <Stat label="Clicks" value={a.clicks.toLocaleString()} sub={a.views ? `${(a.clicks / a.views).toFixed(1)} per page view` : undefined} />
        <Stat label="Sessions" value={a.sessions.toLocaleString()} sub={a.sessions ? `${mins(a.engagedMs / a.sessions)} each on average` : "none"} />
      </div>
      {a.capped && <Note>Showing the most recent {a.rows.toLocaleString()} events; older activity in the window isn&apos;t counted.</Note>}

      <Block title="Daily activity" count={`last ${a.days.length} days`}>
        {a.rows ? <DayStrip days={a.days} /> : <Empty>No Dashboard activity recorded in the last {a.windowDays} days</Empty>}
      </Block>

      <Block title="Top pages" count={a.pages.length || undefined}>
        <Table rows={a.pages} rowKey={p => p.path} limit={10} empty="No page views recorded" cols={[
          { label: "Page", cell: p => <Primary sub={p.title ? p.path : undefined}>{p.title || p.path}</Primary> },
          { label: "Time", cell: p => p.timeMs ? mins(p.timeMs) : dash },
          { label: "Views", cell: p => <span className="num">{p.views}</span> },
          { label: "Clicks", hide: "sm", cell: p => <span className="num">{p.clicks}</span> },
          { label: "Area", hide: "md", cell: p => human(p.feature) },
          { label: "Last", hide: "md", cell: p => <When at={p.last} /> },
        ]} />
      </Block>

      <Block title="Recent sessions" count={a.recentSessions.length < a.sessions ? `${a.recentSessions.length} of ${a.sessions}` : a.sessions || undefined}>
        <SessionList sessions={a.recentSessions} />
      </Block>
    </>
  );
}

// ─── Chrome extension tab ─────────────────────────────────────────────────────

const eventDetail = (e: D["extension"]["recent"][number]) => [
  e.result && human(e.result), e.fieldsFilled != null && !Number.isNaN(e.fieldsFilled) ? `${e.fieldsFilled} fields filled` : null,
  e.fitScore != null && !Number.isNaN(e.fitScore) ? `fit ${e.fitScore}` : null,
  e.ghostRisk && `ghost risk ${e.ghostRisk}`, e.companyOdds && `odds ${e.companyOdds}`, e.state && human(e.state),
  e.variant && human(e.variant), e.previousVersion && `from ${e.previousVersion}`, e.ok === false && e.error ? human(e.error) : null,
].filter(Boolean).join(" · ");

export function ExtensionView({ d }: { d: D }) {
  const x = d.extension;
  const live = x.installs.filter(i => !i.uninstalledAt);
  const uses = x.counts.filter(c => c.use);
  const useTotal = uses.reduce((s, c) => s + c.n, 0);
  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Stat label="Installs" value={x.available ? live.length : "—"} sub={x.available ? (x.installs.length > live.length ? `${x.installs.length - live.length} uninstalled` : x.installs.length ? "all still installed" : "never installed") : "not tracked yet"} />
        <Stat label="Last used" value={d.stats.extensionLastAt ? daysAgo(d.stats.extensionLastAt) : "—"} sub={live[0]?.version ? `version ${live[0].version}` : undefined} />
        <Stat label="Actions" value={x.available ? useTotal.toLocaleString() : "—"} sub={x.available ? (uses[0] ? `mostly ${extEventLabel(uses[0].event).toLowerCase()}` : "none yet") : "not tracked yet"} />
        <Stat label="Jobs saved" value={x.jobs.length} sub={x.jobs.filter(j => j.reachedInterviewAt).length ? `${x.jobs.filter(j => j.reachedInterviewAt).length} reached interview` : "through the extension"} />
      </div>
      {!x.available && <Note>{EXT_TRACKING_NOTE}</Note>}
      {x.capped && <Note>Counts cover this user&apos;s 3,000 most recent extension events.</Note>}

      {x.available && (
        <>
          <Block title="Installs" count={x.installs.length}>
            <Table rows={x.installs} rowKey={i => i.id} empty="No install recorded for this user. Older versions report events without an install." cols={[
              { label: "Browser", cell: i => <Primary sub={i.os ?? undefined}>{i.browser ?? "Browser"}</Primary> },
              { label: "Version", cell: i => i.version ? <span className="num">{i.version}</span> : dash },
              { label: "Installed", hide: "sm", cell: i => i.installedAt ? <span title={fmtFull(i.installedAt)}>{fmt(i.installedAt)}</span> : dash },
              { label: "Last seen", cell: i => <When at={i.lastSeenAt} /> },
              { label: "Status", cell: i => i.uninstalledAt
                  ? <span className="badge badge-neutral" title={fmtFull(i.uninstalledAt)}>Uninstalled {fmt(i.uninstalledAt)}</span>
                  : <Pill status="active" /> },
            ]} />
          </Block>

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
            <Block title="What they use it for" count={useTotal || undefined}>
              <Bars empty="No analyses, autofills or other actions yet" items={uses.map(c => ({
                key: c.event, label: extEventLabel(c.event), value: c.n,
                right: <>{c.n.toLocaleString()}{c.failed ? <span className="text-danger-fg"> · {c.failed} failed</span> : null}<span className="text-fg-4"> · last {daysAgo(c.last)}</span></>,
              }))} />
            </Block>
            <Block title="Lifecycle and prompts">
              <Bars empty="No lifecycle events" items={x.counts.filter(c => !c.use).map(c => ({
                key: c.event, label: extEventLabel(c.event), value: c.n, right: <>{c.n.toLocaleString()}<span className="text-fg-4"> · last {daysAgo(c.last)}</span></>,
              }))} />
            </Block>
          </div>

          {x.counts.some(c => c.event === "autofill") && <Note>{EXT_AUTOFILL_NOTE}</Note>}

          <Block title="Recent events" count={x.recent.length}>
            <Table rows={x.recent} rowKey={(e, i) => `${e.at}-${i}`} limit={15} empty="No extension events yet" cols={[
              { label: "Event", cell: e => <Primary sub={eventDetail(e) || undefined}>{extEventLabel(e.event)}</Primary> },
              { label: "Where", cell: e => e.platform || e.host ? <Primary sub={e.platform && e.host ? e.host : undefined}>{e.platform ?? e.host}</Primary> : dash },
              { label: "Result", cell: e => e.ok === false ? <span className="badge badge-danger" title={e.error ?? undefined}>Failed</span> : e.ok ? <span className="text-success-fg text-[12px]">OK</span> : dash },
              { label: "Version", hide: "md", cell: e => e.version ? <span className="num">{e.version}</span> : dash },
              { label: "Time", cell: e => <When at={e.at} full /> },
            ]} />
          </Block>
        </>
      )}

      <Block title="Jobs saved with the extension" count={x.jobs.length}>
        <Table rows={x.jobs} rowKey={j => j.id} empty="No jobs saved through the extension" cols={[
          { label: "Role", cell: j => <Primary sub={j.company ?? undefined}>
              {j.url ? <a href={j.url} target="_blank" rel="noreferrer" className="hover:underline text-fg-2">{j.title || "Untitled role"}</a> : (j.title || "Untitled role")}
            </Primary> },
          { label: "Platform", cell: j => j.platform },
          { label: "Status", cell: j => <Pill status={j.status} /> },
          { label: "Outcome", hide: "md", cell: j => j.reachedInterviewAt ? <span className="text-success-fg">Interview · {fmt(j.reachedInterviewAt)}</span> : j.firstResponseAt ? `Response · ${fmt(j.firstResponseAt)}` : dash },
          { label: "Saved", hide: "sm", cell: j => <When at={j.savedAt} /> },
        ]} />
      </Block>

      {x.upsell.length > 0 && (
        <Block title="Pro prompt in the extension" count={x.upsell.length}>
          <Table rows={x.upsell} rowKey={(e, i) => `${e.at}-${i}`} empty="" cols={[
            { label: "Event", cell: e => <span className="text-fg-2 capitalize">{e.event}</span> },
            { label: "Variant", cell: e => human(e.variant) ?? dash },
            { label: "Time", cell: e => <When at={e.at} full /> },
          ]} />
        </Block>
      )}
    </div>
  );
}

// ─── Career tools tab ─────────────────────────────────────────────────────────

export function CareerToolsView({ d }: { d: D }) {
  const c = d.careerTools, s = d.stats;
  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Stat label="Contacts" value={c.contactCount} sub={c.interactionCount ? `${plural(c.interactionCount, "interaction")} logged` : "none logged"} />
        <Stat label="Cold outreach" value={s.outreach} sub={s.outreachLastAt ? `last ${daysAgo(s.outreachLastAt)}` : "none written"} />
        <Stat label="Contact searches" value={s.contactSearches} sub={c.contactSearches[0] ? `last ${daysAgo(c.contactSearches[0].at)}` : "none"} />
        <Stat label="LinkedIn" value={s.linkedin} sub={s.linkedinLastAt ? `last ${daysAgo(s.linkedinLastAt)}` : "no optimisations"} />
        <Stat label="Job analyses" value={s.jobAnalyses} sub={c.jobAnalyses.filter(j => j.source === "extension").length ? `${c.jobAnalyses.filter(j => j.source === "extension").length} from the extension` : undefined} />
        <Stat label="Study plans" value={s.plans} sub={c.quizzes.length ? `${c.quizzes.length} quiz${c.quizzes.length === 1 ? "" : "zes"} taken` : "no quizzes"} />
        <Stat label="Planner chats" value={c.plannerChats.count} sub={c.plannerChats.lastAt ? `last ${daysAgo(c.plannerChats.lastAt)}` : undefined} />
        <Stat label="Transcripts" value={c.transcripts.length} sub={c.transcripts[0] ? `last ${daysAgo(c.transcripts[0].at)}` : undefined} />
      </div>

      <Block title="Contacts" count={c.contactCount > c.contacts.length ? `${c.contacts.length} of ${c.contactCount}` : c.contactCount}>
        <Table rows={c.contacts} rowKey={x => x.id} empty="No saved contacts" cols={[
          { label: "Contact", cell: x => <Primary sub={[x.role, x.company].filter(Boolean).join(" · ") || undefined}>{x.name}</Primary> },
          { label: "Status", cell: x => <Pill status={x.status} /> },
          { label: "Relationship", hide: "sm", cell: x => human(x.relationship) },
          { label: "Follow up", hide: "md", cell: x => x.nextFollowUpAt ? fmt(x.nextFollowUpAt) : dash },
          { label: "For", hide: "lg", cell: x => x.application ?? dash },
          { label: "Updated", hide: "sm", cell: x => <When at={x.updatedAt} /> },
        ]} />
      </Block>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
        <Block title="Contact interactions" count={c.interactionCount || undefined}>
          {c.interactionTypes.length > 0 && (
            <div className="px-4 pt-3 flex flex-wrap gap-1.5">{c.interactionTypes.map(t => <span key={t.type} className="badge badge-neutral capitalize">{t.type} · {t.n}</span>)}</div>
          )}
          <Table rows={c.interactions} rowKey={x => x.id} empty="No interactions logged" cols={[
            { label: "Interaction", cell: x => <Primary sub={x.contact ?? undefined}><span className="capitalize">{x.type}</span></Primary> },
            { label: "When", cell: x => <When at={x.at} /> },
          ]} />
        </Block>
        <Block title="Contact searches" count={s.contactSearches}>
          <Table rows={c.contactSearches} rowKey={x => x.id} empty="No contact searches" cols={[
            { label: "Company", cell: x => <Primary sub={x.jobTitle ?? undefined}>{x.company ?? "Search"}</Primary> },
            { label: "Found", cell: x => x.contacts != null ? <span className="num">{x.contacts}{x.emails != null ? <Muted> · {x.emails} emails</Muted> : null}</span> : dash },
            { label: "When", cell: x => <When at={x.at} /> },
          ]} />
        </Block>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
        <Block title="Cold outreach" count={s.outreach}>
          <Table rows={c.outreach} rowKey={x => x.id} empty="No outreach messages" cols={[
            { label: "To", cell: x => <Primary sub={x.company ?? undefined}>{x.role ?? "Recipient"}</Primary> },
            { label: "Type", cell: x => <Primary sub={[human(x.platform), human(x.tone)].filter(Boolean).join(" · ") || undefined}>{human(x.type) ?? "—"}</Primary> },
            { label: "When", cell: x => <When at={x.at} /> },
          ]} />
        </Block>
        <Block title="LinkedIn optimisations" count={s.linkedin}>
          <Table rows={c.linkedin} rowKey={x => x.id} empty="No LinkedIn optimisations" cols={[
            { label: "Target role", cell: x => <Primary sub={x.targetIndustry ?? undefined}>{x.targetRole ?? "Profile review"}</Primary> },
            { label: "When", cell: x => <When at={x.at} full /> },
          ]} />
        </Block>
      </div>

      <Block title="Job analyses" count={s.jobAnalyses}>
        <Table rows={c.jobAnalyses} rowKey={x => x.id} empty="No job analyses" cols={[
          { label: "Job", cell: x => <Primary sub={x.company ?? undefined}>{x.jobTitle ?? "Job"}</Primary> },
          { label: "Score", cell: x => x.score != null ? <span className="font-semibold num">{x.score}</span> : dash },
          { label: "From", hide: "sm", cell: x => x.source === "extension" ? <span className="badge badge-brand">Extension</span> : human(x.source) ?? "Dashboard" },
          { label: "When", cell: x => <When at={x.at} /> },
        ]} />
      </Block>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
        <Block title="Study plan quizzes" count={c.quizzes.length}>
          <Table rows={c.quizzes} rowKey={x => x.id} empty="No quizzes taken" cols={[
            { label: "Plan", cell: x => <Primary>{x.plan ?? "Study plan"}</Primary> },
            { label: "Score", cell: x => x.score != null ? <span className="num">{x.score}</span> : dash },
            { label: "When", cell: x => <When at={x.at} /> },
          ]} />
        </Block>
        <Block title="Transcripts" count={c.transcripts.length}>
          <Table rows={c.transcripts} rowKey={x => x.id} empty="No transcripts uploaded" cols={[
            { label: "File", cell: x => <Primary>{x.fileName ?? "Transcript"}</Primary> },
            { label: "Uploaded", cell: x => <When at={x.at} /> },
          ]} />
        </Block>
      </div>
      <Note>Metadata only: message text, notes, profile drafts and job descriptions aren&apos;t loaded here.</Note>
    </div>
  );
}

// ─── Job search extras (scheduled interviews, forwarded mail, outcomes) ───────

export function JobSearchExtras({ d }: { d: D }) {
  const g = d.integrations, c = d.careerTools;
  return (
    <>
      <Block title="Scheduled interviews" count={g.schedules.length}>
        <Table rows={g.schedules} rowKey={x => x.id} empty="No interviews scheduled" cols={[
          { label: "Interview", cell: x => <Primary sub={human(x.stage) ?? undefined}>{x.application ?? "Application"}</Primary> },
          { label: "When", cell: x => <span title={x.timeZone}>{fmtFull(x.startsAt)}</span> },
          { label: "Calendar", hide: "sm", cell: x => x.calendar },
          { label: "Added", hide: "md", cell: x => <When at={x.createdAt} /> },
        ]} />
      </Block>

      <Block title="Forwarded job emails" count={g.inbound.count > g.inbound.emails.length ? `${g.inbound.emails.length} of ${g.inbound.count}` : g.inbound.count}
        action={<span className="text-caption">{g.inbound.address ? <>Forwarding set up {fmt(g.inbound.address.createdAt)}{g.inbound.address.rotatedAt ? ` · address changed ${fmt(g.inbound.address.rotatedAt)}` : ""}</> : "No forwarding address"}</span>}>
        <Table rows={g.inbound.emails} rowKey={x => x.id} empty="No emails forwarded to the tracker" cols={[
          { label: "Email", cell: x => <Primary sub={x.from ?? undefined}>{x.subject ?? "(no subject)"}</Primary> },
          { label: "Read as", cell: x => <Primary sub={x.confidence != null ? `${Math.round(x.confidence * (x.confidence <= 1 ? 100 : 1))}% sure` : undefined}>{human(x.kind)}</Primary> },
          { label: "Result", cell: x => <Primary sub={x.newStatus ? `${x.previousStatus ?? "—"} → ${x.newStatus}` : undefined}><Pill status={x.outcome} /></Primary> },
          { label: "Job", hide: "md", cell: x => x.application ?? ([x.jobTitle, x.company].filter(Boolean).join(" at ") || dash) },
          { label: "Received", hide: "sm", cell: x => <When at={x.at} /> },
        ]} />
      </Block>

      {c.outcomes.length > 0 && (
        <Block title="Reported outcomes" count={c.outcomes.length}>
          <Table rows={c.outcomes} rowKey={x => x.id} empty="" cols={[
            { label: "Job", cell: x => <Primary sub={x.company ?? undefined}>{x.jobTitle ?? "Job"}</Primary> },
            { label: "Outcome", cell: x => <Pill status={x.outcome} /> },
            { label: "Scores", hide: "sm", cell: x => [x.resumeScore != null && `resume ${x.resumeScore}`, x.atsScore != null && `ATS ${x.atsScore}`, x.percentile != null && `p${x.percentile}`].filter(Boolean).join(" · ") || dash },
            { label: "Reported", cell: x => <When at={x.at} /> },
          ]} />
        </Block>
      )}
    </>
  );
}

// ─── Connected accounts (Profile tab) ─────────────────────────────────────────

export function ConnectionsView({ d }: { d: D }) {
  const g = d.integrations;
  const row = (label: string, c: D["integrations"]["google"]) => (
    <div className="flex items-center justify-between gap-3 px-4 py-2.5">
      <div className="min-w-0">
        <div className="text-[13px] text-fg-2">{label}</div>
        <div className="text-[12px] text-fg-4 truncate">
          {c ? [c.account, `connected ${fmt(c.connectedAt)}`, c.brokenAt ? `stopped working ${fmt(c.brokenAt)}` : null].filter(Boolean).join(" · ") : "Not connected"}
        </div>
      </div>
      {c ? (c.connected ? <span className="badge badge-success shrink-0">Connected</span> : <span className="badge badge-warning shrink-0" title={c.error ?? undefined}>Needs reconnect</span>)
        : <Muted>—</Muted>}
    </div>
  );
  return (
    <Block title="Connected accounts">
      <div className="divide-y divide-line-soft">
        {row("Google Calendar", g.google)}
        {row("Outlook Calendar", g.microsoft)}
        <div className="flex items-center justify-between gap-3 px-4 py-2.5">
          <div className="min-w-0">
            <div className="text-[13px] text-fg-2">Email forwarding to the tracker</div>
            <div className="text-[12px] text-fg-4 truncate">
              {g.inbound.address ? `Set up ${fmt(g.inbound.address.createdAt)} · ${plural(g.inbound.count, "email")} received` : "Not set up"}
            </div>
          </div>
          {g.inbound.address ? <span className="badge badge-success shrink-0">On</span> : <Muted>—</Muted>}
        </div>
      </div>
    </Block>
  );
}

// ─── Billing extras (Subscription tab) ────────────────────────────────────────

export function BillingExtrasView({ d }: { d: D }) {
  const b = d.billingExtras;
  const who = (p: { id: string; name: string | null; email: string | null } | null) => p
    ? <a href={userHref(p.id, "subscription")} className="text-fg-2 hover:underline">{p.name ?? p.email ?? p.id.slice(0, 8)}</a> : dash;
  return (
    <>
      <Block title="Credit transfers" count={b.transfers.length}>
        <Table rows={b.transfers} rowKey={x => x.id} empty="Hasn't sent or received pack credits" cols={[
          { label: "Transfer", cell: x => <Primary sub={x.grants || undefined}>{x.direction === "sent" ? "Sent to " : "Received from "}{who(x.other)}</Primary> },
          { label: "Direction", cell: x => <span className={`badge ${x.direction === "sent" ? "badge-neutral" : "badge-success"}`}>{x.direction === "sent" ? "Sent" : "Received"}</span> },
          { label: "When", cell: x => <When at={x.at} full /> },
        ]} />
      </Block>

      <Block title="Group packs" count={b.groupsOwned.length + b.groupsJoined.length}>
        {b.groupsOwned.length + b.groupsJoined.length === 0 ? <Empty>Not part of a group pack</Empty> : (
          <ul className="divide-y divide-line-soft">
            {b.groupsOwned.map(g => (
              <li key={g.id} className="px-4 py-2.5">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-[13px] text-fg-2 truncate">Bought {human(g.packKey)} <span className="badge badge-brand ml-1">Owner</span></span>
                  <span className="text-[12px] text-fg-4 shrink-0">{g.members.length + 1} of {g.seats} seats · {fmt(g.createdAt)}</span>
                </div>
                {g.members.length > 0 && (
                  <div className="text-[12px] text-fg-4 mt-1 flex flex-wrap gap-x-2 gap-y-0.5">
                    Members: {g.members.map((m, i) => <span key={m.id}>{who(m)}{i < g.members.length - 1 ? "," : ""}</span>)}
                  </div>
                )}
              </li>
            ))}
            {b.groupsJoined.map(g => (
              <li key={g.id} className="px-4 py-2.5 flex items-center justify-between gap-3">
                <span className="text-[13px] text-fg-2 truncate min-w-0">Joined {g.packKey ? human(g.packKey) : "a group pack"} from {who(g.owner)}</span>
                <span className="text-[12px] text-fg-4 shrink-0">{fmt(g.joinedAt)}</span>
              </li>
            ))}
          </ul>
        )}
      </Block>

      {b.rewards.length > 0 && (
        <Block title="Feedback rewards" count={b.rewards.length}>
          <Table rows={b.rewards} rowKey={(x, i) => `${x.feature}-${i}`} empty="" cols={[
            { label: "Reward", cell: x => <Primary sub={x.field}>{human(x.feature)}</Primary> },
            { label: "Credits", cell: x => <span className="num">+{x.amount}</span> },
            { label: "Claimed", cell: x => <When at={x.at} /> },
          ]} />
        </Block>
      )}
    </>
  );
}

// ─── Which sections have data (Raw tab) ───────────────────────────────────────

const TAB_LABEL: Record<string, string> = {
  jobsearch: "Job search", careertools: "Career tools", extension: "Extension", activity: "Activity",
  account: "Profile", subscription: "Subscription", support: "Support",
};

export function SourcesView({ d, onOpen }: { d: D; onOpen?: (tab: string) => void }) {
  const [onlyData, setOnlyData] = useState(false);
  const rows = d.sources.filter(s => !onlyData || s.state === "data");
  const n = (st: string) => d.sources.filter(s => s.state === st).length;
  return (
    <Block title="What this user has" count={`${n("data")} of ${d.sources.length} with data`}
      action={
        <div className="seg" role="group" aria-label="Filter sections">
          <button type="button" onClick={() => setOnlyData(false)} aria-pressed={!onlyData} className={`seg-item ${!onlyData ? "seg-item-active" : ""}`}>All</button>
          <button type="button" onClick={() => setOnlyData(true)} aria-pressed={onlyData} className={`seg-item ${onlyData ? "seg-item-active" : ""}`}>With data</button>
        </div>
      }>
      <Table rows={rows} rowKey={s => s.table + s.label} limit={60} empty="Nothing here" cols={[
        { label: "Section", cell: s => <Primary sub={s.table}>{s.label}</Primary> },
        { label: "Rows", cell: s => s.state === "missing" ? dash : <span className={`num ${s.n ? "text-fg" : ""}`}>{s.n.toLocaleString()}</span> },
        { label: "State", cell: s => s.state === "data" ? <span className="badge badge-success">Has data</span>
            : s.state === "empty" ? <span className="badge badge-neutral">Empty</span>
            : <span className="badge badge-warning" title="Table or column not in the database yet (Dashboard migration not applied)">Not set up</span> },
        { label: "Shown in", hide: "sm", cell: s => onOpen
            ? <button type="button" onClick={() => onOpen(s.tab === "account" ? "profile" : s.tab)} className="link text-[12px]">{TAB_LABEL[s.tab] ?? s.tab}</button>
            : TAB_LABEL[s.tab] ?? s.tab },
      ]} />
    </Block>
  );
}
