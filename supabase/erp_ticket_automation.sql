-- supabase/erp_ticket_automation.sql
-- Run once in the Supabase SQL editor (project hghpzepjnreljfgdpplm) to enable
-- ticket → Tasks cards and 24h reminder emails. Safe to re-run.
-- (Also included in erp_schema.sql for fresh setups.)

create table if not exists public.erp_ticket_automation (
  ticket_id        uuid primary key references public.support_tickets(id) on delete cascade,
  task_card_id     text,
  task_added_at    timestamptz,
  reminder_sent_at timestamptz,
  reminder_for     timestamptz,
  updated_at       timestamptz not null default now()
);

-- RLS on with no policies = service role only.
alter table public.erp_ticket_automation enable row level security;
