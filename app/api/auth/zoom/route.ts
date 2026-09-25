// app/api/auth/zoom/route.ts
// Starts Zoom OAuth flow
export const runtime = "nodejs";
import { NextRequest, NextResponse } from "next/server";

export async function GET(_req: NextRequest) {
  const url = new URL("https://zoom.us/oauth/authorize");
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id",     process.env.ZOOM_CLIENT_ID!);
  url.searchParams.set("redirect_uri",  process.env.ZOOM_REDIRECT_URI!);
  return NextResponse.redirect(url.toString());
}