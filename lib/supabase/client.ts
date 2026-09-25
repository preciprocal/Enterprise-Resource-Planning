// lib/supabase/client.ts
// Browser Supabase client (anon key + the admin's own session). Used for
// sign-in and the realtime support inbox; all data reads/writes go through
// /api/* with the service role.
"use client";
import { createClient, SupabaseClient } from "@supabase/supabase-js";

const _g = globalThis as typeof globalThis & { __adm_sb?: SupabaseClient };

export function getSupabaseBrowser(): SupabaseClient {
  if (_g.__adm_sb) return _g.__adm_sb;
  _g.__adm_sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
    { auth: { persistSession: true, autoRefreshToken: true, storageKey: "adm-erp-auth" } },
  );
  return _g.__adm_sb;
}

// Current admin access token, for components that call the API outside the
// AdminTokenContext tree (Kanban modals). Kept in sync by app/page.tsx.
let _token = "";
export function setAdminToken(t: string) { _token = t; }
export function getAdminToken(): string { return _token; }
