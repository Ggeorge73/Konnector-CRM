-- KCRM-77 Duplicate detection and merge.
--
-- duplicate_dismissals: pairs a leader marked "not a duplicate", so detection stops listing them.
-- merge_accounts() / merge_contacts(): one transaction each, leaders only. The survivor keeps its id,
-- takes the fields the leader picked from the loser (p_patch), and everything that pointed at the loser
-- is re-pointed to it. The loser is archived (never deleted), the survivor's timeline gets a
-- "Merged … into this record" entry and audit_log gets before/after plus the loser's snapshot.
-- MemoryStore mirrors both functions (src/lib/data/merge.ts) for the demo backend and unit tests.

create table public.duplicate_dismissals (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid() references public.users (id) on delete set null deferrable initially deferred,
  archived_at timestamptz,
  org_id uuid not null references public.organizations (id),
  entity text not null check (entity in ('accounts', 'contacts')),
  -- Unordered pair stored in a canonical order so (a, b) and (b, a) are the same dismissal.
  record_a uuid not null,
  record_b uuid not null,
  dismissed_by uuid references public.users (id) on delete set null,
  note text,
  check (record_a < record_b),
  unique (entity, record_a, record_b)
);

create index duplicate_dismissals_org_id_idx on public.duplicate_dismissals (org_id);
create index duplicate_dismissals_record_b_idx on public.duplicate_dismissals (record_b);
create index duplicate_dismissals_dismissed_by_idx on public.duplicate_dismissals (dismissed_by);

select public.attach_updated_at('duplicate_dismissals');

revoke all on public.duplicate_dismissals from anon, authenticated;
grant select, insert, delete on public.duplicate_dismissals to authenticated;
grant select, insert, update, delete on public.duplicate_dismissals to service_role;

alter table public.duplicate_dismissals enable row level security;

-- Leaders run the duplicates view, so only they read or write dismissals.
create policy duplicate_dismissals_select on public.duplicate_dismissals
  for select to authenticated using (public.is_leader());
create policy duplicate_dismissals_insert on public.duplicate_dismissals
  for insert to authenticated
  with check (public.is_leader() and (dismissed_by is null or dismissed_by = (select auth.uid())));
create policy duplicate_dismissals_delete on public.duplicate_dismissals
  for delete to authenticated using (public.is_leader());
create policy duplicate_dismissals_active_user_only on public.duplicate_dismissals
  as restrictive for all to authenticated using (public.is_active_user()) with check (public.is_active_user());

-- Indexes the detection and data-quality queries lean on.
create index if not exists contacts_phone_idx on public.contacts (phone) where phone is not null;
create index if not exists opportunities_expected_close_idx on public.opportunities (expected_close);

-- ---------------------------------------------------------------------------
-- merge_accounts
-- ---------------------------------------------------------------------------

create or replace function public.merge_accounts(p_survivor uuid, p_loser uuid, p_patch jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_me public.users;
  v_s public.accounts;
  v_l public.accounts;
  v_new public.accounts;
  v_after public.accounts;
  v_patch jsonb;
  v_counts jsonb := '{}'::jsonb;
  n integer;
begin
  if not public.is_leader() then
    raise exception 'Only admins and executives can merge records.' using errcode = '42501';
  end if;
  v_me := public.current_app_user();
  if p_survivor = p_loser then
    raise exception 'Pick two different accounts to merge.' using errcode = '22023';
  end if;

  -- Lock both rows for the rest of the transaction (stable order avoids deadlocks).
  perform 1 from public.accounts where id in (p_survivor, p_loser) order by id for update;
  select * into v_s from public.accounts where id = p_survivor;
  select * into v_l from public.accounts where id = p_loser;
  if v_s.id is null or v_l.id is null or v_s.archived_at is not null or v_l.archived_at is not null
     or v_s.org_id <> v_me.org_id or v_l.org_id <> v_me.org_id then
    raise exception 'Both accounts must exist and be active.' using errcode = '22023';
  end if;
  if v_s.konnect_hub_client_id is not null and v_l.konnect_hub_client_id is not null
     and v_s.konnect_hub_client_id <> v_l.konnect_hub_client_id then
    raise exception 'hub_conflict: these accounts are linked to different Konnect Hub clients (% and %).',
      v_s.konnect_hub_client_id, v_l.konnect_hub_client_id using errcode = '23514';
  end if;

  -- Only fields a leader may pick; everything else is fixed by the rules below.
  select coalesce(jsonb_object_agg(key, value), '{}'::jsonb) into v_patch
  from jsonb_each(coalesce(p_patch, '{}'::jsonb))
  where key = any (array['name', 'type', 'sector', 'status', 'tier', 'owner_id', 'website', 'country',
                         'state_region', 'city', 'lat', 'lng', 'description']);
  v_new := jsonb_populate_record(v_s, v_patch);

  update public.accounts set
    name = v_new.name, type = v_new.type, sector = v_new.sector, status = v_new.status, tier = v_new.tier,
    owner_id = v_new.owner_id, website = v_new.website, country = v_new.country,
    state_region = v_new.state_region, city = v_new.city, lat = v_new.lat, lng = v_new.lng,
    description = v_new.description,
    konnect_hub_client_id = coalesce(v_s.konnect_hub_client_id, v_l.konnect_hub_client_id),
    survey_score = coalesce(v_s.survey_score, v_l.survey_score),
    logo_url = coalesce(v_s.logo_url, v_l.logo_url)
  where id = p_survivor
  returning * into v_after;

  -- Direct account_id foreign keys.
  update public.contacts set account_id = p_survivor where account_id = p_loser;
  get diagnostics n = row_count; v_counts := v_counts || jsonb_build_object('contacts', n);
  update public.opportunities set account_id = p_survivor where account_id = p_loser;
  get diagnostics n = row_count; v_counts := v_counts || jsonb_build_object('opportunities', n);
  update public.quotes set account_id = p_survivor where account_id = p_loser;
  get diagnostics n = row_count; v_counts := v_counts || jsonb_build_object('quotes', n);
  update public.quote_lines set oem_partner_account_id = p_survivor where oem_partner_account_id = p_loser;
  get diagnostics n = row_count; v_counts := v_counts || jsonb_build_object('quote_lines', n);
  update public.partner_vetting set account_id = p_survivor where account_id = p_loser;
  get diagnostics n = row_count; v_counts := v_counts || jsonb_build_object('partner_vetting', n);
  update public.project_health set account_id = p_survivor where account_id = p_loser;
  get diagnostics n = row_count; v_counts := v_counts || jsonb_build_object('project_health', n);
  update public.client_items set account_id = p_survivor where account_id = p_loser;
  get diagnostics n = row_count; v_counts := v_counts || jsonb_build_object('client_items', n);
  update public.synced_messages set account_id = p_survivor where account_id = p_loser;
  get diagnostics n = row_count; v_counts := v_counts || jsonb_build_object('synced_messages', n);

  -- account_id + polymorphic (related_type, related_id) links.
  update public.activities set
    account_id = case when account_id = p_loser then p_survivor else account_id end,
    related_id = case when related_type = 'account' and related_id = p_loser then p_survivor else related_id end
  where account_id = p_loser or (related_type = 'account' and related_id = p_loser);
  get diagnostics n = row_count; v_counts := v_counts || jsonb_build_object('activities', n);
  update public.tasks set
    account_id = case when account_id = p_loser then p_survivor else account_id end,
    related_id = case when related_type = 'account' and related_id = p_loser then p_survivor else related_id end
  where account_id = p_loser or (related_type = 'account' and related_id = p_loser);
  get diagnostics n = row_count; v_counts := v_counts || jsonb_build_object('tasks', n);
  update public.files set related_id = p_survivor where related_type = 'account' and related_id = p_loser;
  get diagnostics n = row_count; v_counts := v_counts || jsonb_build_object('files', n);
  update public.copilot_runs set related_id = p_survivor where related_type = 'account' and related_id = p_loser;
  get diagnostics n = row_count; v_counts := v_counts || jsonb_build_object('copilot_runs', n);

  -- Unique join rows: drop the loser's copy when the survivor already has the same tag / view.
  delete from public.record_tags l
  where l.related_type = 'account' and l.related_id = p_loser
    and exists (select 1 from public.record_tags s where s.related_type = 'account' and s.related_id = p_survivor and s.tag_id = l.tag_id);
  update public.record_tags set related_id = p_survivor where related_type = 'account' and related_id = p_loser;
  get diagnostics n = row_count; v_counts := v_counts || jsonb_build_object('record_tags', n);
  delete from public.recent_views l
  where l.related_type = 'account' and l.related_id = p_loser
    and exists (select 1 from public.recent_views s where s.related_type = 'account' and s.related_id = p_survivor and s.user_id = l.user_id);
  update public.recent_views set related_id = p_survivor, label = v_after.name where related_type = 'account' and related_id = p_loser;
  get diagnostics n = row_count; v_counts := v_counts || jsonb_build_object('recent_views', n);

  -- Notification links.
  update public.notifications set href = replace(href, '/accounts/' || p_loser::text, '/accounts/' || p_survivor::text)
  where href like '%/accounts/' || p_loser::text || '%';
  get diagnostics n = row_count; v_counts := v_counts || jsonb_build_object('notifications', n);

  -- Archive the loser; its Hub link now lives on the survivor.
  update public.accounts set archived_at = now(), konnect_hub_client_id = null where id = p_loser;

  insert into public.activities (org_id, type, subject, body, occurred_at, related_type, related_id, account_id, actor_id)
  values (v_me.org_id, 'system', format('Merged "%s" into this record', v_l.name),
          format('Duplicate account %s was merged by %s and archived.', p_loser, v_me.full_name),
          now(), 'account', p_survivor, p_survivor, v_me.id);

  insert into public.audit_log (org_id, actor_id, action, entity, entity_id, before, after)
  values (v_me.org_id, v_me.id, 'account.merged', 'accounts', p_survivor,
          jsonb_build_object('survivor', to_jsonb(v_s)),
          jsonb_build_object('survivor', to_jsonb(v_after), 'loser_id', p_loser, 'loser_snapshot', to_jsonb(v_l),
                             'repointed', v_counts));

  return jsonb_build_object('survivor', to_jsonb(v_after), 'repointed', v_counts);
end;
$$;

-- ---------------------------------------------------------------------------
-- merge_contacts
-- ---------------------------------------------------------------------------

create or replace function public.merge_contacts(p_survivor uuid, p_loser uuid, p_patch jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_me public.users;
  v_s public.contacts;
  v_l public.contacts;
  v_new public.contacts;
  v_after public.contacts;
  v_patch jsonb;
  v_counts jsonb := '{}'::jsonb;
  n integer;
begin
  if not public.is_leader() then
    raise exception 'Only admins and executives can merge records.' using errcode = '42501';
  end if;
  v_me := public.current_app_user();
  if p_survivor = p_loser then
    raise exception 'Pick two different contacts to merge.' using errcode = '22023';
  end if;

  perform 1 from public.contacts where id in (p_survivor, p_loser) order by id for update;
  select * into v_s from public.contacts where id = p_survivor;
  select * into v_l from public.contacts where id = p_loser;
  if v_s.id is null or v_l.id is null or v_s.archived_at is not null or v_l.archived_at is not null
     or v_s.org_id <> v_me.org_id or v_l.org_id <> v_me.org_id then
    raise exception 'Both contacts must exist and be active.' using errcode = '22023';
  end if;

  select coalesce(jsonb_object_agg(key, value), '{}'::jsonb) into v_patch
  from jsonb_each(coalesce(p_patch, '{}'::jsonb))
  where key = any (array['first_name', 'last_name', 'title', 'email', 'phone', 'role_in_buying', 'account_id', 'owner_id']);
  v_new := jsonb_populate_record(v_s, v_patch);
  if not exists (select 1 from public.accounts a where a.id = v_new.account_id and a.archived_at is null) then
    raise exception 'The chosen account is archived or missing.' using errcode = '22023';
  end if;

  update public.contacts set
    first_name = v_new.first_name, last_name = v_new.last_name, title = v_new.title, email = v_new.email,
    phone = v_new.phone, role_in_buying = v_new.role_in_buying, account_id = v_new.account_id, owner_id = v_new.owner_id
  where id = p_survivor
  returning * into v_after;

  update public.activities set related_id = p_survivor where related_type = 'contact' and related_id = p_loser;
  get diagnostics n = row_count; v_counts := v_counts || jsonb_build_object('activities', n);
  update public.tasks set related_id = p_survivor where related_type = 'contact' and related_id = p_loser;
  get diagnostics n = row_count; v_counts := v_counts || jsonb_build_object('tasks', n);
  update public.files set related_id = p_survivor where related_type = 'contact' and related_id = p_loser;
  get diagnostics n = row_count; v_counts := v_counts || jsonb_build_object('files', n);
  update public.copilot_runs set related_id = p_survivor where related_type = 'contact' and related_id = p_loser;
  get diagnostics n = row_count; v_counts := v_counts || jsonb_build_object('copilot_runs', n);
  update public.synced_messages set contact_id = p_survivor where contact_id = p_loser;
  get diagnostics n = row_count; v_counts := v_counts || jsonb_build_object('synced_messages', n);

  -- event_leads is unique per (event, contact): fold the loser's lead into the survivor's for the same event.
  update public.event_leads s set
    interest = case
      when l.interest is null or l.interest = coalesce(s.interest, '') then s.interest
      when s.interest is null or s.interest = '' then l.interest
      else s.interest || E'\n' || l.interest end,
    follow_up_task_id = coalesce(s.follow_up_task_id, l.follow_up_task_id)
  from public.event_leads l
  where l.contact_id = p_loser and s.contact_id = p_survivor and s.event_id = l.event_id;
  delete from public.event_leads l
  where l.contact_id = p_loser and exists (select 1 from public.event_leads s where s.contact_id = p_survivor and s.event_id = l.event_id);
  update public.event_leads set contact_id = p_survivor where contact_id = p_loser;
  get diagnostics n = row_count; v_counts := v_counts || jsonb_build_object('event_leads', n);

  delete from public.record_tags l
  where l.related_type = 'contact' and l.related_id = p_loser
    and exists (select 1 from public.record_tags s where s.related_type = 'contact' and s.related_id = p_survivor and s.tag_id = l.tag_id);
  update public.record_tags set related_id = p_survivor where related_type = 'contact' and related_id = p_loser;
  get diagnostics n = row_count; v_counts := v_counts || jsonb_build_object('record_tags', n);
  delete from public.recent_views l
  where l.related_type = 'contact' and l.related_id = p_loser
    and exists (select 1 from public.recent_views s where s.related_type = 'contact' and s.related_id = p_survivor and s.user_id = l.user_id);
  update public.recent_views set related_id = p_survivor, label = v_after.first_name || ' ' || v_after.last_name
  where related_type = 'contact' and related_id = p_loser;
  get diagnostics n = row_count; v_counts := v_counts || jsonb_build_object('recent_views', n);

  update public.notifications set href = replace(href, '/contacts/' || p_loser::text, '/contacts/' || p_survivor::text)
  where href like '%/contacts/' || p_loser::text || '%';
  get diagnostics n = row_count; v_counts := v_counts || jsonb_build_object('notifications', n);

  update public.contacts set archived_at = now() where id = p_loser;

  insert into public.activities (org_id, type, subject, body, occurred_at, related_type, related_id, account_id, actor_id)
  values (v_me.org_id, 'system', format('Merged "%s %s" into this record', v_l.first_name, v_l.last_name),
          format('Duplicate contact %s was merged by %s and archived.', p_loser, v_me.full_name),
          now(), 'contact', p_survivor, v_after.account_id, v_me.id);

  insert into public.audit_log (org_id, actor_id, action, entity, entity_id, before, after)
  values (v_me.org_id, v_me.id, 'contact.merged', 'contacts', p_survivor,
          jsonb_build_object('survivor', to_jsonb(v_s)),
          jsonb_build_object('survivor', to_jsonb(v_after), 'loser_id', p_loser, 'loser_snapshot', to_jsonb(v_l),
                             'repointed', v_counts));

  return jsonb_build_object('survivor', to_jsonb(v_after), 'repointed', v_counts);
end;
$$;

revoke execute on function public.merge_accounts(uuid, uuid, jsonb), public.merge_contacts(uuid, uuid, jsonb)
  from public, anon;
grant execute on function public.merge_accounts(uuid, uuid, jsonb), public.merge_contacts(uuid, uuid, jsonb)
  to authenticated, service_role;
