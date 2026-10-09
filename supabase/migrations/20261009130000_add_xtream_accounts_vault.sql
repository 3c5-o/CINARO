-- CINARO Xtream account vault. Only the Railway gateway's service-role access can read it.
create table if not exists public.xtream_accounts (
 id text primary key check (id ~ '^[a-z0-9_-]{1,40}$'),
 name text not null check (length(name) between 1 and 80),
 base_url text not null check (length(base_url) between 12 and 400),
 username_ciphertext text not null,
 password_ciphertext text not null,
 enabled boolean not null default true,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
alter table public.xtream_accounts enable row level security;
revoke all on table public.xtream_accounts from anon, authenticated;
grant all on table public.xtream_accounts to service_role;
create index if not exists xtream_accounts_updated_at_idx on public.xtream_accounts(updated_at desc);
comment on table public.xtream_accounts is
 'Xtream credentials are AES-256-GCM encrypted by CINARO Railway gateway and never exposed to clients.';
