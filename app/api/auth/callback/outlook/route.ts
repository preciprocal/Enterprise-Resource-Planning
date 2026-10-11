// app/api/auth/callback/outlook/route.ts
// Microsoft redirects here after the admin approves; the tokens are stored
// for that admin (lib/outlook.ts) and they land back on the Email tab.
export const runtime = "nodejs";
import { NextRequest, NextResponse } from "next/server";
import { verifyOAuthState } from "@/lib/oauth-state";
import { connectOutlook, PKCE_COOKIE } from "@/lib/outlook";

export async function GET(req: NextRequest) {
  const back = (q: string) => {
    const res = NextResponse.redirect(new URL(`/?tab=email&${q}`, req.url));
    res.cookies.set(PKCE_COOKIE, "", { path: "/api/auth/callback/outlook", maxAge: 0 });
    return res;
  };
  const code = req.nextUrl.searchParams.get("code");
  if (!code) {
    // Microsoft sends error + error_description instead of a code; pass the
    // reason through so the tab can show it (e.g. an AADSTS code).
    const msErr = req.nextUrl.searchParams.get("error") ?? "";
    const desc = (req.nextUrl.searchParams.get("error_description") ?? "").split(/\r?\n/)[0].slice(0, 300);
    console.error("[outlook] sign-in returned no code:", msErr, desc);
    return back(`error=outlook_denied&ms_error=${encodeURIComponent(msErr)}&ms_desc=${encodeURIComponent(desc)}`);
  }
  // The admin who started this in the last 10 minutes (lib/oauth-state.ts).
  const adminEmail = verifyOAuthState(req.nextUrl.searchParams.get("state"));
  if (!adminEmail || !adminEmail.includes("@")) return back("error=outlook_state");
  try {
    const verifier = req.cookies.get(PKCE_COOKIE)?.value;
    if (!verifier) return back("error=outlook_state");
    await connectOutlook(adminEmail, code, req.nextUrl.origin, verifier);
  } catch (e) {
    const msg = (e as Error).message;
    console.error("[outlook] token exchange failed:", msg);
    return back(`error=outlook_token_failed&ms_desc=${encodeURIComponent(msg.slice(0, 300))}`);
  }
  return back("connected=outlook");
}
