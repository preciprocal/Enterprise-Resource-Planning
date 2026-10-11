// lib/oauth-state.ts — server only.
// The `state` parameter for the Google and Zoom calendar connections.
//
// Those connections replace the ERP's stored calendar tokens, so only a
// signed-in ERP admin may start one, and the callback must be able to tell
// that the redirect it received is one an admin started a moment ago. The
// state is an HMAC-signed note of who started it and when, valid for 10
// minutes, which also defeats the classic OAuth CSRF (someone else's
// authorization code being slipped into our callback).

import { createHmac, randomBytes, timingSafeEqual } from "crypto";

const TTL_MS = 10 * 60_000;
const key = () => process.env.OAUTH_STATE_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || "";

const sign = (payload: string) => createHmac("sha256", key()).update(`oauth-state:${payload}`).digest("base64url");

export function createOAuthState(adminEmail: string): string {
  const payload = Buffer.from(JSON.stringify({ e: adminEmail, x: Date.now() + TTL_MS, n: randomBytes(8).toString("hex") })).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

/** The admin who started the flow, or null when the state is missing, forged or expired. */
export function verifyOAuthState(state: string | null): string | null {
  if (!state || !key()) return null;
  const [payload, mac] = state.split(".");
  if (!payload || !mac) return null;
  const a = Buffer.from(sign(payload)), b = Buffer.from(mac);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const { e, x } = JSON.parse(Buffer.from(payload, "base64url").toString()) as { e?: string; x?: number };
    return e && typeof x === "number" && x > Date.now() ? e : null;
  } catch { return null; }
}
