// app/api/auth/callback/google/route.ts
// Google redirects here after user approves → exchange code for tokens → store in erp_integrations
export const runtime = "nodejs";
import { NextRequest, NextResponse } from "next/server";
import { saveIntegration } from "@/lib/integrations";

export async function GET(req: NextRequest) {
  const code        = req.nextUrl.searchParams.get("code");
  const redirectUri = process.env.GOOGLE_REDIRECT_URI!;

  if (!code) return NextResponse.redirect(new URL("/?tab=kanban&error=google_denied", req.url));

  // Exchange auth code for access + refresh tokens
  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id:     process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      redirect_uri:  redirectUri,
      grant_type:    "authorization_code",
    }),
  });

  const tokens = await tokenRes.json() as {
    access_token: string; refresh_token?: string; expires_in: number;
  };

  if (!tokenRes.ok || !tokens.access_token) {
    console.error("Google token exchange failed:", tokens);
    return NextResponse.redirect(new URL("/?tab=kanban&error=google_token_failed", req.url));
  }

  // Google only returns refresh_token on first consent — keep the stored one if absent
  await saveIntegration("google_meet", {
    access_token:  tokens.access_token,
    refresh_token: tokens.refresh_token,
    expires_at:    Date.now() + tokens.expires_in * 1000,
    connected_at:  new Date().toISOString(),
  });

  return NextResponse.redirect(new URL("/?tab=kanban&connected=google", req.url));
}