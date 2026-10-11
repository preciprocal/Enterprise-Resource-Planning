// lib/outlook.ts
// The Email tab's Outlook connection, held on the server per ERP admin.
//
// The tab used to sign in entirely in the browser (an SPA app registration).
// Microsoft caps SPA refresh tokens at 24 hours, so it asked for a Microsoft
// sign-in about once a day. As a confidential web app (client secret) the
// refresh token lasts 90 days and is renewed on every refresh, so an admin
// connects once and stays connected while they keep using the tab.
//
// Tokens live in erp_integrations under outlook:<admin email>, so each admin
// only ever gets their own mailbox. The browser receives short-lived access
// tokens only, from /api/email/token.
//
// Needs MS_MAIL_CLIENT_SECRET (a client secret on the NEXT_PUBLIC_MS_CLIENT_ID
// app) and a Web redirect URI <ERP origin>/api/auth/callback/outlook. Without
// the secret the tab falls back to the browser sign-in.
import "server-only";
import { deleteIntegration, getIntegration, saveIntegration, type IntegrationId } from "@/lib/integrations";

export const OUTLOOK_SCOPES = "offline_access User.Read Mail.Read Mail.ReadWrite Mail.Send";

const tenant = () => process.env.NEXT_PUBLIC_MS_TENANT_ID || "common";
export const outlookServerEnabled = () => !!(process.env.NEXT_PUBLIC_MS_CLIENT_ID && process.env.MS_MAIL_CLIENT_SECRET);
export const outlookRedirectUri = (origin: string) => process.env.MS_MAIL_REDIRECT_URI || `${origin}/api/auth/callback/outlook`;
const idFor = (adminEmail: string): IntegrationId => `outlook:${adminEmail.trim().toLowerCase()}`;

export function outlookAuthorizeUrl(origin: string, state: string, firstTime: boolean): string {
  const u = new URL(`https://login.microsoftonline.com/${tenant()}/oauth2/v2.0/authorize`);
  u.searchParams.set("client_id", process.env.NEXT_PUBLIC_MS_CLIENT_ID!);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("redirect_uri", outlookRedirectUri(origin));
  u.searchParams.set("response_mode", "query");
  u.searchParams.set("scope", OUTLOOK_SCOPES);
  u.searchParams.set("state", state);
  // Only the first connection shows the account picker; a reconnect goes
  // straight through with the Microsoft session the browser already has.
  if (firstTime) u.searchParams.set("prompt", "select_account");
  return u.toString();
}

interface TokenResponse { access_token?: string; refresh_token?: string; expires_in?: number; error?: string; error_description?: string }

async function tokenRequest(params: Record<string, string>): Promise<TokenResponse> {
  const r = await fetch(`https://login.microsoftonline.com/${tenant()}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.NEXT_PUBLIC_MS_CLIENT_ID!,
      client_secret: process.env.MS_MAIL_CLIENT_SECRET!,
      scope: OUTLOOK_SCOPES,
      ...params,
    }),
    cache: "no-store",
  });
  const j = (await r.json().catch(() => ({}))) as TokenResponse;
  if (!r.ok || !j.access_token) throw Object.assign(new Error(j.error_description?.split("\r\n")[0] || j.error || `HTTP ${r.status}`), { code: j.error });
  return j;
}

export async function connectOutlook(adminEmail: string, code: string, origin: string): Promise<void> {
  const t = await tokenRequest({ grant_type: "authorization_code", code, redirect_uri: outlookRedirectUri(origin) });
  await saveIntegration(idFor(adminEmail), {
    access_token: t.access_token!,
    refresh_token: t.refresh_token,
    expires_at: Date.now() + ((t.expires_in ?? 3600) - 120) * 1000,
    connected_at: new Date().toISOString(),
  });
}

export async function hasOutlook(adminEmail: string): Promise<boolean> {
  return !!(await getIntegration(idFor(adminEmail)))?.refresh_token;
}

/**
 * A valid access token for this admin's mailbox, refreshing when needed, or
 * null when they have not connected (or Microsoft revoked the connection, in
 * which case it is removed so the tab offers to connect again).
 */
export async function outlookAccessToken(adminEmail: string): Promise<{ token: string; expiresAt: number } | null> {
  const id = idFor(adminEmail);
  const row = await getIntegration(id);
  if (!row?.refresh_token) return null;
  if (row.access_token && row.expires_at && row.expires_at > Date.now() + 60_000) {
    return { token: row.access_token, expiresAt: row.expires_at };
  }
  try {
    const t = await tokenRequest({ grant_type: "refresh_token", refresh_token: row.refresh_token });
    const expiresAt = Date.now() + ((t.expires_in ?? 3600) - 120) * 1000;
    // Microsoft rotates the refresh token; keep the newest one.
    await saveIntegration(id, { access_token: t.access_token!, refresh_token: t.refresh_token ?? row.refresh_token, expires_at: expiresAt });
    return { token: t.access_token!, expiresAt };
  } catch (e) {
    if ((e as { code?: string }).code === "invalid_grant") { await deleteIntegration(id); return null; }
    throw e;
  }
}

export async function disconnectOutlook(adminEmail: string) {
  await deleteIntegration(idFor(adminEmail));
}
