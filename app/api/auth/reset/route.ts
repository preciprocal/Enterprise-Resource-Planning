// app/api/auth/reset/route.ts
// ─────────────────────────────────────────────────────────────────────────────
// "Forgot password" for the ERP. POST { email } → emails a one-time recovery
// link that lands back on the ERP (/?reset_token=…), where the user sets a new
// password (see app/page.tsx).
//
// Why not supabase.auth.resetPasswordForEmail(): the shared Supabase project's
// recovery email template sends people to the Dashboard's /auth/confirm →
// /reset-password, not here. So the link is generated with the admin API and
// the email is sent via Resend, independent of the template.
//
// Only emails on the ERP access list get a link, and the response is always
// the same so the endpoint can't be used to probe which emails exist.
// The password is the user's Supabase account password, shared with the
// Dashboard — resetting it here changes it there too.
// ─────────────────────────────────────────────────────────────────────────────
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { isAllowedEmail, normaliseEmail } from "@/lib/admin-auth";

const GENERIC = { ok: true, message: "If this email has ERP access, a reset link is on its way." };
const COOLDOWN_MS = 60_000;
const lastSent = new Map<string, number>();   // per-instance throttle; Supabase also rate-limits

function escHtml(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export async function POST(req: NextRequest) {
  let email = "";
  try { email = normaliseEmail(String((await req.json() as { email?: string }).email ?? "")); }
  catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: "Enter a valid email address" }, { status: 400 });
  }

  // Throttle before any lookup so timing doesn't reveal list membership.
  const prev = lastSent.get(email) ?? 0;
  if (Date.now() - prev < COOLDOWN_MS) return NextResponse.json(GENERIC);
  lastSent.set(email, Date.now());

  try {
    if (!(await isAllowedEmail(email))) return NextResponse.json(GENERIC);

    const { data, error } = await getSupabaseAdmin().auth.admin.generateLink({ type: "recovery", email });
    if (error || !data?.properties?.hashed_token) {
      // Typically "user not found" — allowlisted but no account yet.
      console.warn("[auth/reset] no link generated:", error?.message);
      return NextResponse.json(GENERIC);
    }

    // Prefer a configured public URL over the request's Host header, which a
    // client can spoof to point the emailed link at another site.
    const base = (process.env.ERP_PUBLIC_URL ?? req.nextUrl.origin).replace(/\/+$/, "");
    const link = `${base}/?reset_token=${encodeURIComponent(data.properties.hashed_token)}`;

    const resendKey = process.env.RESEND_API_KEY;
    if (!resendKey) {
      console.log(`📧 [DRAFT — no RESEND_API_KEY] ERP password reset for ${email}: ${link}`);
      return NextResponse.json(GENERIC);
    }
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: process.env.ADMIN_FROM_EMAIL ?? "support@preciprocal.com",
        to: [email],
        subject: "Reset your Preciprocal password",
        html:
          `<div style="font-family:-apple-system,BlinkMacSystemFont,'Inter',sans-serif;max-width:480px;margin:0 auto;padding:32px 24px;color:#0F172A">`
          + `<h2 style="margin:0 0 12px;font-size:20px">Reset your password</h2>`
          + `<p style="margin:0 0 20px;font-size:14px;line-height:1.6;color:#374151">Someone asked to reset the password for <strong>${escHtml(email)}</strong> on Preciprocal ERP. `
          + `This is the same password you use for the Preciprocal app.</p>`
          + `<a href="${escHtml(link)}" style="display:inline-block;background:#0F172A;color:#fff;text-decoration:none;padding:12px 22px;border-radius:8px;font-size:14px;font-weight:600">Set a new password</a>`
          + `<p style="margin:20px 0 0;font-size:12px;line-height:1.6;color:#6B7280">The link works once and expires in about an hour. If you didn't ask for this, you can ignore this email — your password won't change.</p>`
          + `</div>`,
      }),
    });
    if (!res.ok) console.error("[auth/reset] Resend error:", res.status, await res.text().then(t => t.slice(0, 200)));
  } catch (e) {
    console.error("[auth/reset] failed:", e);
  }
  return NextResponse.json(GENERIC);
}
