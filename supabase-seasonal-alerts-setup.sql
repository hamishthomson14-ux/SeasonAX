-- TimingAX seasonal alerts — one-time Supabase setup
-- Run this in: Supabase Dashboard -> SQL Editor -> New query -> paste -> Run

create table if not exists seasonal_alerts (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  user_id uuid not null references auth.users(id) on delete cascade,
  asset_id text not null,
  asset_name text not null,
  asset_ticker text not null,
  best_month integer not null,        -- 0=Jan ... 11=Dec, the asset's strongest seasonal month
  best_avg numeric,                   -- average return for that month, for the email copy
  best_win integer,                   -- win rate %, for the email copy
  last_notified_year integer,         -- prevents duplicate emails in the same year
  unique (user_id, asset_id)
);

-- Users can create, view, and delete only their own alerts.
alter table seasonal_alerts enable row level security;

create policy "users manage own alerts"
  on seasonal_alerts for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Note: the daily alert-sending cron job uses the Supabase SERVICE ROLE key,
-- which bypasses RLS, so it can read every user's alerts to send emails.
