-- TimingAX newsletter — one-time Supabase setup
-- Run this in: Supabase Dashboard -> SQL Editor -> New query -> paste -> Run

create table if not exists newsletter_subscribers (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  email text not null unique
);

-- Lock the table down: anonymous visitors may INSERT (subscribe)
-- but may never read, update, or delete anything.
alter table newsletter_subscribers enable row level security;

create policy "anyone can subscribe"
  on newsletter_subscribers for insert
  to anon
  with check (true);

-- Duplicate emails are silently ignored (unique constraint + ignore-duplicates header).
-- View / export subscribers in the Supabase Dashboard: Table Editor -> newsletter_subscribers
