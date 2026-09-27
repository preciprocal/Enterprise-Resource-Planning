// components/admin/AccessTab.tsx
// Manage who can sign in to the ERP. Entries live in erp_allowed_emails;
// emails from ERP_ALLOWED_EMAILS (server env) are shown as locked.
"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Avatar, fmt, fmtFull, SkeletonTable } from "./admin-shared";

interface AccessEntry {
  email: string; note: string | null; addedBy: string | null; createdAt: string | null;
  locked: boolean; isYou: boolean; hasAccount: boolean; name?: string;
}

// Small neutral tag — kept deliberately quiet so the table reads as data, not badges.
function Tag({ children, tone = "neutral", title }: { children: React.ReactNode; tone?: "neutral" | "blue" | "amber"; title?: string }) {
  const toneCls = tone === "blue"
    ? "text-[#0070f3] border-[rgba(0,112,243,0.25)]"
    : tone === "amber"
      ? "text-[#f5a623] border-[rgba(245,166,35,0.25)]"
      : "text-[#888] border-[#2a2a2a]";
  return (
    <span title={title} className={`inline-flex items-center h-5 px-1.5 rounded border text-[11px] font-medium whitespace-nowrap ${toneCls}`}>
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
    if (!confirm(`Remove ERP access for ${entry.email}? They'll be signed out on their next request.`)) return;
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
  const fieldCls = "h-9 rounded-md border border-[#2a2a2a] bg-[#0a0a0a] px-3 text-[13px] text-[#ededed] placeholder:text-[#444] outline-none focus:border-[#555] transition-colors font-[inherit] disabled:opacity-40";

  return (
    <div className="flex-1 flex flex-col min-h-0 min-w-0 bg-black">
      {/* ── Header ── */}
      <div className="px-4 md:px-8 pt-6 md:pt-8 pb-5 border-b border-[#111] shrink-0">
        <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-[20px] font-semibold text-[#ededed] tracking-tight">Team access</h1>
            <p className="text-[13px] text-[#666] mt-1 max-w-2xl leading-relaxed">
              Only these emails can sign in to the ERP, using their Preciprocal password. New members can set one with “Forgot password?”.
            </p>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            <div className="relative">
              <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[#444]" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true">
                <circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>
              </svg>
              <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search members" aria-label="Search members"
                className={`${fieldCls} w-full md:w-56 pl-8`} />
            </div>
            <span className="text-[12px] text-[#555] tabular-nums whitespace-nowrap">
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
            className="h-9 px-4 rounded-md text-[13px] font-semibold bg-[#ededed] text-black border-none cursor-pointer hover:bg-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors shrink-0 inline-flex items-center justify-center gap-2">
            {adding
              ? <><span className="w-3.5 h-3.5 rounded-full border-2 border-black/20 border-t-black animate-spin" />Adding…</>
              : <><svg width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>Grant access</>}
          </button>
        </form>

        {(msg || tableMissing) && (
          <div className="mt-3 flex flex-col gap-2">
            {tableMissing && (
              <p className="text-[12px] text-[#f5a623] leading-relaxed">
                The access table doesn&apos;t exist yet — run <code className="font-mono">supabase/erp_schema.sql</code> in Supabase to manage members here. Until then only ERP_ALLOWED_EMAILS can sign in.
              </p>
            )}
            {msg && <p role="status" className={`text-[12px] font-medium ${msg.ok ? "text-[#3ecf8e]" : "text-[#f55]"}`}>{msg.text}</p>}
          </div>
        )}
      </div>

      {/* ── Members table (fills the rest of the page) ── */}
      <div className="flex-1 min-h-0 overflow-auto">
        {loading ? (
          <div className="px-4 md:px-8"><SkeletonTable rows={4} cols={4} /></div>
        ) : (
          <table className="w-full border-collapse text-left">
            <thead className="sticky top-0 z-10 bg-black">
              <tr className="border-b border-[#111]">
                <th className="pl-4 md:pl-8 pr-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-[#444]">Member</th>
                <th className="hidden md:table-cell px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-[#444]">Role / note</th>
                <th className="hidden lg:table-cell px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-[#444]">Added by</th>
                <th className="hidden sm:table-cell px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-[#444]">Added</th>
                <th className="pl-4 pr-4 md:pr-8 py-2.5 w-px"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(entry => {
                const note = entry.note && entry.note !== "ERP_ALLOWED_EMAILS" ? entry.note : null;
                return (
                  <tr key={entry.email} className="border-b border-[#0d0d0d] hover:bg-[#070707] transition-colors group">
                    <td className="pl-4 md:pl-8 pr-4 py-3">
                      <div className="flex items-center gap-3 min-w-0">
                        <Avatar name={entry.name ?? entry.email} size={32} />
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="text-[13px] font-medium text-[#ededed] truncate">{entry.name ?? entry.email.split("@")[0]}</span>
                            {entry.isYou && <Tag tone="blue">You</Tag>}
                            {entry.locked && <Tag title="From ERP_ALLOWED_EMAILS in the server environment — can only be changed there">Locked</Tag>}
                            {!entry.hasAccount && <Tag tone="amber" title="No Preciprocal account with this email yet">No account</Tag>}
                          </div>
                          <div className="text-[12px] text-[#555] truncate mt-0.5">{entry.email}</div>
                          {note && <div className="md:hidden text-[12px] text-[#666] truncate mt-0.5">{note}</div>}
                        </div>
                      </div>
                    </td>
                    <td className="hidden md:table-cell px-4 py-3 text-[13px] text-[#888] max-w-xs truncate">{note ?? <span className="text-[#333]">—</span>}</td>
                    <td className="hidden lg:table-cell px-4 py-3 text-[13px] text-[#888] truncate">
                      {entry.addedBy === "env" ? <span className="text-[#555]">Server environment</span> : entry.addedBy ?? <span className="text-[#333]">—</span>}
                    </td>
                    <td className="hidden sm:table-cell px-4 py-3 text-[13px] text-[#888] whitespace-nowrap" title={entry.createdAt && entry.addedBy !== "env" ? fmtFull(entry.createdAt) : undefined}>
                      {entry.createdAt && entry.addedBy !== "env" ? fmt(entry.createdAt) : <span className="text-[#333]">—</span>}
                    </td>
                    <td className="pl-4 pr-4 md:pr-8 py-3 text-right">
                      {!entry.locked && !entry.isYou ? (
                        <button onClick={() => remove(entry)} disabled={!!busy}
                          className="h-7 px-2.5 rounded-md border border-transparent text-[12px] font-medium text-[#666] bg-transparent cursor-pointer hover:text-[#f55] hover:border-[rgba(255,68,68,0.25)] hover:bg-[rgba(255,68,68,0.06)] disabled:opacity-40 transition-colors whitespace-nowrap">
                          {busy === entry.email ? "Removing…" : "Remove"}
                        </button>
                      ) : (
                        <span className="text-[12px] text-[#333] whitespace-nowrap" title={entry.isYou ? "You can't remove your own access" : "Change ERP_ALLOWED_EMAILS to remove"}>—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
              {!filtered.length && (
                <tr>
                  <td colSpan={5} className="px-4 md:px-8 py-16 text-center text-[13px] text-[#555]">
                    {query ? `No members match “${query}”` : "Nobody has access yet"}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>

      {/* ── Footer note ── */}
      <div className="px-4 md:px-8 py-3 border-t border-[#111] shrink-0">
        <p className="text-[11px] text-[#444] leading-relaxed">
          Locked members come from <code className="font-mono text-[#555]">ERP_ALLOWED_EMAILS</code>{" "}in the server environment and can only be changed there — the fallback that keeps you from being locked out.
        </p>
      </div>
    </div>
  );
}
