// app/api/auth/callback/zoom/route.ts
// Zoom redirects here → exchange code → store tokens
export const runtime = "nodejs";
import { NextRequest, NextResponse } from "next/server";
import { saveIntegration } from "@/lib/integrations";

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  if (!code) return NextResponse.redirect(new URL("/?tab=kanban&error=zoom_denied", req.url));

  const creds = Buffer.from(
    `${process.env.ZOOM_CLIENT_ID}:${process.env.ZOOM_CLIENT_SECRET}`
  ).toString("base64");

  const tokenRes = await fetch("https://zoom.us/oauth/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${creds}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      code,
      grant_type:   "authorization_code",
      redirect_uri: process.env.ZOOM_REDIRECT_URI!,
    }),
  });

  const tokens = await tokenRes.json() as {
    access_token: string; refresh_token: string; expires_in: number;
  };

  if (!tokenRes.ok || !tokens.access_token) {
    console.error("Zoom token exchange failed:", tokens);
    return NextResponse.redirect(new URL("/?tab=kanban&error=zoom_token_failed", req.url));
  }

  await saveIntegration("zoom", {
    access_token:  tokens.access_token,
    refresh_token: tokens.refresh_token,
    expires_at:    Date.now() + tokens.expires_in * 1000,
    connected_at:  new Date().toISOString(),
  });

  return NextResponse.redirect(new URL("/?tab=kanban&connected=zoom", req.url));
}