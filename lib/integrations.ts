// lib/integrations.ts
// OAuth token storage for Google Meet / Zoom (erp_integrations table).
import "server-only";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export type IntegrationId = "google_meet" | "zoom";

export interface IntegrationTokens {
  access_token:  string | null;
  refresh_token: string | null;
  expires_at:    number | null;   // epoch ms
}

export async function getIntegration(id: IntegrationId): Promise<IntegrationTokens | null> {
  const { data, error } = await getSupabaseAdmin()
    .from("erp_integrations").select("access_token,refresh_token,expires_at").eq("id", id).maybeSingle();
  if (error) throw new Error(error.message);
  return data ? { ...data, expires_at: data.expires_at == null ? null : Number(data.expires_at) } : null;
}

/** Merge-upsert: fields left undefined keep their stored value. */
export async function saveIntegration(id: IntegrationId, patch: Partial<IntegrationTokens> & { connected_at?: string }) {
  const row: Record<string, unknown> = { id, updated_at: new Date().toISOString() };
  for (const [k, v] of Object.entries(patch)) if (v !== undefined) row[k] = v;
  const { error } = await getSupabaseAdmin().from("erp_integrations").upsert(row, { onConflict: "id" });
  if (error) throw new Error(error.message);
}
