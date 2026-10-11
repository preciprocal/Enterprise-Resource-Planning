// app/api/auth/zoom/route.ts
// Starts Zoom OAuth flow
export const runtime = "nodejs";
import { NextRequest, NextResponse } from "next/server";
import { getAdmin } from "@/lib/admin-auth";
import { createOAuthState } from "@/lib/oauth-state";

// Called by the ERP with its admin token; returns the consent URL (see google/route.ts).
export async function GET(req: NextRequest) {
  const admin = await getAdmin(req);
  if (!admin) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  const url = new URL("https://zoom.us/oauth/authorize");
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id",     process.env.ZOOM_CLIENT_ID!);
  url.searchParams.set("redirect_uri",  process.env.ZOOM_REDIRECT_URI!);
  url.searchParams.set("state",         createOAuthState(admin.email || admin.name));
  return NextResponse.json({ url: url.toString() });
}