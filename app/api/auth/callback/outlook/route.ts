// app/api/auth/callback/outlook/route.ts
// Microsoft redirects here after the admin approves; the tokens are stored
// for that admin (lib/outlook.ts) and they land back on the Email tab.
export const runtime = "nodejs";
import { NextRequest, NextResponse } from "next/server";
import { verifyOAuthState } from "@/lib/oauth-state";
import { connectOutlook } from "@/lib/outlook";

export async function GET(req: NextRequest) {
  const back = (q: string) => NextResponse.redirect(new URL(`/?tab=email&${q}`, req.url));
  const code = req.nextUrl.searchParams.get("code");
  if (!code) return back("error=outlook_denied");
  // The admin who started this in the last 10 minutes (lib/oauth-state.ts).
  const adminEmail = verifyOAuthState(req.nextUrl.searchParams.get("state"));
  if (!adminEmail || !adminEmail.includes("@")) return back("error=outlook_state");
  try {
    await connectOutlook(adminEmail, code, req.nextUrl.origin);
  } catch (e) {
    console.error("[outlook] token exchange failed:", (e as Error).message);
    return back("error=outlook_token_failed");
  }
  return back("connected=outlook");
}
