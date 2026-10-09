-- Bootstrap the *first* CINARO owner only after the Auth server confirms
-- the preconfigured owner's email. Registration by email alone never grants a role.
-- The trigger deliberately does not run on initial user creation.
create or replace function app_private.bootstrap_verified_cinaro_owner()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.email_confirmed_at is null
     and new.email_confirmed_at is not null
     and lower(coalesce(new.email, '')) = 'ffkyyr@gmail.com'
     and not exists (
       select 1 from public.admin_memberships
       where role = 'owner' and active
     ) then
    insert into public.admin_memberships
      (user_id, role, active, permissions, section_ids, updated_at)
    values
      (new.id, 'owner', true, '{}'::jsonb, '{}'::text[], now())
    on conflict (user_id) do nothing;
  end if;
  return new;
end;
$$;

revoke all on function app_private.bootstrap_verified_cinaro_owner() from public;
drop trigger if exists cinaro_bootstrap_verified_owner on auth.users;
create trigger cinaro_bootstrap_verified_owner
after update of email_confirmed_at on auth.users
for each row
when (old.email_confirmed_at is null and new.email_confirmed_at is not null)
execute function app_private.bootstrap_verified_cinaro_owner();
