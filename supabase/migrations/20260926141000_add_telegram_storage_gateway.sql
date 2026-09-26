create table if not exists public.telegram_channels (
  channel_key text primary key check (channel_key in ('movies','series')),
  telegram_channel_id bigint not null,
  title text not null default '',
  username text not null default '',
  active boolean not null default true,
  configured_by bigint not null,
  verified_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.telegram_upload_batches (
  id uuid primary key default gen_random_uuid(),
  batch_code text not null unique,
  media_kind text not null check (media_kind in ('movie','series')),
  status text not null default 'open' check (status in ('open','completed','cancelled')),
  season integer null check (season is null or season >= 1),
  start_episode integer null check (start_episode is null or start_episode >= 1),
  next_episode integer null check (next_episode is null or next_episode >= 1),
  total_files integer not null default 0 check (total_files >= 0),
  created_by bigint not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz null
);

create table if not exists public.telegram_media (
  id uuid primary key default gen_random_uuid(),
  storage_id text not null unique check (storage_id ~ '^CIN-[MS]-[A-Z0-9]{10}$'),
  media_kind text not null check (media_kind in ('movie','series')),
  channel_id bigint not null,
  message_id bigint not null check (message_id > 0),
  telegram_file_id text not null default '',
  telegram_unique_id text not null default '',
  file_name text not null default '',
  mime_type text not null default 'video/mp4',
  file_size bigint not null check (file_size > 0 and file_size <= 1950000000),
  batch_id uuid null references public.telegram_upload_batches(id) on delete set null,
  batch_index integer null check (batch_index is null or batch_index >= 1),
  season integer null check (season is null or season >= 1),
  episode integer null check (episode is null or episode >= 1),
  source_chat_id bigint null,
  source_message_id bigint null,
  created_by bigint not null,
  status text not null default 'active' check (status in ('active','deleted')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.telegram_bot_sessions (
  telegram_user_id bigint primary key,
  flow text not null default '',
  step text not null default '',
  draft jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.telegram_channels enable row level security;
alter table public.telegram_upload_batches enable row level security;
alter table public.telegram_media enable row level security;
alter table public.telegram_bot_sessions enable row level security;

drop policy if exists telegram_channels_admin_read on public.telegram_channels;
create policy telegram_channels_admin_read
on public.telegram_channels
for select
to authenticated
using (app_private.is_admin());

drop policy if exists telegram_batches_admin_read on public.telegram_upload_batches;
create policy telegram_batches_admin_read
on public.telegram_upload_batches
for select
to authenticated
using (app_private.is_admin());

drop policy if exists telegram_media_admin_read on public.telegram_media;
create policy telegram_media_admin_read
on public.telegram_media
for select
to authenticated
using (app_private.is_admin());

create index if not exists telegram_media_created_at_idx
  on public.telegram_media (created_at desc);

create index if not exists telegram_media_kind_created_idx
  on public.telegram_media (media_kind, created_at desc);

create index if not exists telegram_media_channel_message_idx
  on public.telegram_media (channel_id, message_id);

create index if not exists telegram_media_batch_idx
  on public.telegram_media (batch_id, batch_index)
  where batch_id is not null;

create index if not exists telegram_batches_created_at_idx
  on public.telegram_upload_batches (created_at desc);

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'telegram_media'
  ) then
    alter publication supabase_realtime add table public.telegram_media;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'telegram_channels'
  ) then
    alter publication supabase_realtime add table public.telegram_channels;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'telegram_upload_batches'
  ) then
    alter publication supabase_realtime add table public.telegram_upload_batches;
  end if;
end $$;

comment on table public.telegram_media is
  'CINARO Telegram storage registry. Public apps use only opaque storage_id values; Telegram channel/message identifiers stay server-side.';
comment on table public.telegram_channels is
  'Telegram storage channels configured from the CINARO storage bot.';
comment on table public.telegram_upload_batches is
  'Bulk upload sessions created by the CINARO storage bot.';
comment on table public.telegram_bot_sessions is
  'Persistent single-admin Telegram bot flow state.';
