// scripts/migrate-erp-firestore.cjs
// ─────────────────────────────────────────────────────────────────────────────
// One-off copy of the ERP's OWN Firestore data into the erp_* Supabase tables.
// (User/subscription/support data is the Dashboard's and was migrated there.)
//
//   Firestore                         → Supabase
//   logs                              → erp_logs          (details.firestore_id dedupes re-runs)
//   users.{lastContactedAt,…Coupon}   → erp_user_meta     (only users present in Supabase)
//   kanban/board                      → erp_kanban_boards (only if Supabase has no board yet)
//   kanban_comments                   → erp_kanban_comments
//   integrations/{google_meet,zoom}   → erp_integrations  (only if not already connected)
//
// Firebase uids are mapped to Supabase uuids through legacy_user_id_map.
//
// Prereqs: supabase/erp_schema.sql has been run; FIREBASE_ADMIN_* and
// SUPABASE_* are in .env. firebase-admin needs @opentelemetry/api at runtime:
//   npm i --no-save @opentelemetry/api
//   node scripts/migrate-erp-firestore.cjs            # dry run (counts only)
//   node scripts/migrate-erp-firestore.cjs --write    # actually write
// ─────────────────────────────────────────────────────────────────────────────
require("@next/env").loadEnvConfig(process.cwd());
const { initializeApp, cert } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");
const { createClient } = require("@supabase/supabase-js");

const WRITE = process.argv.includes("--write");
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

initializeApp({ credential: cert({
  projectId:   process.env.FIREBASE_ADMIN_PROJECT_ID,
  clientEmail: process.env.FIREBASE_ADMIN_CLIENT_EMAIL,
  privateKey:  process.env.FIREBASE_ADMIN_PRIVATE_KEY.replace(/\\n/g, "\n"),
}) });
const fs = getFirestore();
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const toIso = v => {
  if (!v) return null;
  if (typeof v.toDate === "function") return v.toDate().toISOString();
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d.toISOString();
};

async function must(p) { const { data, error } = await p; if (error) throw new Error(error.message); return data; }

async function main() {
  console.log(WRITE ? "── WRITE MODE ──" : "── DRY RUN (pass --write to apply) ──");

  // uid map + known Supabase users
  const map = new Map((await must(sb.from("legacy_user_id_map").select("firebase_uid,user_id"))).map(r => [r.firebase_uid, r.user_id]));
  const known = new Set((await must(sb.from("profiles").select("user_id"))).map(r => r.user_id));
  const resolve = uid => (uid && UUID_RE.test(uid) ? uid : map.get(uid)) ?? null;

  // ── logs ──
  const existing = new Set((await must(sb.from("erp_logs").select("details").not("details->>firestore_id", "is", null)))
    .map(r => r.details?.firestore_id));
  const logs = (await fs.collection("logs").get()).docs.filter(d => !existing.has(d.id));
  const rows = logs.map(d => {
    const l = d.data();
    return {
      user_id: resolve(l.userId) ?? l.userId ?? null,
      user_name: l.userName ?? null, user_email: l.userEmail ?? null,
      type: l.type ?? "action", action: l.action ?? null, path: l.path ?? null,
      ip: l.ip ?? null, user_agent: l.userAgent ?? null, browser: l.browser ?? null, os: l.os ?? null, device: l.device ?? null,
      city: l.city ?? null, country: l.country ?? null, country_code: l.countryCode ?? null,
      details: { ...(l.details ?? {}), firestore_id: d.id, firebase_uid: l.userId ?? null },
      timestamp: toIso(l.timestamp) ?? toIso(l.createdAt) ?? new Date().toISOString(),
    };
  });
  console.log(`logs: ${rows.length} to copy (${existing.size} already copied)`);
  if (WRITE) for (let i = 0; i < rows.length; i += 500) await must(sb.from("erp_logs").insert(rows.slice(i, i + 500)));

  // ── user contact / coupon metadata ──
  const users = (await fs.collection("users").get()).docs;
  const meta = [];
  let skipped = 0;
  for (const d of users) {
    const u = d.data();
    const s = u.subscription ?? {};
    if (!u.lastContactedAt && !s.lastAppliedCoupon) continue;
    const id = resolve(d.id);
    if (!id || !known.has(id)) { skipped++; continue; }
    meta.push({
      user_id: id,
      last_contacted_at: toIso(u.lastContactedAt), last_contact_subject: u.lastContactSubject ?? null,
      last_contact_sent_by: u.lastContactSentBy ?? null,
      last_applied_coupon: s.lastAppliedCoupon ?? null, last_coupon_applied_at: toIso(s.lastCouponAppliedAt),
    });
  }
  console.log(`erp_user_meta: ${meta.length} to upsert, ${skipped} skipped (user not in Supabase yet)`);
  if (WRITE && meta.length) await must(sb.from("erp_user_meta").upsert(meta, { onConflict: "user_id" }));

  // ── kanban ──
  const board = await fs.collection("kanban").doc("board").get();
  const haveBoard = (await must(sb.from("erp_kanban_boards").select("id").eq("id", "board"))).length > 0;
  if (board.exists && !haveBoard) {
    console.log(`kanban board: copying ${(board.data().columns ?? []).length} columns`);
    if (WRITE) await must(sb.from("erp_kanban_boards").insert({ id: "board", columns: board.data().columns ?? [], updated_at: toIso(board.data().updatedAt) ?? new Date().toISOString() }));
  } else console.log(`kanban board: ${board.exists ? "Supabase already has one — skipped" : "none in Firestore"}`);

  const comments = (await fs.collection("kanban_comments").get()).docs.map(d => {
    const c = d.data();
    return { id: d.id, card_id: c.cardId, col_id: c.colId ?? null, author: c.author ?? null, author_color: c.authorColor ?? null,
      text: c.text ?? "", user_id: (id => (id && known.has(id) ? id : null))(resolve(c.uid)), created_at: toIso(c.createdAt) ?? new Date().toISOString() };
  }).filter(c => c.card_id);
  console.log(`kanban comments: ${comments.length}`);
  if (WRITE && comments.length) await must(sb.from("erp_kanban_comments").upsert(comments, { onConflict: "id" }));

  // ── integrations ──
  for (const id of ["google_meet", "zoom"]) {
    const doc = await fs.collection("integrations").doc(id).get();
    const have = (await must(sb.from("erp_integrations").select("refresh_token").eq("id", id)))[0]?.refresh_token;
    if (!doc.exists || have) { console.log(`integration ${id}: ${doc.exists ? "already connected — skipped" : "none"}`); continue; }
    const t = doc.data();
    console.log(`integration ${id}: copying`);
    if (WRITE) await must(sb.from("erp_integrations").upsert({ id, access_token: t.access_token ?? null, refresh_token: t.refresh_token ?? null,
      expires_at: t.expires_at ?? null, connected_at: toIso(t.connected_at) }, { onConflict: "id" }));
  }

  console.log(WRITE ? "Done." : "Dry run complete — nothing written.");
}

main().catch(e => { console.error("Migration failed:", e.message); process.exit(1); });
