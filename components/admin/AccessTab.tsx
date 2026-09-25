// components/admin/AccessTab.tsx
// Manage who can sign in to the ERP. Entries live in erp_allowed_emails;
// emails from ERP_ALLOWED_EMAILS (server env) are shown as locked.
"use client";
import { useCallback, useEffect, useState } from "react";
import { Card, CardTitle, SL, Chip, Avatar, inputCls, fmtFull, SkeletonTable, CodeRef } from "./admin-shared";

interface AccessEntry {
  email: string; note: string | null; addedBy: string | null; createdAt: string | null;
  locked: boolean; isYou: boolean; hasAccount: boolean; name?: string;
}

export default function AccessTab({ token }: { token: string }) {
  const [list, setList]         = useState<AccessEntry[]>([]);
  const [loading, setLoading]   = useState(true);
  const [tableMissing, setTableMissing] = useState(false);
  const [email, setEmail]       = useState("");
  const [note, setNote]         = useState("");
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

  return (
    <div className="flex-1 overflow-y-auto p-4 md:p-6 flex flex-col gap-5 max-w-4xl w-full">
      <section>
        <SL>ERP Access <CodeRef k="erpSchema" /></SL>
        <p className="text-[13px] text-[#555] -mt-1 mb-3 leading-relaxed">
          Only these emails can sign in to the ERP. They must sign in with this exact email (password or Google).
          Being an admin in the main app does not grant access.
        </p>

        {tableMissing && (
          <div className="mb-3 px-3.5 py-2.5 rounded-lg text-[12px] border bg-[rgba(245,166,35,0.06)] border-[rgba(245,166,35,0.2)] text-[#f5a623]">
            The access table doesn&apos;t exist yet. Run <code className="font-mono">supabase/erp_schema.sql</code>{" "}in the Supabase SQL editor to manage access here. Until then only the emails in ERP_ALLOWED_EMAILS can sign in.
          </div>
        )}

        {msg && (
          <div className={`mb-3 px-3.5 py-2.5 rounded-lg text-[12px] font-medium border ${msg.ok
            ? "bg-[rgba(62,207,142,0.06)] border-[rgba(62,207,142,0.2)] text-[#3ecf8e]"
            : "bg-[rgba(255,68,68,0.06)] border-[rgba(255,68,68,0.2)] text-[#f55]"}`}>
            {msg.text}
          </div>
        )}

        <Card>
          <CardTitle>Add someone</CardTitle>
          <form onSubmit={add} className="flex flex-col sm:flex-row gap-2">
            <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="name@company.com"
              className={`${inputCls} sm:flex-1`} disabled={tableMissing} required />
            <input value={note} onChange={e => setNote(e.target.value)} placeholder="Note (optional, e.g. role)"
              className={`${inputCls} sm:w-56`} disabled={tableMissing} maxLength={200} />
            <button type="submit" disabled={tableMissing || !email.trim() || !!busy}
              className="px-4 py-2 rounded-md text-[13px] font-semibold bg-[#ededed] text-black border-none cursor-pointer hover:bg-white disabled:opacity-40 disabled:cursor-not-allowed shrink-0">
              {busy && busy === email.trim().toLowerCase() ? "Adding…" : "Grant access"}
            </button>
          </form>
        </Card>
      </section>

      <section>
        <SL>{loading ? "People with access" : `People with access · ${list.length}`}</SL>
        <Card className="p-0 overflow-hidden">
          {loading ? <SkeletonTable rows={3} cols={3} /> : list.length === 0 ? (
            <div className="p-8 text-center text-[13px] text-[#555]">Nobody has access yet</div>
          ) : list.map(entry => (
            <div key={entry.email} className="flex items-center gap-3 px-4 py-3 border-b border-[#111] last:border-0">
              <Avatar name={entry.name ?? entry.email} size={32} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[14px] text-[#ededed] truncate">{entry.email}</span>
                  {entry.isYou && <Chip label="You" className="bg-[rgba(0,112,243,0.08)] text-[#0070f3] border border-[rgba(0,112,243,0.2)] text-[11px]" />}
                  {entry.locked && <Chip label="Server env · locked" className="bg-[rgba(136,136,136,0.08)] text-[#888] border border-[rgba(136,136,136,0.2)] text-[11px]" />}
                  {!entry.hasAccount && <Chip label="No account yet" className="bg-[rgba(245,166,35,0.08)] text-[#f5a623] border border-[rgba(245,166,35,0.2)] text-[11px]" />}
                </div>
                <div className="text-[12px] text-[#555] mt-0.5 truncate">
                  {[entry.name, entry.note && entry.note !== "ERP_ALLOWED_EMAILS" ? entry.note : null,
                    entry.addedBy && entry.addedBy !== "env" ? `added by ${entry.addedBy}` : null,
                    entry.createdAt && entry.addedBy !== "env" ? fmtFull(entry.createdAt) : null].filter(Boolean).join(" · ") || "—"}
                </div>
              </div>
              {!entry.locked && !entry.isYou && (
                <button onClick={() => remove(entry)} disabled={!!busy}
                  className="shrink-0 text-[12px] font-medium px-2.5 py-1 rounded-md border border-[rgba(255,68,68,0.25)] text-[#f55] bg-transparent cursor-pointer hover:bg-[rgba(255,68,68,0.06)] disabled:opacity-40">
                  {busy === entry.email ? "Removing…" : "Remove"}
                </button>
              )}
            </div>
          ))}
        </Card>
        <p className="text-[12px] text-[#444] mt-2 leading-relaxed">
          Locked entries come from <code className="font-mono">ERP_ALLOWED_EMAILS</code>{" "}in the server environment and can only be changed there. That&apos;s the fallback that keeps you from being locked out.
        </p>
      </section>
    </div>
  );
}
