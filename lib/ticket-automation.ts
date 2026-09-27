// lib/ticket-automation.ts
// Support-ticket automation for the ERP:
//   • syncTicketCards()   — every open ticket gets a card in the Tasks board's "To Do"
//   • findOverdueTickets() — tickets where the customer has waited 24h+ for a staff reply
// State lives in erp_ticket_automation (supabase/erp_ticket_automation.sql).
//
// (Open → In Progress on a staff reply is handled by the Dashboard's
// sync_ticket_on_reply trigger, with a backstop in the ERP's ticket_reply action.)
import "server-only";
import { SupabaseClient } from "@supabase/supabase-js";

const BOARD_ID = "board";
export const REMINDER_AFTER_MS = 24 * 60 * 60 * 1000;

interface TicketRow {
  id: string; subject: string | null; message: string | null; category: string | null;
  status: string; priority: string | null; user_email: string | null; user_name: string | null;
  last_reply_by: string | null; last_reply_at: string | null; created_at: string;
}
const TICKET_COLS = "id,subject,message,category,status,priority,user_email,user_name,last_reply_by,last_reply_at,created_at";

// Empty board skeleton — same column ids as the Tasks tab (KanbanTab DEFAULT_COLUMNS),
// used only when the board has never been saved.
const EMPTY_COLUMNS = [
  { id: "todo",       title: "To Do",       color: "#6366F1", desc: "Ready to be picked up",          cards: [] },
  { id: "inprogress", title: "In Progress", color: "#F59E0B", desc: "WIP - actively being worked on", limit: 4, cards: [] },
  { id: "review",     title: "In Review",   color: "#7C4FE0", desc: "PR open / QA in progress",       limit: 5, cards: [] },
  { id: "done",       title: "Done",        color: "#10B981", desc: "Completed & shipped",            cards: [] },
];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Column = { id: string; cards?: any[] } & Record<string, unknown>;

const PRIORITY: Record<string, string> = { urgent: "critical", high: "high", medium: "medium", low: "low" };
const LABELS: Record<string, string[]> = { technical: ["bug"], bug: ["bug"], feature: ["feature"], "feature-request": ["feature"] };
const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export const ticketUrl = (id: string, base = "") => `${base}/?tab=support&ticket=${id}`;

/** Card shape matches KanbanCard in components/admin/KanbanTab.tsx (+ ticketId). */
function ticketCard(t: TicketRow) {
  const shortId = t.id.slice(0, 8).toUpperCase();
  const who = t.user_name ? `${t.user_name}${t.user_email ? ` <${t.user_email}>` : ""}` : t.user_email ?? "a customer";
  return {
    id: `tkt-${t.id}`,
    ticketId: t.id,
    title: `Support: ${t.subject?.trim() || "Untitled ticket"}`,
    description: t.message?.slice(0, 1000) ?? "",
    story: `Ticket #${shortId} from ${who}${t.category ? ` · ${t.category}` : ""}`,
    priority: PRIORITY[t.priority ?? ""] ?? "medium",
    labels: LABELS[t.category ?? ""] ?? [],
    dueDate: day(Date.parse(t.created_at) + REMINDER_AFTER_MS),   // first-response target
    blockedBy: null,
    subtasks: [{ done: false, label: "Reply to the customer" }, { done: false, label: "Resolve and close the ticket" }],
    commentList: [],
    links: [{ id: `tl-${shortId}`, label: `Open ticket #${shortId}`, url: ticketUrl(t.id) }],
  };
}

/**
 * Adds a To Do card for every open / in-progress ticket that hasn't had one yet.
 * Called when the Tasks board loads, so new tickets show up the next time anyone
 * opens it. A ticket only ever gets one card: once erp_ticket_automation records
 * it, deleting the card from the board is respected.
 * Returns the number of cards added (0 if the automation table is missing).
 */
export async function syncTicketCards(sb: SupabaseClient, actorId: string | null): Promise<number> {
  const [{ data: tickets, error: tErr }, { data: done, error: aErr }] = await Promise.all([
    sb.from("support_tickets").select(TICKET_COLS).in("status", ["open", "in-progress"]).order("created_at", { ascending: true }).limit(200),
    sb.from("erp_ticket_automation").select("ticket_id").not("task_card_id", "is", null),
  ]);
  if (aErr) { console.warn("[tickets→tasks] skipped:", aErr.message, "(run supabase/erp_ticket_automation.sql)"); return 0; }
  if (tErr) throw new Error(tErr.message);

  const seen = new Set((done ?? []).map(r => r.ticket_id as string));
  const fresh = ((tickets ?? []) as TicketRow[]).filter(t => !seen.has(t.id));
  if (!fresh.length) return 0;

  const { data: board, error: bErr } = await sb.from("erp_kanban_boards").select("columns").eq("id", BOARD_ID).maybeSingle();
  if (bErr) throw new Error(bErr.message);
  const columns: Column[] = Array.isArray(board?.columns) && board.columns.length
    ? board.columns as Column[]
    : JSON.parse(JSON.stringify(EMPTY_COLUMNS));

  // Skip tickets whose card is already on the board (e.g. added before the table existed).
  const onBoard = new Set(columns.flatMap(c => (c.cards ?? []).map((k: { ticketId?: string }) => k.ticketId).filter(Boolean)));
  const target = columns.find(c => c.id === "todo") ?? columns[0];
  const newCards = fresh.filter(t => !onBoard.has(t.id)).map(ticketCard);
  target.cards = [...newCards.reverse(), ...(target.cards ?? [])];   // newest ticket on top

  if (newCards.length) {
    const { error } = await sb.from("erp_kanban_boards").upsert(
      { id: BOARD_ID, columns, updated_by: actorId, updated_at: new Date().toISOString() }, { onConflict: "id" });
    if (error) throw new Error(error.message);
  }
  const now = new Date().toISOString();
  const { error: mErr } = await sb.from("erp_ticket_automation").upsert(
    fresh.map(t => ({ ticket_id: t.id, task_card_id: `tkt-${t.id}`, task_added_at: now, updated_at: now })),
    { onConflict: "ticket_id" });
  if (mErr) throw new Error(mErr.message);
  return newCards.length;
}

export interface OverdueTicket {
  id: string; subject: string; userName: string | null; userEmail: string | null;
  priority: string; status: string; waitingSince: string; hoursWaiting: number;
}

/**
 * Tickets where the customer is waiting on us: open or in-progress, the last
 * message isn't from support, and that has been true for 24h+. Excludes waits
 * already covered by a reminder (reminder_for === waitingSince).
 */
export async function findOverdueTickets(sb: SupabaseClient): Promise<OverdueTicket[]> {
  const cutoff = Date.now() - REMINDER_AFTER_MS;
  const [{ data: tickets, error: tErr }, { data: state, error: aErr }] = await Promise.all([
    sb.from("support_tickets").select(TICKET_COLS).in("status", ["open", "in-progress"]).limit(500),
    sb.from("erp_ticket_automation").select("ticket_id,reminder_for"),
  ]);
  if (tErr) throw new Error(tErr.message);
  if (aErr) throw new Error(`${aErr.message} (run supabase/erp_ticket_automation.sql)`);
  const remindedFor = new Map((state ?? []).map(r => [r.ticket_id as string, r.reminder_for as string | null]));

  return ((tickets ?? []) as TicketRow[]).flatMap(t => {
    if (t.last_reply_by === "support") return [];
    const waitingSince = t.last_reply_by === "user" && t.last_reply_at ? t.last_reply_at : t.created_at;
    const ms = Date.parse(waitingSince);
    if (!(ms <= cutoff)) return [];
    const prev = remindedFor.get(t.id);
    if (prev && Date.parse(prev) === ms) return [];
    return [{
      id: t.id, subject: t.subject?.trim() || "Untitled ticket", userName: t.user_name, userEmail: t.user_email,
      priority: t.priority ?? "medium", status: t.status, waitingSince, hoursWaiting: Math.floor((Date.now() - ms) / 3_600_000),
    }];
  }).sort((a, b) => a.waitingSince.localeCompare(b.waitingSince));
}

export async function markReminded(sb: SupabaseClient, tickets: OverdueTicket[]) {
  if (!tickets.length) return;
  const now = new Date().toISOString();
  const { error } = await sb.from("erp_ticket_automation").upsert(
    tickets.map(t => ({ ticket_id: t.id, reminder_sent_at: now, reminder_for: t.waitingSince, updated_at: now })),
    { onConflict: "ticket_id" });
  if (error) throw new Error(error.message);
}
