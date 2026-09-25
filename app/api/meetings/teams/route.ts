// app/api/meetings/teams/route.ts
// ─────────────────────────────────────────────────────────────────────────────
// Creates real Microsoft Teams meetings via MS Graph API.
// Uses the On-Behalf-Of (OBO) flow — the user's MS access token (acquired
// client-side via MSAL, same flow as your existing Outlook tab) is exchanged
// for a Graph token that can call /me/onlineMeetings.
//
// POST /api/meetings/teams
// Body: {
//   subject:    string          — meeting title
//   startTime:  string          — ISO 8601 e.g. "2026-06-10T09:00:00"
//   endTime:    string          — ISO 8601 e.g. "2026-06-10T10:00:00"
//   attendees:  string[]        — email addresses
//   msAccessToken: string       — the user's MS Graph access token from MSAL
// }
// Returns: { joinUrl, teamsLink, meetingId }
// ─────────────────────────────────────────────────────────────────────────────
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";

const GRAPH = "https://graph.microsoft.com/v1.0";

export async function POST(req: NextRequest) {
  try {
    const { subject, startTime, endTime, attendees, msAccessToken } =
      (await req.json()) as {
        subject: string;
        startTime: string;
        endTime: string;
        attendees: string[];
        msAccessToken: string;
      };

    if (!msAccessToken) {
      return NextResponse.json(
        { error: "msAccessToken required — sign in with Microsoft first" },
        { status: 401 }
      );
    }

    // ── 1. Create the online meeting via MS Graph ─────────────────────────────
    const meetingRes = await fetch(`${GRAPH}/me/onlineMeetings`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${msAccessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        subject,
        startDateTime: startTime,   // ISO 8601
        endDateTime:   endTime,
        // Attendees are optional for /me/onlineMeetings — the meeting is still
        // joinable by link. To add them to the calendar event as well, create
        // a /me/events with onlineMeeting attached (see step 2 below).
      }),
    });

    if (!meetingRes.ok) {
      const err = await meetingRes.text();
      console.error("Graph /me/onlineMeetings error:", err);
      return NextResponse.json(
        { error: "Failed to create Teams meeting", detail: err },
        { status: meetingRes.status }
      );
    }

    const meeting = (await meetingRes.json()) as {
      id: string;
      joinUrl: string;
      joinWebUrl?: string;
    };

    // ── 2. Optionally create a calendar event and invite attendees ────────────
    // This sends real calendar invites to each attendee's inbox.
    if (attendees && attendees.length > 0) {
      await fetch(`${GRAPH}/me/events`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${msAccessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          subject,
          start: { dateTime: startTime, timeZone: "UTC" },
          end:   { dateTime: endTime,   timeZone: "UTC" },
          isOnlineMeeting: true,
          onlineMeetingProvider: "teamsForBusiness",
          attendees: attendees.map((email) => ({
            emailAddress: { address: email },
            type: "required",
          })),
        }),
      });
      // We don't fail if calendar invite fails — meeting link is still valid
    }

    return NextResponse.json({
      meetingId:  meeting.id,
      joinUrl:    meeting.joinWebUrl ?? meeting.joinUrl,
      teamsLink:  meeting.joinWebUrl ?? meeting.joinUrl,
    });
  } catch (e) {
    console.error("Teams meeting error:", e);
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}