
-- CINARO baseline for new Supabase project (non-destructive, empty target).
create schema if not exists app_private;
grant usage on schema app_private to anon, authenticated;

create table if not exists public.profiles (
 id uuid primary key references auth.users(id) on delete cascade,
 email text not null default '',
 display_name text not null default '',
 is_anonymous boolean not null default false,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create table if not exists public.account_status (
 user_id uuid primary key references auth.users(id) on delete cascade,
 active boolean not null default true,
 reason text not null default '',
 updated_at timestamptz not null default now()
);
create table if not exists public.admin_memberships (
 user_id uuid primary key references auth.users(id) on delete cascade,
 role text not null check (role in ('owner','admin','supervisor')),
 active boolean not null default true,
 permissions jsonb not null default '{}'::jsonb,
 section_ids text[] not null default '{}'::text[],
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);

create or replace function app_private.is_admin()
returns boolean language sql stable security definer set search_path = ''
as $$select exists (select 1 from public.admin_memberships m
 where m.user_id=(select auth.uid()) and m.active and m.role in ('owner','admin'))$$;
create or replace function app_private.is_staff()
returns boolean language sql stable security definer set search_path = ''
as $$select exists (select 1 from public.admin_memberships m
 where m.user_id=(select auth.uid()) and m.active and m.role in ('owner','admin','supervisor'))$$;
create or replace function app_private.can_manage_content(p_section text, p_permission text)
returns boolean language sql stable security definer set search_path = ''
as $$select exists (select 1 from public.admin_memberships m
 where m.user_id=(select auth.uid()) and m.active
 and (m.role in ('owner','admin') or
 (m.role='supervisor' and p_section is not null and p_section=any(m.section_ids)
  and m.permissions->>p_permission='true')))$$;
revoke all on function app_private.is_admin() from public;
revoke all on function app_private.is_staff() from public;
revoke all on function app_private.can_manage_content(text,text) from public;
grant execute on function app_private.is_admin(), app_private.is_staff(), app_private.can_manage_content(text,text) to anon,authenticated;

create table if not exists public.app_config (
 id text primary key,
 featured jsonb not null default '[]'::jsonb,
 announcement text not null default '',
 latest_version text not null default '2.9.5',
 minimum_version text not null default '2.9.0',
 update_notes text not null default '',
 update_url text not null default 'https://github.com/3c5-o/CINARO/releases',
 maintenance boolean not null default false,
 force_update boolean not null default false,
 update_released_at timestamptz,
 old_version_shutdown_at timestamptz,
 settings jsonb not null default '{}'::jsonb,
 updated_at timestamptz not null default now()
);
create table if not exists public.sections (
 id text primary key,
 name text not null,
 description text not null default '',
 active boolean not null default true,
 sort_order integer not null default 0,
 updated_at timestamptz not null default now()
);
create table if not exists public.content (
 id text primary key,
 kind text not null check(kind in ('movie','series')),
 title text not null,
 published boolean not null default false,
 featured boolean not null default false,
 management_section_id text,
 views bigint not null default 0 check(views>=0),
 added_at date not null default current_date,
 sort_order integer not null default 0,
 payload jsonb not null default '{}'::jsonb,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create table if not exists public.user_states (
 user_id uuid primary key references auth.users(id) on delete cascade,
 favorites jsonb not null default '[]'::jsonb,
 history jsonb not null default '{}'::jsonb,
 settings jsonb not null default '{}'::jsonb,
 updated_at timestamptz not null default now()
);
create table if not exists public.content_requests (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references auth.users(id) on delete cascade,
 user_email text not null default '',
 title text not null,
 kind text not null check (kind in ('movie','series')),
 notes text not null default '',
 status text not null default 'new',
 admin_note text not null default '',
 linked_content_id text,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create table if not exists public.reports (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references auth.users(id) on delete cascade,
 user_email text not null default '',
 content_id text not null default '',
 content_title text not null default '',
 kind text not null check (kind in ('movie','series')),
 season integer not null default 0,
 episode integer not null default 0,
 category text not null default 'playback',
 details text not null default '',
 source_url text not null default '',
 status text not null default 'open',
 admin_note text not null default '',
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create table if not exists public.content_views (
 content_id text not null references public.content(id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade,
 created_at timestamptz not null default now(),
 primary key(content_id,user_id)
);
create table if not exists public.audit_logs (
 id uuid primary key default gen_random_uuid(),
 action text not null,
 target text not null default '',
 details text not null default '',
 actor_uid uuid references auth.users(id) on delete set null,
 actor_email text not null default '',
 created_at timestamptz not null default now()
);

create or replace function app_private.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
 insert into public.profiles(id,email,display_name,is_anonymous)
 values(new.id,coalesce(new.email,''),coalesce(new.raw_user_meta_data->>'display_name',''),coalesce(new.is_anonymous,false))
 on conflict(id) do nothing;
 insert into public.account_status(user_id) values(new.id) on conflict(user_id) do nothing;
 return new;
end;$$;
revoke all on function app_private.handle_new_user() from public;
drop trigger if exists cinaro_on_auth_user_created on auth.users;
create trigger cinaro_on_auth_user_created after insert on auth.users
 for each row execute function app_private.handle_new_user();

create or replace function app_private.record_view_counter()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
 update public.content set views=views+1 where id=new.content_id;
 return new;
end;$$;
revoke all on function app_private.record_view_counter() from public;
drop trigger if exists cinaro_content_views_counter on public.content_views;
create trigger cinaro_content_views_counter after insert on public.content_views
 for each row execute function app_private.record_view_counter();

alter table public.profiles enable row level security;
alter table public.account_status enable row level security;
alter table public.admin_memberships enable row level security;
alter table public.app_config enable row level security;
alter table public.sections enable row level security;
alter table public.content enable row level security;
alter table public.user_states enable row level security;
alter table public.content_requests enable row level security;
alter table public.reports enable row level security;
alter table public.content_views enable row level security;
alter table public.audit_logs enable row level security;

revoke all on public.profiles,public.account_status,public.admin_memberships,
 public.app_config,public.sections,public.content,public.user_states,
 public.content_requests,public.reports,public.content_views,public.audit_logs
 from anon,authenticated;

grant select on public.app_config,public.sections,public.content to anon;
grant select on public.app_config,public.sections,public.content to authenticated;
grant insert,update,delete on public.app_config,public.sections,public.content to authenticated;
grant select on public.profiles,public.account_status,public.admin_memberships,public.user_states,
 public.content_requests,public.reports,public.content_views,public.audit_logs to authenticated;
grant insert,update,delete on public.account_status,public.admin_memberships,public.user_states,
 public.content_requests,public.reports to authenticated;
grant insert on public.content_views,public.audit_logs to authenticated;
grant update(display_name,updated_at) on public.profiles to authenticated;

create policy cinaro_profiles_select on public.profiles for select to authenticated
 using(id=(select auth.uid()) or (select app_private.is_admin()));
create policy cinaro_profiles_update on public.profiles for update to authenticated
 using(id=(select auth.uid())) with check(id=(select auth.uid()));

create policy cinaro_account_status_select on public.account_status for select to authenticated
 using(user_id=(select auth.uid()) or (select app_private.is_admin()));
create policy cinaro_account_status_insert on public.account_status for insert to authenticated
 with check((select app_private.is_admin()));
create policy cinaro_account_status_update on public.account_status for update to authenticated
 using((select app_private.is_admin())) with check((select app_private.is_admin()));

create policy cinaro_memberships_select on public.admin_memberships for select to authenticated
 using(user_id=(select auth.uid()) or (select app_private.is_admin()));
create policy cinaro_memberships_insert on public.admin_memberships for insert to authenticated
 with check((select app_private.is_admin()) and role='supervisor');
create policy cinaro_memberships_update on public.admin_memberships for update to authenticated
 using((select app_private.is_admin()) and role='supervisor')
 with check((select app_private.is_admin()) and role='supervisor');
create policy cinaro_memberships_delete on public.admin_memberships for delete to authenticated
 using((select app_private.is_admin()) and role='supervisor');

create policy cinaro_config_read on public.app_config for select to anon,authenticated using(true);
create policy cinaro_config_insert on public.app_config for insert to authenticated
 with check((select app_private.is_admin()));
create policy cinaro_config_update on public.app_config for update to authenticated
 using((select app_private.is_admin())) with check((select app_private.is_admin()));

create policy cinaro_sections_read on public.sections for select to anon,authenticated
 using(active or (select app_private.is_admin()));
create policy cinaro_sections_insert on public.sections for insert to authenticated
 with check((select app_private.is_admin()));
create policy cinaro_sections_update on public.sections for update to authenticated
 using((select app_private.is_admin())) with check((select app_private.is_admin()));
create policy cinaro_sections_delete on public.sections for delete to authenticated
 using((select app_private.is_admin()));

create policy cinaro_content_read on public.content for select to anon,authenticated
 using(published or (select app_private.is_admin()) or
  (select app_private.is_staff()) and
  management_section_id is not null and exists (
   select 1 from public.admin_memberships m where m.user_id=(select auth.uid())
     and m.active and m.role='supervisor' and management_section_id=any(m.section_ids)
  ));
create policy cinaro_content_insert on public.content for insert to authenticated
 with check(app_private.can_manage_content(management_section_id,'createContent')
 and (published=false or app_private.can_manage_content(management_section_id,'publishContent')));
create policy cinaro_content_update on public.content for update to authenticated
 using(app_private.can_manage_content(management_section_id,'editContent'))
 with check(app_private.can_manage_content(management_section_id,'editContent'));
create policy cinaro_content_delete on public.content for delete to authenticated
 using(app_private.can_manage_content(management_section_id,'deleteContent'));

create policy cinaro_user_states_select on public.user_states for select to authenticated
 using(user_id=(select auth.uid()));
create policy cinaro_user_states_insert on public.user_states for insert to authenticated
 with check(user_id=(select auth.uid()));
create policy cinaro_user_states_update on public.user_states for update to authenticated
 using(user_id=(select auth.uid())) with check(user_id=(select auth.uid()));

create policy cinaro_requests_select on public.content_requests for select to authenticated
 using(user_id=(select auth.uid()) or (select app_private.is_admin()));
create policy cinaro_requests_insert on public.content_requests for insert to authenticated
 with check(user_id=(select auth.uid()));
create policy cinaro_requests_update on public.content_requests for update to authenticated
 using((select app_private.is_admin())) with check((select app_private.is_admin()));
create policy cinaro_requests_delete on public.content_requests for delete to authenticated
 using(user_id=(select auth.uid()) or (select app_private.is_admin()));

create policy cinaro_reports_select on public.reports for select to authenticated
 using(user_id=(select auth.uid()) or (select app_private.is_admin()));
create policy cinaro_reports_insert on public.reports for insert to authenticated
 with check(user_id=(select auth.uid()));
create policy cinaro_reports_update on public.reports for update to authenticated
 using((select app_private.is_admin())) with check((select app_private.is_admin()));
create policy cinaro_reports_delete on public.reports for delete to authenticated
 using((select app_private.is_admin()));

create policy cinaro_views_select on public.content_views for select to authenticated
 using(user_id=(select auth.uid()) or (select app_private.is_admin()));
create policy cinaro_views_insert on public.content_views for insert to authenticated
 with check(user_id=(select auth.uid()));
create policy cinaro_audit_select on public.audit_logs for select to authenticated
 using((select app_private.is_admin()));
create policy cinaro_audit_insert on public.audit_logs for insert to authenticated
 with check((select app_private.is_staff()) and actor_uid=(select auth.uid()));

create index if not exists cinaro_content_published_order_idx on public.content
 (published,sort_order desc,added_at desc,id);
create index if not exists cinaro_content_section_idx on public.content(management_section_id);
create index if not exists cinaro_requests_user_idx on public.content_requests(user_id,created_at desc);
create index if not exists cinaro_reports_user_idx on public.reports(user_id,created_at desc);
create index if not exists cinaro_audit_created_idx on public.audit_logs(created_at desc);
create index if not exists cinaro_views_user_idx on public.content_views(user_id,created_at desc);

insert into public.app_config(id,latest_version,minimum_version,force_update)
 values ('public','2.9.5','2.9.0',false) on conflict(id) do nothing;

do $$
declare rel text;
begin
 foreach rel in array array['app_config','sections','content','user_states','content_requests',
 'reports','profiles','account_status','admin_memberships'] loop
  if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime'
  and schemaname='public' and tablename=rel) then
    execute format('alter publication supabase_realtime add table public.%I',rel);
  end if;
 end loop;
end $$;
