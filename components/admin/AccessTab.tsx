// components/admin/AccessTab.tsx
// Manage who can sign in to the ERP. Entries live in erp_allowed_emails;
// emails from ERP_ALLOWED_EMAILS (server env) are shown as locked.
"use client";
import { confirmDialog } from "@/components/ui/dialog-host";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Avatar, fmt, fmtFull, SkeletonTable } from "./admin-shared";

interface AccessEntry {
  email: string; note: string | null; addedBy: string | null; createdAt: string | null;
  locked: boolean; isYou: boolean; hasAccount: boolean; name?: string;
}

// Small neutral tag — kept deliberately quiet so the table reads as data, not badges.
function Tag({ children, tone = "neutral", title }: { children: React.ReactNode; tone?: "neutral" | "blue" | "amber"; title?: string }) {
  const toneCls = tone === "blue" ? "badge-brand" : tone === "amber" ? "badge-warning" : "badge-neutral";
  return (
    <span title={title} className={`badge ${toneCls}`}>
      {children}
    </span>
  );
}

export default function AccessTab({ token }: { token: string }) {
  const [list, setList]         = useState<AccessEntry[]>([]);
  const [loading, setLoading]   = useState(true);
  const [tableMissing, setTableMissing] = useState(false);
  const [email, setEmail]       = useState("");
  const [note, setNote]         = useState("");
  const [query, setQuery]       = useState("");
  const [busy, setBusy]         = useState<string | null>(null);   // email being added/removed
  const [msg, setMsg]           = useState<{ text: string; ok: boolean } | null>(null);

  const flash = (text: string, ok: boolean) => { setMsg({ text, ok }); setTimeout(() => setMsg(null), 4000); };

  const load = useCallback(async () => {
    try {
      const res  = await fetch("/api/admin?action=access_list", { headers: { "x-admin-token": token }, cache: "no-store" });
      const json = await res.json() as { list?: AccessEntry[]; tableMissing?: boolean; error?: string };
      if (!res.ok || json.error) throw new Error(json.error ?? `HTTP ${res.status}`);
      setList(json.list ?? []);
      setTableMissing(!!json.tableMissing);
    } catch (e) { flash((e as Error).message, false); }
    setLoading(false);
  }, [token]);

  useEffect(() => { void load(); }, [load]);

  async function post(body: Record<string, unknown>) {
    const res  = await fetch("/api/admin", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-admin-token": token },
      body: JSON.stringify(body),
    });
    const json = await res.json() as { error?: string };
    if (!res.ok || json.error) throw new Error(json.error ?? `HTTP ${res.status}`);
  }

  async function add(e: React.FormEvent) {
    e.preventDefault();
    const value = email.trim().toLowerCase();
    if (!value) return;
    setBusy(value);
    try {
      await post({ action: "access_add", email: value, note });
      setEmail(""); setNote("");
      flash(`${value} can now sign in`, true);
      await load();
    } catch (err) { flash((err as Error).message, false); }
    setBusy(null);
  }

  async function remove(entry: AccessEntry) {
    if (!(await confirmDialog({ title: "Remove ERP access?", message: <>{entry.email} loses access to the ERP and is signed out on their next request.</>, confirmLabel: "Remove access", tone: "danger" }))) return;
    setBusy(entry.email);
    try {
      await post({ action: "access_remove", email: entry.email });
      flash(`${entry.email} removed`, true);
      await load();
    } catch (err) { flash((err as Error).message, false); }
    setBusy(null);
  }

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return list;
    return list.filter(e => [e.email, e.name, e.note].some(v => v?.toLowerCase().includes(q)));
  }, [list, query]);

  const adding = !!busy && busy === email.trim().toLowerCase();
  const fieldCls = "field";

  return (
    <div className="flex-1 flex flex-col min-h-0 min-w-0 bg-canvas">
      {/* ── Header ── */}
      <div className="px-4 md:px-8 pt-6 md:pt-8 pb-5 border-b border-line-soft shrink-0">
        <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4">
          <div className="min-w-0">
            <h1 className="page-title">Team access</h1>
            <p className="text-body mt-1 max-w-2xl">
              Only these emails can sign in to the ERP, using their Preciprocal password. New members can set one with “Forgot password?”.
            </p>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            <div className="relative">
              <svg className="absolute left-3 top-1/2 -translate-y-1/2 text-fg-5 pointer-events-none" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true">
                <circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>
              </svg>
              <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search members" aria-label="Search members"
                className={`${fieldCls} w-full md:w-56 pl-9`} />
            </div>
            <span className="text-caption num whitespace-nowrap">
              {loading ? "—" : `${list.length} ${list.length === 1 ? "member" : "members"}`}
            </span>
          </div>
        </div>

        {/* ── Invite bar ── */}
        <form onSubmit={add} className="mt-5 flex flex-col sm:flex-row gap-2">
          <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="name@company.com"
            aria-label="Email" required disabled={tableMissing} className={`${fieldCls} sm:flex-1`} />
          <input value={note} onChange={e => setNote(e.target.value)} placeholder="Role or note (optional)" maxLength={200}
            aria-label="Role or note" disabled={tableMissing} className={`${fieldCls} sm:w-64`} />
          <button type="submit" disabled={tableMissing || !email.trim() || !!busy}
            className="btn btn-primary btn-lg shrink-0">
            {adding
              ? <><span className="w-3.5 h-3.5 rounded-full border-2 border-white/30 border-t-white animate-spin" />Adding…</>
              : <><svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>Grant access</>}
          </button>
        </form>

        {(msg || tableMissing) && (
          <div className="mt-3 flex flex-col gap-2">
            {tableMissing && (
              <p className="text-[12px] text-warning-fg leading-relaxed">
                The access table doesn&apos;t exist yet — run <code className="font-mono">supabase/erp_schema.sql</code> in Supabase to manage members here. Until then only ERP_ALLOWED_EMAILS can sign in.
              </p>
            )}
            {msg && <p role="status" className={`text-[12px] font-medium ${msg.ok ? "text-success-fg" : "text-danger-fg"}`}>{msg.text}</p>}
          </div>
        )}
      </div>

      {/* ── Members table (fills the rest of the page) ── */}
      <div className="flex-1 min-h-0 overflow-auto">
        {loading ? (
          <div className="px-4 md:px-8"><SkeletonTable rows={4} cols={4} /></div>
        ) : (
          <table className="data-table">
            <thead className="sticky top-0 z-10 [&_th]:bg-canvas">
              <tr>
                <th className="pl-4 md:pl-8 pr-4 py-2.5">Member</th>
                <th className="hidden md:table-cell px-4 py-2.5">Role / note</th>
                <th className="hidden lg:table-cell px-4 py-2.5">Added by</th>
                <th className="hidden sm:table-cell px-4 py-2.5">Added</th>
                <th className="pl-4 pr-4 md:pr-8 py-2.5 w-px"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(entry => {
                const note = entry.note && entry.note !== "ERP_ALLOWED_EMAILS" ? entry.note : null;
                return (
                  <tr key={entry.email} className="group">
                    <td className="pl-4 md:pl-8 pr-4 py-3">
                      <div className="flex items-center gap-3 min-w-0">
                        <Avatar name={entry.name ?? entry.email} size={32} />
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="text-[13px] font-medium text-fg truncate">{entry.name ?? entry.email.split("@")[0]}</span>
                            {entry.isYou && <Tag tone="blue">You</Tag>}
                            {entry.locked && <Tag title="From ERP_ALLOWED_EMAILS in the server environment — can only be changed there">Locked</Tag>}
                            {!entry.hasAccount && <Tag tone="amber" title="No Preciprocal account with this email yet">No account</Tag>}
                          </div>
                          <div className="text-[12px] text-fg-4 truncate mt-0.5">{entry.email}</div>
                          {note && <div className="md:hidden text-[12px] text-fg-4 truncate mt-0.5">{note}</div>}
                        </div>
                      </div>
                    </td>
                    <td className="hidden md:table-cell px-4 py-3 text-[13px] text-fg-3 max-w-xs truncate">{note ?? <span className="text-fg-5">—</span>}</td>
                    <td className="hidden lg:table-cell px-4 py-3 text-[13px] text-fg-3 truncate">
                      {entry.addedBy === "env" ? <span className="text-fg-4">Server environment</span> : entry.addedBy ?? <span className="text-fg-5">—</span>}
                    </td>
                    <td className="hidden sm:table-cell px-4 py-3 text-[13px] text-fg-3 whitespace-nowrap" title={entry.createdAt && entry.addedBy !== "env" ? fmtFull(entry.createdAt) : undefined}>
                      {entry.createdAt && entry.addedBy !== "env" ? fmt(entry.createdAt) : <span className="text-fg-5">—</span>}
                    </td>
                    <td className="pl-4 pr-4 md:pr-8 py-3 text-right">
                      {!entry.locked && !entry.isYou ? (
                        <button onClick={() => remove(entry)} disabled={!!busy}
                          className="btn btn-sm btn-ghost hover:text-danger-fg hover:bg-danger-soft">
                          {busy === entry.email ? "Removing…" : "Remove"}
                        </button>
                      ) : (
                        <span className="text-[12px] text-fg-5 whitespace-nowrap" title={entry.isYou ? "You can't remove your own access" : "Change ERP_ALLOWED_EMAILS to remove"}>—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
              {!filtered.length && (
                <tr>
                  <td colSpan={5} className="px-4 md:px-8 py-16 text-center text-[13px] text-fg-4">
                    {query ? `No members match “${query}”` : "Nobody has access yet"}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>

      {/* ── Footer note ── */}
      <div className="px-4 md:px-8 py-3 border-t border-line-soft shrink-0">
        <p className="text-caption">
          Locked members come from <code className="font-mono text-fg-4">ERP_ALLOWED_EMAILS</code>{" "}in the server environment and can only be changed there — the fallback that keeps you from being locked out.
        </p>
      </div>
    </div>
  );
}
