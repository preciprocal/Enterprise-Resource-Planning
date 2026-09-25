// app/api/auth/google/route.ts
// Starts the Google OAuth flow → redirects user to Google consent screen
export const runtime = "nodejs";
import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  const clientId     = process.env.GOOGLE_CLIENT_ID!;
  const redirectUri  = process.env.GOOGLE_REDIRECT_URI!; // e.g. https://app.preciprocal.com/api/auth/callback/google
  const scope = [
    "https://www.googleapis.com/auth/calendar.events",
    "https://www.googleapis.com/auth/calendar.readonly",
  ].join(" ");

  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id",     clientId);
  url.searchParams.set("redirect_uri",  redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope",         scope);
  url.searchParams.set("access_type",   "offline");   // gets refresh_token
  url.searchParams.set("prompt",        "consent");   // forces refresh_token every time

  return NextResponse.redirect(url.toString());
}