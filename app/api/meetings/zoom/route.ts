// app/api/meetings/zoom/route.ts
// Creates a real Zoom meeting and returns a valid join URL.
export const runtime = "nodejs";
import { NextRequest, NextResponse } from "next/server";
import { getAdmin } from "@/lib/admin-auth";
import { getIntegration, saveIntegration } from "@/lib/integrations";

async function getFreshZoomToken(): Promise<string> {
  const data = await getIntegration("zoom");
  if (!data?.refresh_token) throw new Error("Zoom not connected");
  if (data.access_token && (data.expires_at ?? 0) > Date.now() + 60_000) return data.access_token;

  const creds = Buffer.from(`${process.env.ZOOM_CLIENT_ID}:${process.env.ZOOM_CLIENT_SECRET}`).toString("base64");
  const res   = await fetch("https://zoom.us/oauth/token", {
    method:  "POST",
    headers: { Authorization: `Basic ${creds}`, "Content-Type": "application/x-www-form-urlencoded" },
    body:    new URLSearchParams({ grant_type: "refresh_token", refresh_token: data.refresh_token }),
  });
  const tokens = await res.json() as { access_token: string; refresh_token: string; expires_in: number };
  if (!res.ok) throw new Error("Zoom token refresh failed");
  await saveIntegration("zoom", {
    access_token:  tokens.access_token,
    refresh_token: tokens.refresh_token,
    expires_at:    Date.now() + tokens.expires_in * 1000,
  });
  return tokens.access_token;
}

export async function GET(req: NextRequest) {
  if (!(await getAdmin(req))) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  try {
    const data = await getIntegration("zoom");
    return NextResponse.json({ connected: !!data?.refresh_token });
  } catch { return NextResponse.json({ connected: false }); }
}

export async function POST(req: NextRequest) {
  if (!(await getAdmin(req))) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  try {
    const { title, startTime, endTime, description } =
      await req.json() as { title: string; startTime: string; endTime: string; description?: string };

    const token = await getFreshZoomToken();

    // Duration in minutes
    const start = new Date(startTime), end = new Date(endTime);
    const duration = Math.round((end.getTime() - start.getTime()) / 60000);

    const res = await fetch("https://api.zoom.us/v2/users/me/meetings", {
      method:  "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        topic:      title,
        type:       2,                        // scheduled meeting
        start_time: startTime,                // ISO 8601
        duration,
        timezone:   "UTC",
        agenda:     description ?? "",
        settings: {
          host_video:      true,
          participant_video: true,
          join_before_host: true,
          mute_upon_entry: false,
          waiting_room:    false,
        },
      }),
    });

    const data = await res.json() as {
      id?: number; join_url?: string; start_url?: string; error?: unknown;
    };

    if (!res.ok) {
      console.error("Zoom meeting creation failed:", data);
      return NextResponse.json({ error: "Failed to create Zoom meeting", detail: data.error }, { status: res.status });
    }

    return NextResponse.json({
      meetingId: String(data.id),
      joinUrl:   data.join_url,
      startUrl:  data.start_url, // host-only start link
    });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}