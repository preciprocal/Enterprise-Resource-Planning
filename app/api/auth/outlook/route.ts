// app/api/auth/outlook/route.ts
// Starts connecting the signed-in admin's Outlook mailbox (lib/outlook.ts).
export const runtime = "nodejs";
import { NextRequest, NextResponse } from "next/server";
import { getAdmin } from "@/lib/admin-auth";
import { createOAuthState } from "@/lib/oauth-state";
import { hasOutlook, outlookAuthorizeUrl, outlookServerEnabled, pkcePair, PKCE_COOKIE } from "@/lib/outlook";

// Called with the admin token; returns the Microsoft URL rather than
// redirecting, because a plain link cannot carry that token.
export async function GET(req: NextRequest) {
  const admin = await getAdmin(req);
  if (!admin?.email) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  if (!outlookServerEnabled()) return NextResponse.json({ error: "MS_MAIL_CLIENT_SECRET is not set" }, { status: 501 });
  const first = !(await hasOutlook(admin.email));
  const { verifier, challenge } = pkcePair();
  const res = NextResponse.json({ url: outlookAuthorizeUrl(req.nextUrl.origin, createOAuthState(admin.email), first, challenge) });
  res.cookies.set(PKCE_COOKIE, verifier, { httpOnly: true, secure: req.nextUrl.protocol === "https:", sameSite: "lax", path: "/api/auth/callback/outlook", maxAge: 600 });
  return res;
}
