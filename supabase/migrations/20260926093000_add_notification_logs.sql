create table if not exists public.notification_logs (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(title) between 1 and 120),
  message text not null check (char_length(message) between 1 and 600),
  image_url text not null default '',
  audience_type text not null default 'all' check (audience_type in ('all','user')),
  target_user_id uuid null references auth.users(id) on delete set null,
  route text not null default 'home',
  content_id text not null default '',
  content_kind text not null default '' check (content_kind in ('','movie','series')),
  season integer null check (season is null or season >= 0),
  episode integer null check (episode is null or episode >= 0),
  status text not null default 'sent' check (status in ('sent','failed')),
  onesignal_message_id text not null default '',
  recipients integer not null default 0 check (recipients >= 0),
  error_message text not null default '',
  actor_uid uuid null references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.notification_logs enable row level security;

drop policy if exists notification_logs_admin_read on public.notification_logs;
create policy notification_logs_admin_read
on public.notification_logs
for select
to authenticated
using (app_private.is_admin());

create index if not exists notification_logs_created_at_idx
  on public.notification_logs (created_at desc);

create index if not exists notification_logs_target_user_idx
  on public.notification_logs (target_user_id, created_at desc)
  where target_user_id is not null;

create index if not exists notification_logs_actor_uid_idx
  on public.notification_logs (actor_uid)
  where actor_uid is not null;

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'notification_logs'
  ) then
    alter publication supabase_realtime add table public.notification_logs;
  end if;
end $$;

comment on table public.notification_logs is
  'Server-side audit trail for CINARO OneSignal push notifications.';
