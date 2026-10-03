// app/api/marketing/route.ts
// Marketing-site analytics for the ERP (aggregation in lib/web-analytics.ts).
// Admin only; reads web_* views with the service role.
//
// GET ?section=overview|sources|pages|sections|visitors&days=30
// GET ?section=visitor&key=<visitor_key>&persistent=1
// GET ?section=journey&session=<session_id>
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { getAdmin } from "@/lib/admin-auth";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import * as wa from "@/lib/web-analytics";

export async function GET(req: NextRequest) {
  if (!(await getAdmin(req))) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  const sp = req.nextUrl.searchParams;
  const section = sp.get("section") ?? "overview";
  const range = wa.rangeFromDays(Number(sp.get("days") ?? 30));
  const sb = getSupabaseAdmin();
  try {
    let body: unknown;
    switch (section) {
      case "overview": body = await wa.overview(sb, range); break;
      case "sources":  body = await wa.sources(sb, range); break;
      case "pages":    body = await wa.pages(sb, range); break;
      case "sections": body = await wa.sections(sb, range); break;
      case "visitors": body = await wa.visitors(sb, range); break;
      case "visitor": {
        const key = sp.get("key") ?? "";
        if (!key || key.length > 128) return NextResponse.json({ error: "Missing visitor key" }, { status: 400 });
        body = await wa.visitor(sb, key, sp.get("persistent") === "1"); break;
      }
      case "journey": {
        const id = sp.get("session") ?? "";
        if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "Invalid session id" }, { status: 400 });
        body = await wa.journey(sb, id); break;
      }
      default: return NextResponse.json({ error: `Unknown section: ${section}` }, { status: 400 });
    }
    return NextResponse.json(body, { headers: { "Cache-Control": "private, no-store" } });
  } catch (e) {
    console.error("[marketing]", e);
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
