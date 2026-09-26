create table if not exists public.telegram_bot_members (
  telegram_user_id bigint primary key,
  role text not null check (role in ('owner','admin','supervisor')),
  display_name text not null default '',
  username text not null default '',
  active boolean not null default true,
  can_movies boolean not null default true,
  can_series boolean not null default true,
  added_by bigint not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_seen_at timestamptz null
);

insert into public.telegram_bot_members (
  telegram_user_id, role, display_name, active, can_movies, can_series, added_by, updated_at
) values (
  8407394858, 'owner', 'مالك CINARO', true, true, true, 8407394858, now()
)
on conflict (telegram_user_id) do update
set role = 'owner',
    active = true,
    can_movies = true,
    can_series = true,
    updated_at = now();

alter table public.telegram_bot_members enable row level security;

create index if not exists telegram_bot_members_role_active_idx
  on public.telegram_bot_members (role, active);

comment on table public.telegram_bot_members is
  'Telegram storage bot team: one owner, secondary admins, and scoped upload supervisors. Access is server-side only.';
