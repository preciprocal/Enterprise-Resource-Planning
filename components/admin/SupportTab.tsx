"use client";
import { useState, useEffect, useCallback, useRef, useContext } from "react";
import { Select, AdminTokenContext } from "./admin-shared";
import { getSupabaseBrowser } from "@/lib/supabase/client";

// ─── Types ────────────────────────────────────────────────────────────────────
// Shape returned by /api/admin?action=tickets — support_tickets rows mapped to
// camelCase, plus internal notes from erp_ticket_notes.

interface Ticket {
  id: string;
  title?: string;
  subject?: string;
  description?: string;
  message?: string;
  userId?: string;
  userEmail?: string;
  userName?: string;
  status: TicketStatus;
  priority: "low" | "medium" | "high" | "urgent";
  createdAt: string;
  updatedAt?: string;
  notes?: string;
  tags?: string[];
}

interface Reply {
  id: string;
  ticketId?: string;
  message: string;
  from: "user" | "support";
  fromEmail?: string;
  isStaff: boolean;
  createdAt: string;
}

interface FeedbackItem {
  id: string;
  type?: string;
  userId?: string;
  userEmail?: string;
  userName?: string;
  serviceKey?: string;
  rating?: number;
  createdAt: string;
  [key: string]: unknown;
}

interface Survey {
  id: string;
  userId?: string;
  userEmail?: string;
  createdAt: string;
  [key: string]: unknown;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function relTime(iso: string) {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60)    return "just now";
  if (s < 3600)  return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

// "featureRatings" / "top_improvement" → "feature ratings" / "top improvement"
function humanKey(k: string) {
  return k.replace(/_/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();
}

function fullDate(iso: string) {
  return new Date(iso).toLocaleString("en-US", {
    month: "short", day: "numeric", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

type TicketStatus   = "open" | "in-progress" | "resolved" | "closed";
type TicketPriority = "urgent" | "high" | "medium" | "low";

const STATUS_META: Record<TicketStatus, { label: string; color: string; bg: string; border: string }> = {
  open:          { label: "Open",        color: "#3ecf8e", bg: "rgba(62,207,142,0.08)",  border: "rgba(62,207,142,0.2)"  },
  "in-progress": { label: "In Progress", color: "#f5a623", bg: "rgba(245,166,35,0.08)",  border: "rgba(245,166,35,0.2)"  },
  resolved:      { label: "Resolved",    color: "#0070f3", bg: "rgba(0,112,243,0.08)",   border: "rgba(0,112,243,0.2)"   },
  closed:        { label: "Closed",      color: "#555",    bg: "rgba(85,85,85,0.08)",    border: "rgba(85,85,85,0.2)"    },
};

// Refetch whenever the given table changes. Realtime needs the admin SELECT
// policies from supabase/erp_schema.sql; the interval is a fallback for when
// they're missing or the socket drops.
function useLiveRefetch(table: string, filter: string | undefined, refetch: () => void, fallbackMs = 30_000) {
  useEffect(() => {
    const sb = getSupabaseBrowser();
    const channel = sb
      .channel(`erp-${table}-${filter ?? "all"}`)
      .on("postgres_changes", { event: "*", schema: "public", table, ...(filter ? { filter } : {}) }, () => refetch())
      .subscribe();
    const t = setInterval(refetch, fallbackMs);
    return () => { clearInterval(t); void sb.removeChannel(channel); };
  }, [table, filter, refetch, fallbackMs]);
}

const PRIORITY_META: Record<TicketPriority, { label: string; color: string }> = {
  urgent: { label: "Urgent", color: "#f44" },
  high:   { label: "High",   color: "#f5a623" },
  medium: { label: "Medium", color: "#0070f3" },
  low:    { label: "Low",    color: "#888" },
};

function StatusBadge({ status }: { status: string }) {
  const m = STATUS_META[status as TicketStatus] ?? {
    label: status, color: "#888", bg: "rgba(136,136,136,0.08)", border: "rgba(136,136,136,0.2)",
  };
  return (
    <span
      className="inline-flex items-center px-2 py-0.5 rounded text-[12px] font-medium border shrink-0"
      style={{ color: m.color, background: m.bg, borderColor: m.border }}
    >
      {m.label}
    </span>
  );
}

function PriorityDot({ priority }: { priority: string }) {
  const m = PRIORITY_META[priority as TicketPriority] ?? { label: priority, color: "#888" };
  return (
    <span className="flex items-center gap-1.5 text-[12px]" style={{ color: m.color }}>
      <span className="inline-block w-1.5 h-1.5 rounded-full shrink-0" style={{ background: m.color }} />
      {m.label}
    </span>
  );
}

// ─── SupportTab ───────────────────────────────────────────────────────────────

export default function SupportTab({ token: tokenProp }: { token?: string }) {
  const ctxToken = useContext(AdminTokenContext);
  const token = tokenProp || ctxToken;
  const [activeView, setActiveView] = useState<"tickets" | "feedback" | "surveys">("tickets");

  return (
    <div className="flex-1 flex flex-col h-full bg-black min-h-0 overflow-hidden">
      <div className="flex items-center gap-1 px-5 py-3 border-b border-[#1a1a1a] shrink-0">
        {(["tickets", "feedback", "surveys"] as const).map(v => (
          <button
            key={v}
            onClick={() => setActiveView(v)}
            className={`px-3 py-1.5 rounded text-[14px] font-medium transition-colors ${
              activeView === v
                ? "bg-[#ededed] text-black"
                : "text-[#888] hover:text-[#ededed] hover:bg-[#111]"
            }`}
          >
            {v === "tickets" ? "Tickets" : v === "feedback" ? "Feedback" : "Surveys"}
          </button>
        ))}
      </div>
      <div className="flex-1 min-h-0 overflow-hidden">
        {activeView === "tickets"  && <TicketsView  token={token} />}
        {activeView === "feedback" && <FeedbackView token={token} />}
        {activeView === "surveys"  && <SurveysView  token={token} />}
      </div>
    </div>
  );
}

// ─── Tickets View ─────────────────────────────────────────────────────────────

function TicketsView({ token }: { token?: string }) {
  const [tickets, setTickets]             = useState<Ticket[]>([]);
  const [loading, setLoading]             = useState(true);
  const [error, setError]                 = useState<string | null>(null);
  const [statusFilter, setStatusFilter]   = useState("all");
  const [priorityFilter, setPriorityFilter] = useState("all");
  const [search, setSearch]               = useState("");
  const [selected, setSelected]           = useState<Ticket | null>(null);

  // Live — any write from either app (Dashboard or here) shows up without a refresh.
  const loadTickets = useCallback(async () => {
    try {
      const res  = await fetch("/api/admin?action=tickets", { headers: { "x-admin-token": token ?? "" }, cache: "no-store" });
      const json = await res.json() as { tickets?: Ticket[]; error?: string };
      if (!res.ok || json.error) throw new Error(json.error ?? `HTTP ${res.status}`);
      const list = json.tickets ?? [];
      setTickets(list);
      // Keep the open ticket in sync (status changes from the trigger, new notes)
      setSelected(sel => sel ? (list.find(t => t.id === sel.id) ?? sel) : sel);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { void loadTickets(); }, [loadTickets]);
  useLiveRefetch("support_tickets", undefined, loadTickets);

  const filtered = tickets.filter(t => {
    if (statusFilter !== "all" && t.status !== statusFilter) return false;
    if (priorityFilter !== "all" && t.priority !== priorityFilter) return false;
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      (t.title ?? t.subject ?? "").toLowerCase().includes(q) ||
      (t.userEmail ?? "").toLowerCase().includes(q) ||
      t.id.toLowerCase().includes(q)
    );
  });

  return (
    <div className="flex h-full min-h-0">
      {/* List panel — full width on phones, hidden while a ticket is open there */}
      <div className={`${selected ? "hidden md:flex" : "flex"} w-full md:w-80 shrink-0 flex-col md:border-r border-[#1a1a1a] min-h-0`}>
        <div className="p-3 space-y-2 border-b border-[#1a1a1a] shrink-0">
          <div className="relative">
            <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[#555]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/>
            </svg>
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search tickets..."
              className="w-full pl-8 pr-3 py-1.5 bg-[#0a0a0a] border border-[#2a2a2a] rounded text-[14px] text-[#ededed] placeholder-[#555] outline-none focus:border-[#444]"
            />
          </div>
          <div className="flex gap-2">
            <Select
              value={statusFilter}
              onChange={e => setStatusFilter(e.target.value)}
              className="text-[13px]"
              wrapperClassName="flex-1"
            >
              <option value="all">All Status</option>
              <option value="open">Open</option>
              <option value="in-progress">In Progress</option>
              <option value="resolved">Resolved</option>
              <option value="closed">Closed</option>
            </Select>
            <Select
              value={priorityFilter}
              onChange={e => setPriorityFilter(e.target.value)}
              className="text-[13px]"
              wrapperClassName="flex-1"
            >
              <option value="all">All Priority</option>
              <option value="urgent">Urgent</option>
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
            </Select>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto min-h-0">
          {loading ? (
            <div className="p-4 space-y-2">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="h-16 skeleton rounded" />
              ))}
            </div>
          ) : error ? (
            <div className="p-4 text-[#f44] text-[14px]">{error}</div>
          ) : filtered.length === 0 ? (
            <div className="p-8 text-center text-[#555] text-[14px]">No tickets found</div>
          ) : (
            filtered.map(t => (
              <button
                key={t.id}
                onClick={() => setSelected(selected?.id === t.id ? null : t)}
                className={`w-full text-left px-3 py-3 border-b border-[#1a1a1a] transition-colors ${
                  selected?.id === t.id ? "bg-[#111]" : "hover:bg-[#0a0a0a]"
                }`}
              >
                <div className="flex items-start justify-between gap-2 mb-1.5">
                  <span className="text-[14px] text-[#ededed] font-medium leading-tight line-clamp-1 flex-1">
                    {t.title ?? t.subject ?? "Untitled"}
                  </span>
                  <StatusBadge status={t.status} />
                </div>
                <div className="flex items-center justify-between">
                  <PriorityDot priority={t.priority} />
                  <span className="text-[12px] text-[#555]">
                    {t.createdAt ? relTime(t.createdAt) : ""}
                  </span>
                </div>
                {t.userEmail && (
                  <div className="mt-1 text-[12px] text-[#555] truncate">{t.userEmail}</div>
                )}
              </button>
            ))
          )}
        </div>

        {!loading && !error && (
          <div className="px-3 py-2 border-t border-[#1a1a1a] text-[12px] text-[#555] shrink-0">
            {filtered.length} ticket{filtered.length !== 1 ? "s" : ""}
          </div>
        )}
      </div>

      {/* Detail — on phones only shown once a ticket is picked */}
      <div className={`${selected ? "block" : "hidden md:block"} flex-1 min-w-0 min-h-0 overflow-hidden`}>
        {selected ? (
          <TicketDetail
            key={selected.id}
            ticket={selected}
            token={token}
            onBack={() => setSelected(null)}
            onUpdate={updates => {
              const updated = { ...selected, ...updates };
              setSelected(updated);
              setTickets(prev => prev.map(t => t.id === updated.id ? updated : t));
            }}
          />
        ) : (
          <div className="flex flex-col items-center justify-center h-full text-[#555]">
            <svg className="w-8 h-8 mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"/>
            </svg>
            <span className="text-[14px]">Select a ticket to view details</span>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Ticket Detail ────────────────────────────────────────────────────────────

function TicketDetail({
  ticket, token, onUpdate, onBack,
}: {
  ticket: Ticket;
  token?: string;
  onUpdate: (u: Partial<Ticket>) => void;
  onBack?: () => void;
}) {
  const [replies, setReplies]         = useState<Reply[]>([]);
  const [loadingReplies, setLoadingReplies] = useState(true);
  const [replyText, setReplyText]     = useState("");
  const [sending, setSending]         = useState(false);
  const [saving, setSaving]           = useState(false);
  const [saveMsg, setSaveMsg]         = useState("");
  const [notes, setNotes]             = useState(ticket.notes ?? "");
  const [status, setStatus]           = useState<TicketStatus>(ticket.status);
  const [priority, setPriority]       = useState<TicketPriority>(ticket.priority);
  const threadRef                     = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setStatus(ticket.status);
    setPriority(ticket.priority);
    setNotes(ticket.notes ?? "");
  }, [ticket.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Live thread — replies written from Dashboard (user) or here (staff) show
  // up on both sides via Supabase realtime.
  const loadReplies = useCallback(async () => {
    try {
      const res  = await fetch(`/api/admin?action=ticket_replies&ticketId=${encodeURIComponent(ticket.id)}`, {
        headers: { "x-admin-token": token ?? "" }, cache: "no-store",
      });
      const json = await res.json() as { replies?: Reply[] };
      if (res.ok) setReplies(json.replies ?? []);
    } catch { /* keep the last good thread */ }
    setLoadingReplies(false);
  }, [ticket.id, token]);

  useEffect(() => { void loadReplies(); }, [loadReplies]);
  useLiveRefetch("support_ticket_replies", `ticket_id=eq.${ticket.id}`, loadReplies, 20_000);

  useEffect(() => {
    if (threadRef.current) {
      threadRef.current.scrollTop = threadRef.current.scrollHeight;
    }
  }, [replies]);

  async function sendReply() {
    if (!replyText.trim()) return;
    setSending(true);
    const message = replyText.trim();
    try {
      // The DB trigger updates reply_count / last_reply_* on the ticket.
      const res  = await fetch("/api/admin", {
        method: "POST",
        headers: { "x-admin-token": token ?? "", "Content-Type": "application/json" },
        body: JSON.stringify({ action: "ticket_reply", ticketId: ticket.id, message }),
      });
      const json = await res.json() as { error?: string };
      if (!res.ok || json.error) throw new Error(json.error ?? `HTTP ${res.status}`);
      setReplyText("");
      void loadReplies();

      // Best-effort email to the customer — the reply above is already saved.
      fetch("/api/admin", {
        method: "POST",
        headers: { "x-admin-token": token ?? "", "Content-Type": "application/json" },
        body: JSON.stringify({ action: "ticket_notify_reply", ticketId: ticket.id, message }),
      }).catch(() => {});
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setSending(false);
    }
  }

  async function saveChanges() {
    setSaving(true);
    setSaveMsg("");
    try {
      const res  = await fetch("/api/admin", {
        method: "POST",
        headers: { "x-admin-token": token ?? "", "Content-Type": "application/json" },
        body: JSON.stringify({ action: "ticket_update", ticketId: ticket.id, status, priority, notes }),
      });
      const json = await res.json() as { error?: string };
      if (!res.ok || json.error) throw new Error(json.error ?? `HTTP ${res.status}`);
      onUpdate({ status, priority, notes });
      setSaveMsg("Saved");
      setTimeout(() => setSaveMsg(""), 2000);
    } catch (e) {
      setSaveMsg((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  const changed =
    status !== ticket.status ||
    priority !== ticket.priority ||
    notes !== (ticket.notes ?? "");

  return (
    <div className="flex flex-col h-full min-h-0 bg-black relative">
      {/* Top border accent */}
      <div
        className="absolute top-0 left-0 right-0 h-0.5 z-10"
        style={{ background: "linear-gradient(90deg, #0070f3, #3ecf8e)" }}
      />

      {/* Header */}
      <div className="px-4 md:px-5 pt-5 pb-4 border-b border-[#1a1a1a] shrink-0 bg-[#0a0a0a]">
        {onBack && (
          <button onClick={onBack}
            className="md:hidden flex items-center gap-1.5 text-[13px] text-[#888] hover:text-[#ededed] bg-transparent border-none p-0 mb-2 cursor-pointer">
            <svg width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M15 18l-6-6 6-6"/></svg>
            All tickets
          </button>
        )}
        <h2 className="text-[15px] font-semibold text-[#ededed] mb-1 leading-tight">
          {ticket.title ?? ticket.subject ?? "Untitled Ticket"}
        </h2>
        <div className="flex items-center gap-3 text-[13px] text-[#555] flex-wrap">
          <span className="font-mono">#{ticket.id.slice(-8)}</span>
          {ticket.userEmail && <span>{ticket.userEmail}</span>}
          {ticket.userName && <span>· {ticket.userName}</span>}
          {ticket.createdAt && <span>{fullDate(ticket.createdAt)}</span>}
        </div>
      </div>

      {/* Phones: thread then settings stacked in one scroll; md+: side by side */}
      <div className="flex flex-col md:flex-row flex-1 min-h-0 overflow-y-auto md:overflow-hidden">
        {/* Thread area */}
        <div className="flex-1 flex flex-col min-h-[60vh] md:min-h-0">
          {(ticket.description ?? ticket.message) && (
            <div className="px-5 py-4 border-b border-[#111] shrink-0">
              <div className="text-[11px] text-[#555] uppercase tracking-wide mb-2">Original Message</div>
              <p className="text-[14px] text-[#aaa] leading-relaxed whitespace-pre-wrap">
                {ticket.description ?? ticket.message}
              </p>
            </div>
          )}

          <div ref={threadRef} className="flex-1 overflow-y-auto p-4 space-y-3 min-h-0">
            {loadingReplies ? (
              <div className="space-y-3">
                {[1, 2].map(i => <div key={i} className="h-16 skeleton rounded" />)}
              </div>
            ) : replies.length === 0 ? (
              <div className="text-center text-[#555] text-[13px] py-8">No replies yet</div>
            ) : (
              replies.map(r => (
                <div
                  key={r.id}
                  className={`flex gap-3 ${r.isStaff ? "flex-row-reverse" : ""}`}
                >
                  <div
                    className={`max-w-[75%] px-3 py-2.5 rounded-lg ${
                      r.isStaff
                        ? "bg-[rgba(0,112,243,0.1)] border border-[rgba(0,112,243,0.15)]"
                        : "bg-[#111] border border-[#1a1a1a]"
                    }`}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <span
                        className="text-[12px] font-medium"
                        style={{ color: r.isStaff ? "#0070f3" : "#888" }}
                      >
                        {r.isStaff ? "Support" : r.fromEmail}
                      </span>
                      <span className="text-[11px] text-[#444]">
                        {r.createdAt ? relTime(r.createdAt) : ""}
                      </span>
                    </div>
                    <p className="text-[14px] text-[#ededed] leading-relaxed whitespace-pre-wrap">
                      {r.message}
                    </p>
                  </div>
                </div>
              ))
            )}
          </div>

          <div className="px-4 py-3 border-t border-[#1a1a1a] shrink-0">
            <div className="flex gap-2">
              <textarea
                value={replyText}
                onChange={e => setReplyText(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) sendReply(); }}
                placeholder="Type a reply… (Ctrl+Enter to send)"
                rows={2}
                className="flex-1 px-3 py-2 bg-[#0a0a0a] border border-[#2a2a2a] rounded text-[14px] text-[#ededed] placeholder-[#555] outline-none focus:border-[#444] resize-none"
              />
              <button
                onClick={sendReply}
                disabled={sending || !replyText.trim()}
                className="px-4 py-2 bg-[#ededed] text-black rounded text-[13px] font-medium disabled:opacity-40 hover:bg-white transition-colors self-end"
              >
                {sending ? "…" : "Send"}
              </button>
            </div>
          </div>
        </div>

        {/* Right sidebar */}
        <div className="w-full md:w-52 border-t md:border-t-0 md:border-l border-[#1a1a1a] p-4 space-y-4 shrink-0 md:overflow-y-auto bg-[#0a0a0a]">
          <div>
            <label className="block text-[11px] text-[#555] uppercase tracking-wide mb-1.5">Status</label>
            <Select
              value={status}
              onChange={e => setStatus(e.target.value as TicketStatus)}
              className="text-[13px]"
            >
              <option value="open">Open</option>
              <option value="in-progress">In Progress</option>
              <option value="resolved">Resolved</option>
              <option value="closed">Closed</option>
            </Select>
          </div>

          <div>
            <label className="block text-[11px] text-[#555] uppercase tracking-wide mb-1.5">Priority</label>
            <Select
              value={priority}
              onChange={e => setPriority(e.target.value as TicketPriority)}
              className="text-[13px]"
            >
              <option value="urgent">Urgent</option>
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
            </Select>
          </div>

          <div>
            <label className="block text-[11px] text-[#555] uppercase tracking-wide mb-1.5">Internal Notes</label>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              rows={4}
              placeholder="Admin notes…"
              className="w-full px-2 py-1.5 bg-black border border-[#2a2a2a] rounded text-[13px] text-[#ededed] placeholder-[#444] outline-none focus:border-[#444] resize-none"
            />
          </div>

          {changed && (
            <div className="space-y-2">
              <button
                onClick={saveChanges}
                disabled={saving}
                className="w-full py-1.5 bg-[#ededed] text-black rounded text-[13px] font-medium hover:bg-white transition-colors disabled:opacity-50"
              >
                {saving ? "Saving…" : "Save Changes"}
              </button>
              {saveMsg && (
                <p
                  className="text-[12px] text-center"
                  style={{ color: saveMsg === "Saved" ? "#3ecf8e" : "#f44" }}
                >
                  {saveMsg}
                </p>
              )}
            </div>
          )}

          {(ticket.tags ?? []).length > 0 && (
            <div>
              <label className="block text-[11px] text-[#555] uppercase tracking-wide mb-1.5">Tags</label>
              <div className="flex flex-wrap gap-1">
                {ticket.tags!.map(tag => (
                  <span
                    key={tag}
                    className="px-1.5 py-0.5 bg-[#111] border border-[#1a1a1a] rounded text-[11px] text-[#888]"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            </div>
          )}

          {ticket.updatedAt && (
            <div>
              <div className="text-[11px] text-[#555] uppercase tracking-wide mb-0.5">Last Updated</div>
              <div className="text-[12px] text-[#555]">{relTime(ticket.updatedAt)}</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Feedback View ────────────────────────────────────────────────────────────

const FB_KNOWN_KEYS = new Set(["id", "type", "userId", "userEmail", "userName", "serviceKey", "rating", "createdAt"]);
const FB_TEXT_KEYS  = ["comment", "message", "text", "feedback", "notes", "details", "content", "description", "response", "answer", "summary"];

function fbTypeStyle(type?: string) {
  if (type === "interview-assessment") return { color: "#0070f3", bg: "rgba(0,112,243,0.08)",  border: "rgba(0,112,243,0.2)",  label: "Assessment"    };
  if (type === "feature-rating")       return { color: "#3ecf8e", bg: "rgba(62,207,142,0.08)", border: "rgba(62,207,142,0.2)", label: "Feature Rating" };
  return                                      { color: "#888",    bg: "rgba(136,136,136,0.08)",border: "rgba(136,136,136,0.2)",label: type ?? "Other"  };
}

function fbInitials(item: FeedbackItem): string {
  if (item.userName)  return item.userName.split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase();
  if (item.userEmail) return item.userEmail.slice(0, 2).toUpperCase();
  return "?";
}

function fbTextPreview(item: FeedbackItem): string | undefined {
  for (const k of FB_TEXT_KEYS) {
    const v = item[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return undefined;
}

function FbStars({ rating, max = 5 }: { rating: number; max?: number }) {
  const full = Math.round(rating);
  return (
    <div className="flex items-center gap-0.5">
      {Array.from({ length: max }).map((_, i) => (
        <svg key={i} className={`w-3 h-3 ${i < full ? "text-[#f5a623]" : "text-[#2a2a2a]"}`} fill="currentColor" viewBox="0 0 20 20">
          <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z"/>
        </svg>
      ))}
    </div>
  );
}

function FbExtraValue({ value }: { value: unknown }) {
  if (value === null || value === undefined) return <span className="text-[#444]">—</span>;
  if (typeof value === "boolean")  return <span>{value ? "Yes" : "No"}</span>;
  if (typeof value === "number" || typeof value === "string") return <span>{String(value)}</span>;
  if (Array.isArray(value)) {
    return (
      <div className="flex flex-wrap gap-1 mt-1">
        {value.map((v, i) => (
          <span key={i} className="px-1.5 py-0.5 bg-[#111] border border-[#1a1a1a] rounded text-[11px] text-[#888]">
            {typeof v === "object" ? JSON.stringify(v) : String(v)}
          </span>
        ))}
      </div>
    );
  }
  if (typeof value === "object") {
    return (
      <div className="mt-1 space-y-1">
        {Object.entries(value as Record<string, unknown>).map(([k, v]) => (
          <div key={k} className="flex items-start justify-between gap-2">
            <span className="text-[11px] text-[#555] capitalize shrink-0">{humanKey(k)}</span>
            <span className="text-[12px] text-[#888] text-right">{typeof v === "object" ? JSON.stringify(v) : String(v)}</span>
          </div>
        ))}
      </div>
    );
  }
  return <span>{String(value)}</span>;
}

const FB_EXCLUDED_TYPES = ["interview-assessment", "resume-feedback", "interview-feedback"];

function FeedbackView({ token }: { token?: string }) {
  const [items, setItems]           = useState<FeedbackItem[]>([]);
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState<string | null>(null);
  const [serviceKey, setServiceKey] = useState("");
  const [search, setSearch]         = useState("");
  const [selected, setSelected]     = useState<FeedbackItem | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ action: "feedback_list" });
      if (serviceKey.trim()) params.set("serviceKey", serviceKey.trim());
      const res = await fetch(`/api/admin?${params}`, {
        headers: { "x-admin-token": token ?? "" },
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setItems(data.items ?? []);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [token, serviceKey]);

  useEffect(() => { load(); }, [load]);

  const filtered = items.filter(item => {
    // Exclude interview / resume feedback — only show user product reviews
    if (FB_EXCLUDED_TYPES.includes(item.type ?? "")) return false;
    if (/interview|resume/i.test(item.type ?? ""))   return false;
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      (item.userName    ?? "").toLowerCase().includes(q) ||
      (item.userId      ?? "").toLowerCase().includes(q) ||
      (item.userEmail   ?? "").toLowerCase().includes(q) ||
      (item.serviceKey  ?? "").toLowerCase().includes(q) ||
      item.id.toLowerCase().includes(q)
    );
  });

  return (
    <div className="flex h-full min-h-0">
      {/* Left: list */}
      <div className="flex-1 flex flex-col min-h-0">
        {/* Toolbar */}
        <div className="flex items-center gap-3 px-5 py-3 border-b border-[#1a1a1a] shrink-0 flex-wrap">
          <span className="text-[13px] font-medium text-[#555]">User Reviews</span>
          <input
            value={serviceKey}
            onChange={e => setServiceKey(e.target.value)}
            onBlur={() => load()}
            onKeyDown={e => { if (e.key === "Enter") load(); }}
            placeholder="Filter by service key…"
            className="px-3 py-1.5 bg-[#0a0a0a] border border-[#2a2a2a] rounded text-[13px] text-[#ededed] placeholder-[#555] outline-none focus:border-[#444] w-48"
          />
          <div className="relative ml-auto">
            <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[#555]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/>
            </svg>
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search…"
              className="pl-8 pr-3 py-1.5 bg-[#0a0a0a] border border-[#2a2a2a] rounded text-[13px] text-[#ededed] placeholder-[#555] outline-none focus:border-[#444] w-40"
            />
          </div>
        </div>

        {/* Cards */}
        <div className="flex-1 overflow-auto min-h-0 p-4">
          {loading ? (
            <div className="space-y-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="h-24 bg-[#0a0a0a] rounded-xl animate-pulse" />
              ))}
            </div>
          ) : error ? (
            <div className="p-5 text-[#f44] text-[14px]">{error}</div>
          ) : filtered.length === 0 ? (
            <div className="p-10 text-center text-[#555] text-[14px]">No feedback found</div>
          ) : (
            <div className="space-y-2">
              {filtered.map(item => {
                const ts       = fbTypeStyle(item.type);
                const preview  = fbTextPreview(item);
                const initials = fbInitials(item);
                const isScale5 = typeof item.rating === "number" && item.rating >= 1 && item.rating <= 5 && Number.isInteger(item.rating);
                const isNum    = typeof item.rating === "number";
                const isSel    = selected?.id === item.id;

                return (
                  <div
                    key={item.id}
                    onClick={() => setSelected(isSel ? null : item)}
                    className={`rounded-xl border cursor-pointer transition-all ${
                      isSel
                        ? "bg-[#0f0f0f] border-[#2a2a2a]"
                        : "bg-[#0a0a0a] border-[#1a1a1a] hover:border-[#2a2a2a] hover:bg-[#0c0c0c]"
                    }`}
                  >
                    <div className="flex items-start gap-3 p-4">
                      {/* Avatar */}
                      <div className="w-9 h-9 rounded-full bg-[#1a1a1a] border border-[#222] flex items-center justify-center text-[12px] font-semibold text-[#666] shrink-0 uppercase">
                        {initials}
                      </div>

                      {/* Body */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            {item.userName ? (
                              <>
                                <div className="text-[13px] font-semibold text-[#ededed] truncate">{item.userName}</div>
                                <div className="text-[12px] text-[#555] truncate">{item.userEmail ?? item.userId ?? ""}</div>
                              </>
                            ) : (
                              <div className="text-[13px] text-[#888] truncate">{item.userEmail ?? item.userId ?? item.id}</div>
                            )}
                          </div>
                          <div className="flex flex-col items-end gap-1 shrink-0">
                            {isScale5 ? (
                              <FbStars rating={item.rating!} />
                            ) : isNum ? (
                              <span className="text-[13px] font-semibold text-[#ededed]">{item.rating}</span>
                            ) : null}
                            <span className="text-[11px] text-[#3a3a3a]">{item.createdAt ? relTime(item.createdAt) : "—"}</span>
                          </div>
                        </div>

                        {/* Badges row */}
                        <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                          <span
                            className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium border"
                            style={{ color: ts.color, background: ts.bg, borderColor: ts.border }}
                          >
                            {ts.label}
                          </span>
                          {item.serviceKey && (
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] bg-[#0f0f0f] border border-[#1a1a1a] text-[#555]">
                              {item.serviceKey}
                            </span>
                          )}
                        </div>

                        {/* Preview */}
                        {preview && (
                          <p className="mt-2 text-[12px] text-[#555] line-clamp-2 leading-relaxed">
                            {preview}
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {!loading && !error && (
          <div className="px-5 py-2 border-t border-[#1a1a1a] text-[12px] text-[#555] shrink-0">
            {filtered.length} result{filtered.length !== 1 ? "s" : ""}
          </div>
        )}
      </div>

      {/* Right: detail panel */}
      {selected && (
        <div className="fixed inset-x-0 top-0 bottom-14 sm:bottom-0 z-40 w-full md:static md:inset-auto md:z-auto md:w-96 md:border-l border-[#1a1a1a] flex flex-col min-h-0 bg-[#050505]">
          {/* Panel header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-[#1a1a1a] shrink-0">
            <span className="text-[14px] font-semibold text-[#ededed]">Feedback Detail</span>
            <button onClick={() => setSelected(null)} className="text-[#555] hover:text-[#888] text-xl leading-none">×</button>
          </div>

          <div className="flex-1 overflow-y-auto min-h-0">
            {/* User block */}
            <div className="flex items-center gap-3 p-4 border-b border-[#111]">
              <div className="w-11 h-11 rounded-full bg-[#1a1a1a] border border-[#222] flex items-center justify-center text-[14px] font-semibold text-[#666] uppercase shrink-0">
                {fbInitials(selected)}
              </div>
              <div className="min-w-0">
                {selected.userName && (
                  <div className="text-[14px] font-semibold text-[#ededed] truncate">{selected.userName}</div>
                )}
                <div className="text-[12px] text-[#555] truncate">{selected.userEmail ?? selected.userId ?? "—"}</div>
                {selected.userId && selected.userEmail && (
                  <div className="text-[11px] text-[#2a2a2a] font-mono truncate mt-0.5">{selected.userId}</div>
                )}
              </div>
            </div>

            <div className="p-4 space-y-4">
              {/* Meta grid */}
              <div className="grid grid-cols-2 gap-x-4 gap-y-3">
                {/* Type */}
                <div>
                  <div className="text-[11px] text-[#444] uppercase tracking-wide mb-1">Type</div>
                  {(() => {
                    const ts = fbTypeStyle(selected.type);
                    return (
                      <span
                        className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium border"
                        style={{ color: ts.color, background: ts.bg, borderColor: ts.border }}
                      >
                        {ts.label}
                      </span>
                    );
                  })()}
                </div>

                {/* Rating */}
                {selected.rating !== undefined && selected.rating !== null && (
                  <div>
                    <div className="text-[11px] text-[#444] uppercase tracking-wide mb-1">Rating</div>
                    {typeof selected.rating === "number" && selected.rating >= 1 && selected.rating <= 5 ? (
                      <div className="flex items-center gap-1.5">
                        <FbStars rating={selected.rating} />
                        <span className="text-[12px] text-[#555]">{selected.rating}/5</span>
                      </div>
                    ) : (
                      <span className="text-[13px] font-semibold text-[#ededed]">{String(selected.rating)}</span>
                    )}
                  </div>
                )}

                {/* Service */}
                {selected.serviceKey && (
                  <div>
                    <div className="text-[11px] text-[#444] uppercase tracking-wide mb-1">Service</div>
                    <span className="text-[12px] text-[#888] font-mono">{selected.serviceKey}</span>
                  </div>
                )}

                {/* Date */}
                <div>
                  <div className="text-[11px] text-[#444] uppercase tracking-wide mb-1">Submitted</div>
                  <div className="text-[12px] text-[#666]">{selected.createdAt ? fullDate(selected.createdAt) : "—"}</div>
                </div>
              </div>

              {/* Text fields */}
              {FB_TEXT_KEYS.map(k => {
                const v = selected[k];
                if (typeof v !== "string" || !v.trim()) return null;
                return (
                  <div key={k}>
                    <div className="text-[11px] text-[#444] uppercase tracking-wide mb-1.5">
                      {humanKey(k)}
                    </div>
                    <div className="text-[13px] text-[#aaa] leading-relaxed bg-[#0a0a0a] border border-[#1a1a1a] rounded-lg p-3">
                      {v}
                    </div>
                  </div>
                );
              })}

              {/* Extra fields (non-text, non-known) */}
              {(() => {
                const extras = Object.entries(selected).filter(
                  ([k]) => !FB_KNOWN_KEYS.has(k) && !FB_TEXT_KEYS.includes(k)
                );
                if (extras.length === 0) return null;
                return (
                  <div>
                    <div className="text-[11px] text-[#444] uppercase tracking-wide mb-2">Additional</div>
                    <div className="bg-[#0a0a0a] border border-[#1a1a1a] rounded-lg overflow-hidden divide-y divide-[#111]">
                      {extras.map(([k, v]) => (
                        <div key={k} className="px-3 py-2.5">
                          <div className="text-[11px] text-[#444] uppercase tracking-wide mb-0.5">
                            {humanKey(k)}
                          </div>
                          <div className="text-[12px] text-[#888]">
                            <FbExtraValue value={v} />
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })()}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Surveys View ─────────────────────────────────────────────────────────────

function SurveysView({ token }: { token?: string }) {
  const [surveys, setSurveys]       = useState<Survey[]>([]);
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState<string | null>(null);
  const [userFilter, setUserFilter] = useState("");
  const [search, setSearch]         = useState("");
  const [selected, setSelected]     = useState<Survey | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ action: "surveys" });
      if (userFilter.trim()) params.set("userId", userFilter.trim());
      const res = await fetch(`/api/admin?${params}`, {
        headers: { "x-admin-token": token ?? "" },
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setSurveys(data.surveys ?? []);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [token, userFilter]);

  useEffect(() => { load(); }, [load]);

  const filtered = surveys.filter(s => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      (s.userId ?? "").toLowerCase().includes(q) ||
      (s.userEmail ?? "").toLowerCase().includes(q) ||
      s.id.toLowerCase().includes(q)
    );
  });

  return (
    <div className="flex h-full min-h-0">
      <div className="flex-1 flex flex-col min-h-0">
        {/* Toolbar */}
        <div className="flex items-center gap-3 px-5 py-3 border-b border-[#1a1a1a] shrink-0">
          <div className="relative">
            <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[#555]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/>
            </svg>
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search surveys…"
              className="pl-8 pr-3 py-1.5 bg-[#0a0a0a] border border-[#2a2a2a] rounded text-[13px] text-[#ededed] placeholder-[#555] outline-none focus:border-[#444] w-52"
            />
          </div>
          <input
            value={userFilter}
            onChange={e => setUserFilter(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") load(); }}
            placeholder="Filter by user ID…"
            className="px-3 py-1.5 bg-[#0a0a0a] border border-[#2a2a2a] rounded text-[13px] text-[#ededed] placeholder-[#555] outline-none focus:border-[#444] w-44"
          />
          <button
            onClick={load}
            className="px-3 py-1.5 bg-[#0a0a0a] border border-[#2a2a2a] rounded text-[13px] text-[#888] hover:text-[#ededed] transition-colors"
          >
            Apply
          </button>
        </div>

        {/* Grid */}
        <div className="flex-1 overflow-auto min-h-0 p-4">
          {loading ? (
            <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="h-28 skeleton rounded" />
              ))}
            </div>
          ) : error ? (
            <div className="text-[#f44] text-[14px]">{error}</div>
          ) : filtered.length === 0 ? (
            <div className="text-center text-[#555] text-[14px] py-16">No surveys found</div>
          ) : (
            <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
              {filtered.map(s => {
                const dataKeys = Object.keys(s).filter(k =>
                  !["id", "userId", "userEmail", "createdAt"].includes(k)
                );
                return (
                  <button
                    key={s.id}
                    onClick={() => setSelected(selected?.id === s.id ? null : s)}
                    className={`text-left p-4 rounded border transition-colors ${
                      selected?.id === s.id
                        ? "bg-[#111] border-[#2a2a2a]"
                        : "bg-[#0a0a0a] border-[#1a1a1a] hover:bg-[#111] hover:border-[#2a2a2a]"
                    }`}
                  >
                    <div className="flex items-start justify-between mb-2">
                      <span className="text-[13px] font-medium text-[#ededed] truncate flex-1">
                        {s.userEmail ?? s.userId ?? s.id.slice(-8)}
                      </span>
                      <span className="text-[11px] text-[#555] shrink-0 ml-2">
                        {s.createdAt ? relTime(s.createdAt) : ""}
                      </span>
                    </div>
                    <div className="text-[12px] text-[#555]">
                      {dataKeys.length} field{dataKeys.length !== 1 ? "s" : ""}
                      {dataKeys.length > 0 && (
                        <span className="ml-1 text-[#333]">
                          · {dataKeys.slice(0, 3).join(", ")}{dataKeys.length > 3 ? "…" : ""}
                        </span>
                      )}
                    </div>
                    <div className="mt-2 text-[11px] text-[#333] font-mono truncate">{s.id}</div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {!loading && !error && (
          <div className="px-5 py-2 border-t border-[#1a1a1a] text-[12px] text-[#555] shrink-0">
            {filtered.length} response{filtered.length !== 1 ? "s" : ""}
          </div>
        )}
      </div>

      {/* Detail */}
      {selected && (
        <div className="fixed inset-x-0 top-0 bottom-14 sm:bottom-0 z-40 w-full md:static md:inset-auto md:z-auto md:w-96 md:border-l border-[#1a1a1a] flex flex-col min-h-0 bg-[#0a0a0a]">
          <div className="flex items-center justify-between px-4 py-3 border-b border-[#1a1a1a] shrink-0">
            <span className="text-[14px] font-medium text-[#ededed]">Survey Response</span>
            <button onClick={() => setSelected(null)} className="text-[#555] hover:text-[#888] text-xl leading-none">×</button>
          </div>
          <div className="flex-1 overflow-y-auto p-4 space-y-4 min-h-0">
            {[
              { label: "ID",      value: selected.id },
              { label: "User",    value: selected.userEmail ?? selected.userId },
              { label: "Created", value: selected.createdAt ? fullDate(selected.createdAt) : undefined },
            ].filter(f => f.value).map(f => (
              <div key={f.label}>
                <div className="text-[11px] text-[#555] uppercase tracking-wide mb-0.5">{f.label}</div>
                <div className="text-[14px] text-[#ededed]">{f.value}</div>
              </div>
            ))}
            {Object.entries(selected)
              .filter(([k]) => !["id", "userId", "userEmail", "createdAt"].includes(k))
              .map(([k, v]) => (
                <div key={k}>
                  <div className="text-[11px] text-[#555] uppercase tracking-wide mb-0.5">{humanKey(k)}</div>
                  <div className="text-[13px] text-[#ededed]">
                    {typeof v === "object" ? (
                      <pre className="text-[12px] text-[#888] bg-[#050505] border border-[#1a1a1a] rounded p-2 overflow-auto whitespace-pre-wrap break-all">
                        {JSON.stringify(v, null, 2)}
                      </pre>
                    ) : (
                      String(v ?? "")
                    )}
                  </div>
                </div>
              ))}
          </div>
        </div>
      )}
    </div>
  );
}
