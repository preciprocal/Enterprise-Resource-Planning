// app/api/email/token/route.ts
// The Email tab's access to the signed-in admin's own Outlook mailbox.
//   GET     { server, connected, token?, expiresAt? }
//   DELETE  disconnect
export const runtime = "nodejs";
import { NextRequest, NextResponse } from "next/server";
import { getAdmin } from "@/lib/admin-auth";
import { disconnectOutlook, outlookAccessToken, outlookServerEnabled } from "@/lib/outlook";

const noStore = { headers: { "Cache-Control": "private, no-store" } };

export async function GET(req: NextRequest) {
  const admin = await getAdmin(req);
  if (!admin?.email) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  if (!outlookServerEnabled()) return NextResponse.json({ server: false, connected: false }, noStore);
  try {
    const t = await outlookAccessToken(admin.email);
    return NextResponse.json(t ? { server: true, connected: true, ...t } : { server: true, connected: false }, noStore);
  } catch (e) {
    console.error("[outlook] refresh failed:", (e as Error).message);
    return NextResponse.json({ server: true, connected: true, error: "Microsoft did not respond. Try again in a moment." }, { status: 502, ...noStore });
  }
}

export async function DELETE(req: NextRequest) {
  const admin = await getAdmin(req);
  if (!admin?.email) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  await disconnectOutlook(admin.email);
  return NextResponse.json({ success: true });
}
