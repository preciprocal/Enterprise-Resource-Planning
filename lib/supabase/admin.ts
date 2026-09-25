// lib/supabase/admin.ts
// Service-role Supabase client — server only. Bypasses RLS, so never import
// this from a "use client" file.
import "server-only";
import { createClient, SupabaseClient } from "@supabase/supabase-js";

let _client: SupabaseClient | null = null;

export function getSupabaseAdmin(): SupabaseClient {
  if (_client) return _client;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set");
  _client = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
  return _client;
}
