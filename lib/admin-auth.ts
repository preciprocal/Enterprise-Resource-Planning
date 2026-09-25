// lib/admin-auth.ts
// Server-side admin check shared by every /api route.
// Accepts either the ADMIN_SECRET header (server-to-server) or a Supabase
// access token (sent as x-admin-token) whose sign-in email is on the ERP
// access list. The list is the only gate for people: anyone not on it is
// refused, whatever their profiles.is_admin says.
//
// Access list = ERP_ALLOWED_EMAILS (env; permanent, can't be removed from the
// UI, so you can't lock yourself out) ∪ erp_allowed_emails (managed from the
// ERP's Access tab).
import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export interface AdminIdentity { userId: string | null; email: string; name: string }

export const normaliseEmail = (e: string) => e.trim().toLowerCase();

/** Lower-cased emails from ERP_ALLOWED_EMAILS (comma/space/newline separated). */
export function envAllowedEmails(): Set<string> {
  return new Set(
    (process.env.ERP_ALLOWED_EMAILS ?? "")
      .split(/[\s,;]+/)
      .map(normaliseEmail)
      .filter(Boolean),
  );
}

/** Env list + erp_allowed_emails table. A missing table just means env-only. */
export async function allowedEmails(): Promise<Set<string>> {
  const all = envAllowedEmails();
  const { data } = await getSupabaseAdmin().from("erp_allowed_emails").select("email")
    .then(r => r, () => ({ data: null }));
  (data ?? []).forEach(r => all.add(normaliseEmail(r.email as string)));
  return all;
}

export async function isAllowedEmail(email: string | null | undefined): Promise<boolean> {
  // Fails closed: no email, or an email on neither list, lets nobody in.
  if (!email) return false;
  const e = normaliseEmail(email);
  if (envAllowedEmails().has(e)) return true;
  const { data, error } = await getSupabaseAdmin()
    .from("erp_allowed_emails").select("email").eq("email", e).maybeSingle();
  return !error && !!data;
}

export async function getAdmin(req: NextRequest): Promise<AdminIdentity | null> {
  const secret = process.env.ADMIN_SECRET;
  if (secret && req.headers.get("x-admin-secret") === secret) {
    return { userId: null, email: "", name: "admin-secret" };
  }
  const token = req.headers.get("x-admin-token");
  if (!token) return null;
  try {
    const sb = getSupabaseAdmin();
    const { data, error } = await sb.auth.getUser(token);
    if (error || !data.user) return null;
    // Check the verified auth email, not profiles.email — the latter is
    // editable from the Users tab and must not grant access.
    if (!(await isAllowedEmail(data.user.email))) return null;
    const { data: profile } = await sb
      .from("profiles").select("name").eq("user_id", data.user.id).maybeSingle();
    return { userId: data.user.id, email: data.user.email ?? "", name: profile?.name ?? "" };
  } catch {
    return null;
  }
}

/** Returns a 401 response when the caller is not an admin, otherwise null. */
export async function requireAdmin(req: NextRequest): Promise<NextResponse | null> {
  if (await getAdmin(req)) return null;
  return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
}
