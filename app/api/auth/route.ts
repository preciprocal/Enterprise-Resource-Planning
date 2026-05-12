// app/api/auth/route.ts
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  try {
    const { password } = await req.json() as { password?: string };
    const secret = process.env.ADMIN_SECRET;

    if (!secret) {
      return NextResponse.json({ error: "ADMIN_SECRET not set on server" }, { status: 500 });
    }

    if (!password || password !== secret) {
      await new Promise(r => setTimeout(r, 400));
      return NextResponse.json({ error: "Invalid password" }, { status: 401 });
    }

    return NextResponse.json({ success: true, token: secret });
  } catch {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }
}