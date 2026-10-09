
create or replace function app_private.enforce_publish_permission()
returns trigger language plpgsql set search_path = '' as $$
begin
  if auth.uid() is not null
    and old.published is distinct from new.published
    and not app_private.can_manage_content(new.management_section_id,'publishContent') then
      raise exception 'Publish permission required' using errcode='42501';
  end if;
  return new;
end; $$;
drop trigger if exists cinaro_enforce_publish_permission on public.content;
create trigger cinaro_enforce_publish_permission before update on public.content
for each row execute function app_private.enforce_publish_permission();
create index if not exists cinaro_audit_actor_idx on public.audit_logs(actor_uid);
