// app/api/meetings/google/route.ts
// Creates a real Google Calendar event with a Meet link.
// Refreshes the access token automatically if expired.
export const runtime = "nodejs";
import { NextRequest, NextResponse } from "next/server";
import { getAdmin } from "@/lib/admin-auth";
import { getIntegration, saveIntegration } from "@/lib/integrations";

async function getFreshGoogleToken(): Promise<string> {
  const data = await getIntegration("google_meet");

  if (!data?.refresh_token) throw new Error("Google not connected");

  // If token still valid, use it
  if (data.access_token && (data.expires_at ?? 0) > Date.now() + 60_000) return data.access_token;

  // Refresh it
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id:     process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      refresh_token: data.refresh_token,
      grant_type:    "refresh_token",
    }),
  });

  const tokens = await res.json() as { access_token: string; expires_in: number };
  if (!res.ok) throw new Error("Google token refresh failed");

  await saveIntegration("google_meet", {
    access_token: tokens.access_token,
    expires_at:   Date.now() + tokens.expires_in * 1000,
  });

  return tokens.access_token;
}

export async function GET(req: NextRequest) {
  // Returns connection status for the UI
  if (!(await getAdmin(req))) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  try {
    const data = await getIntegration("google_meet");
    return NextResponse.json({ connected: !!data?.refresh_token });
  } catch { return NextResponse.json({ connected: false }); }
}

export async function POST(req: NextRequest) {
  if (!(await getAdmin(req))) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  try {
    const { title, startTime, endTime, attendees, description } =
      await req.json() as {
        title: string; startTime: string; endTime: string;
        attendees: string[]; description?: string;
      };

    const token = await getFreshGoogleToken();

    const event = {
      summary:     title,
      description: description ?? "",
      start:       { dateTime: startTime, timeZone: "UTC" },
      end:         { dateTime: endTime,   timeZone: "UTC" },
      attendees:   attendees.map(email => ({ email })),
      conferenceData: {
        createRequest: {
          requestId:            `preciprocal-${Date.now()}`,
          conferenceSolutionKey: { type: "hangoutsMeet" },
        },
      },
    };

    const res = await fetch(
      "https://www.googleapis.com/calendar/v3/calendars/primary/events?conferenceDataVersion=1&sendUpdates=all",
      {
        method:  "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body:    JSON.stringify(event),
      }
    );

    const data = await res.json() as {
      id?: string;
      hangoutLink?: string;
      conferenceData?: { entryPoints?: { uri: string; entryPointType: string }[] };
      error?: unknown;
    };

    if (!res.ok) {
      console.error("Google Calendar event creation failed:", data);
      return NextResponse.json({ error: "Failed to create event", detail: data.error }, { status: res.status });
    }

    const joinUrl =
      data.hangoutLink ??
      data.conferenceData?.entryPoints?.find(e => e.entryPointType === "video")?.uri;

    return NextResponse.json({ meetingId: data.id, joinUrl });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}