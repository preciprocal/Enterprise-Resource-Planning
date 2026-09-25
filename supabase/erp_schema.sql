-- supabase/erp_schema.sql
-- ─────────────────────────────────────────────────────────────────────────────
-- ERP-only tables for the Preciprocal admin app. Run once in the Supabase SQL
-- editor of the SAME project the Dashboard uses. Safe to re-run.
--
-- Everything here is additive: no Dashboard table or column is altered. The
-- only thing that touches shared tables is two SELECT policies that let admins
-- (profiles.is_admin) read support tickets/replies, which the ERP's realtime
-- support inbox needs. All writes go through the ERP API with the service role.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Activity logs (ERP logins + anything POSTed to action=write_log) ─────────
create table if not exists public.erp_logs (
  id           uuid primary key default gen_random_uuid(),
  user_id      text,                       -- text on purpose: may hold a legacy Firebase uid
  user_name    text,
  user_email   text,
  type         text not null,              -- login | signup | logout | action | error | pageview
  action       text,
  path         text,
  ip           text,
  user_agent   text,
  browser      text,
  os           text,
  device       text,
  city         text,
  country      text,
  country_code text,
  details      jsonb not null default '{}'::jsonb,
  timestamp    timestamptz not null default now(),
  created_at   timestamptz not null default now()
);
create index if not exists erp_logs_timestamp_idx on public.erp_logs (timestamp desc);
create index if not exists erp_logs_user_idx      on public.erp_logs (user_id, timestamp desc);

-- ── Per-user admin metadata with no home in the Dashboard schema ─────────────
create table if not exists public.erp_user_meta (
  user_id                uuid primary key references auth.users(id) on delete cascade,
  last_contacted_at      timestamptz,
  last_contact_subject   text,
  last_contact_sent_by   text,
  last_applied_coupon    text,
  last_coupon_applied_at timestamptz,
  updated_at             timestamptz not null default now()
);

-- ── Internal notes on support tickets (kept out of support_tickets so the
--    customer can never read them through their own RLS policy) ─────────────
create table if not exists public.erp_ticket_notes (
  ticket_id  uuid primary key references public.support_tickets(id) on delete cascade,
  notes      text not null default '',
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);

-- ── Tasks board ──────────────────────────────────────────────────────────────
create table if not exists public.erp_kanban_boards (
  id         text primary key default 'board',
  columns    jsonb not null default '[]'::jsonb,
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);

create table if not exists public.erp_kanban_comments (
  id           text primary key,
  card_id      text not null,
  col_id       text,
  author       text,
  author_color text,
  text         text not null,
  user_id      uuid references auth.users(id) on delete set null,
  created_at   timestamptz not null default now()
);
create index if not exists erp_kanban_comments_card_idx on public.erp_kanban_comments (card_id);

-- ── OAuth tokens for Google Meet / Zoom ──────────────────────────────────────
create table if not exists public.erp_integrations (
  id            text primary key,          -- 'google_meet' | 'zoom'
  access_token  text,
  refresh_token text,
  expires_at    bigint,                    -- epoch ms
  connected_at  timestamptz,
  updated_at    timestamptz not null default now()
);

-- ── ERP access list (managed from the ERP's Access tab) ──────────────────────
-- Emails allowed to sign in, on top of ERP_ALLOWED_EMAILS in the server env
-- (env entries are permanent and can't be removed from the UI).
create table if not exists public.erp_allowed_emails (
  email      text primary key check (email = lower(email)),
  note       text,
  added_by   text,
  created_at timestamptz not null default now()
);

-- RLS on with no policies = service role only.
alter table public.erp_allowed_emails  enable row level security;
alter table public.erp_logs            enable row level security;
alter table public.erp_user_meta       enable row level security;
alter table public.erp_ticket_notes    enable row level security;
alter table public.erp_kanban_boards   enable row level security;
alter table public.erp_kanban_comments enable row level security;
alter table public.erp_integrations    enable row level security;

-- ── Admin read access for the realtime support inbox ─────────────────────────
-- "Admin" here = on the ERP access list (the API mirrors env entries into
-- erp_allowed_emails, so this matches who can sign in to the ERP).
-- security definer so the check doesn't depend on the table's RLS.
create or replace function public.erp_is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.erp_allowed_emails
    where email = lower(coalesce(auth.jwt() ->> 'email', ''))
  )
$$;
revoke all on function public.erp_is_admin() from public;
grant execute on function public.erp_is_admin() to authenticated;

drop policy if exists "erp admins read tickets" on public.support_tickets;
create policy "erp admins read tickets" on public.support_tickets
  for select to authenticated using (public.erp_is_admin());

drop policy if exists "erp admins read ticket replies" on public.support_ticket_replies;
create policy "erp admins read ticket replies" on public.support_ticket_replies
  for select to authenticated using (public.erp_is_admin());
