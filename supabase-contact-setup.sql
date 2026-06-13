-- TimingAX contact form — one-time Supabase setup
-- Run this in: Supabase Dashboard -> SQL Editor -> New query -> paste -> Run

create table if not exists contact_messages (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  name text not null,
  email text not null,
  subject text not null,
  message text not null
);

-- Lock the table down: anonymous visitors may INSERT (send a message)
-- but may never read, update, or delete anything.
alter table contact_messages enable row level security;

create policy "anyone can send a message"
  on contact_messages for insert
  to anon
  with check (true);

-- No select policy for anon = messages are private.
-- You read them in the Supabase Dashboard: Table Editor -> contact_messages


-- ============================================================
-- EMAIL SUBSCRIBERS (newsletter / blog signup)
-- ============================================================
create table if not exists email_subscribers (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  email text not null unique,
  source text default 'blog'
);

alter table email_subscribers enable row level security;

create policy "anyone can subscribe"
  on email_subscribers for insert
  to anon
  with check (true);

-- No select policy for anon = subscriber list is private.
-- View subscribers in the Supabase Dashboard: Table Editor -> email_subscribers
