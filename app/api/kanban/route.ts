// app/api/kanban/route.ts
// ─────────────────────────────────────────────────────────────────────────────
// Persists Kanban board state (columns + cards + comments) to Supabase
// (erp_kanban_boards / erp_kanban_comments — see supabase/erp_schema.sql).
// Also returns the list of admin users for the assignee picker.
//
// GET  ?action=board          → returns { columns }
// GET  ?action=admins         → returns { admins: AdminUser[] }
// POST ?action=save-board     → body: { columns } → saves full board state
// POST ?action=add-comment    → body: { cardId, colId, comment } → appends comment
// POST ?action=delete-comment → body: { cardId, colId, commentId } → removes comment
//
// All endpoints require an admin x-admin-token header (same as /api/admin).
// ─────────────────────────────────────────────────────────────────────────────
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { getAdmin, allowedEmails } from "@/lib/admin-auth";

const BOARD_ID = "board";
const sb = () => getSupabaseAdmin();

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Column = { id: string; cards?: any[] };

async function loadColumns(): Promise<Column[] | null> {
  const { data, error } = await sb().from("erp_kanban_boards").select("columns").eq("id", BOARD_ID).maybeSingle();
  if (error) throw new Error(error.message);
  return (data?.columns as Column[] | undefined) ?? null;
}

async function saveColumns(columns: unknown, uid: string | null) {
  const { error } = await sb().from("erp_kanban_boards").upsert(
    { id: BOARD_ID, columns, updated_by: uid, updated_at: new Date().toISOString() },
    { onConflict: "id" },
  );
  if (error) throw new Error(error.message);
}

// ─── GET ──────────────────────────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  const admin = await getAdmin(req);
  if (!admin) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });

  const action = req.nextUrl.searchParams.get("action") ?? "board";

  // ── Return admin users for the assignee picker ────────────────────────────
  if (action === "admins") {
    // Assignees = people allowed into the ERP (access list)
    const emails = [...(await allowedEmails())];
    const { data, error } = emails.length
      ? await sb().from("profiles").select("user_id,name,email").in("email", emails)
      : { data: [], error: null };
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    const admins = (data ?? []).map(d => ({
      id:    d.user_id as string,
      name:  (d.name ?? d.email ?? "Admin") as string,
      email: (d.email ?? "") as string,
      role:  "Admin",
      // Deterministic color from uid
      color: ["#4F6FF0","#7C4FE0","#059669","#DC2626","#EA580C","#0891B2","#9333EA","#D97706"][
        (d.user_id as string).split("").reduce((a, c) => a + c.charCodeAt(0), 0) % 8
      ],
    }));
    return NextResponse.json({ admins });
  }

  // ── Return saved board ────────────────────────────────────────────────────
  try {
    return NextResponse.json({ columns: await loadColumns() }); // null on first load
  } catch (e) {
    return NextResponse.json({ columns: null, error: (e as Error).message }, { status: 500 });
  }
}

// ─── POST ─────────────────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  const admin = await getAdmin(req);
  if (!admin) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });

  const action = req.nextUrl.searchParams.get("action") ?? "save-board";
  const body   = await req.json() as Record<string, unknown>;

  try {
    // ── Save full board ─────────────────────────────────────────────────────
    if (action === "save-board") {
      await saveColumns(body.columns, admin.userId);
      return NextResponse.json({ ok: true });
    }

    // ── Add a comment ───────────────────────────────────────────────────────
    if (action === "add-comment") {
      const { cardId, colId, comment } = body as {
        cardId: string; colId: string;
        comment: { id: string; author: string; authorColor: string; text: string; createdAt: string };
      };

      const cols = await loadColumns();
      if (!cols) return NextResponse.json({ error: "Board not found" }, { status: 404 });
      const col = cols.find(c => c.id === colId);
      if (!col) return NextResponse.json({ error: "Column not found" }, { status: 404 });
      const card = col.cards?.find((c: { id: string }) => c.id === cardId);
      if (!card) return NextResponse.json({ error: "Card not found" }, { status: 404 });

      card.commentList = [...(card.commentList ?? []), comment];
      await saveColumns(cols, admin.userId);

      // Also write to a flat comments table for easy querying
      await sb().from("erp_kanban_comments").upsert({
        id: comment.id, card_id: cardId, col_id: colId, author: comment.author,
        author_color: comment.authorColor, text: comment.text, user_id: admin.userId,
        created_at: comment.createdAt ? new Date(comment.createdAt).toISOString() : new Date().toISOString(),
      });

      return NextResponse.json({ ok: true });
    }

    // ── Delete a comment ────────────────────────────────────────────────────
    if (action === "delete-comment") {
      const { cardId, colId, commentId } = body as { cardId: string; colId: string; commentId: string };

      const cols = await loadColumns();
      if (!cols) return NextResponse.json({ error: "Board not found" }, { status: 404 });
      const card = cols.find(c => c.id === colId)?.cards?.find((c: { id: string }) => c.id === cardId);
      if (card) card.commentList = (card.commentList ?? []).filter((c: { id: string }) => c.id !== commentId);
      await saveColumns(cols, admin.userId);
      await sb().from("erp_kanban_comments").delete().eq("id", commentId);

      return NextResponse.json({ ok: true });
    }
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
