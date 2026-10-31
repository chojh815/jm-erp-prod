begin;
alter table public.red_quotations add column if not exists archived_at timestamptz;
alter table public.red_quotations add column if not exists archived_by uuid;
alter table public.red_quotation_versions add column if not exists sent_at timestamptz;
alter table public.red_quotation_versions add column if not exists sent_by uuid;

-- One atomic commercial document per version. Legacy tables remain read-only sources.
create table if not exists public.red_quotation_documents (
  version_id uuid primary key references public.red_quotation_versions(id),
  quotation_id uuid not null references public.red_quotations(id),
  document jsonb not null check(jsonb_typeof(document)='object'),
  revision bigint not null default 1,
  updated_at timestamptz not null default now(),
  updated_by uuid not null
);
alter table public.red_quotation_documents enable row level security;
revoke all on public.red_quotation_documents from anon, authenticated;
grant all on public.red_quotation_documents to service_role;
grant select,insert,update on public.red_quotations,public.red_quotation_versions to service_role;
grant select on public.red_quotation_price_matrix,public.red_quotation_price_matrix_v2,public.red_quotation_cost_inputs,public.red_quotation_packaging_costs_v2 to service_role;

create or replace function public.red_guard_document() returns trigger language plpgsql as $$
declare v public.red_quotation_versions; q public.red_quotations;
begin
  if tg_op='DELETE' then raise exception 'Quotation history cannot be deleted' using errcode='55000'; end if;
  select * into q from public.red_quotations where id=new.quotation_id for update;
  select * into v from public.red_quotation_versions where id=new.version_id for update;
  if v.id is null or v.red_quotation_id<>new.quotation_id then raise exception 'Invalid version association' using errcode='55000'; end if;
  if v.status<>'DRAFT' or q.archived_at is not null then raise exception 'Sent/confirmed or archived quotations are read-only' using errcode='55000'; end if;
  if tg_op='UPDATE' and (old.version_id<>new.version_id or old.quotation_id<>new.quotation_id) then raise exception 'Version association is immutable' using errcode='55000'; end if;
  return new;
end $$;
drop trigger if exists red_guard_document on public.red_quotation_documents;
create trigger red_guard_document before insert or update or delete on public.red_quotation_documents for each row execute function public.red_guard_document();

create or replace function public.red_save_document(p_version uuid,p_document jsonb,p_expected_revision bigint,p_actor uuid)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare v public.red_quotation_versions; q public.red_quotations; current_revision bigint;
begin
  select * into v from public.red_quotation_versions where id=p_version;
  if not found then raise exception 'Version not found' using errcode='P0002'; end if;
  select * into q from public.red_quotations where id=v.red_quotation_id for update;
  select * into v from public.red_quotation_versions where id=p_version for update;
  if v.status<>'DRAFT' or q.archived_at is not null then raise exception '발송/확정 또는 보관된 견적은 수정할 수 없습니다.' using errcode='55000'; end if;
  select revision into current_revision from public.red_quotation_documents where version_id=p_version;
  current_revision:=coalesce(current_revision,0);
  if current_revision<>p_expected_revision then raise exception '다른 사용자가 수정했습니다. 다시 불러온 후 저장해 주세요.' using errcode='40001'; end if;
  p_document:=jsonb_set(p_document,'{header}',to_jsonb(q)||jsonb_build_object('quotation_date',to_char(now() at time zone 'Asia/Seoul','YYYY-MM-DD')));
  insert into public.red_quotation_documents(version_id,quotation_id,document,revision,updated_by)
  values(p_version,q.id,p_document,current_revision+1,p_actor)
  on conflict(version_id) do update set document=excluded.document,revision=excluded.revision,updated_at=now(),updated_by=p_actor;
  update public.red_quotation_versions set updated_at=now() where id=p_version;
  update public.red_quotations set updated_at=now(),status=case when v.version_no=(select max(version_no) from public.red_quotation_versions where red_quotation_id=q.id) then 'DRAFT' else status end where id=q.id;
  return jsonb_build_object('revision',current_revision+1,'document',p_document);
end $$;

create or replace function public.red_create_revision(p_base uuid,p_legacy_document jsonb,p_expected_revision bigint,p_summary text,p_actor uuid)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare b public.red_quotation_versions; q public.red_quotations; n public.red_quotation_versions; d jsonb; current_revision bigint; next_no integer;
begin
  select * into b from public.red_quotation_versions where id=p_base;
  if not found then raise exception 'Version not found' using errcode='P0002'; end if;
  select * into q from public.red_quotations where id=b.red_quotation_id for update;
  select * into b from public.red_quotation_versions where id=p_base for update;
  if q.archived_at is not null then raise exception '보관된 견적은 먼저 복원해 주세요.' using errcode='55000'; end if;
  select document,revision into d,current_revision from public.red_quotation_documents where version_id=p_base;
  if coalesce(current_revision,0)<>p_expected_revision then raise exception '원본이 변경되었습니다. 다시 불러와 주세요.' using errcode='40001'; end if;
  d:=coalesce(d,p_legacy_document);
  if d is null then raise exception 'Source document is required' using errcode='55000'; end if;
  select coalesce(max(version_no),0)+1 into next_no from public.red_quotation_versions where red_quotation_id=q.id;
  insert into public.red_quotation_versions(red_quotation_id,version_no,status,revision_of_version_id,change_summary)
  values(q.id,next_no,'DRAFT',p_base,coalesce(nullif(p_summary,''),'Revision from v'||b.version_no)) returning * into n;
  insert into public.red_quotation_documents(version_id,quotation_id,document,updated_by) values(n.id,q.id,d,p_actor);
  update public.red_quotations set updated_at=now(),status='DRAFT' where id=q.id;
  return jsonb_build_object('id',n.id,'version_no',n.version_no,'status',n.status,'new_version_id',n.id);
end $$;

-- Protect version identity and preserve sent versions even for direct legacy clients.
create or replace function public.red_guard_version() returns trigger language plpgsql as $$
begin
  if tg_op='DELETE' then raise exception 'Use archive instead of deleting quotation history' using errcode='55000'; end if;
  if old.status<>'DRAFT' and to_jsonb(old) is distinct from to_jsonb(new) then raise exception 'Sent/confirmed version is immutable' using errcode='55000'; end if;
  if old.red_quotation_id<>new.red_quotation_id or old.version_no<>new.version_no or old.id<>new.id then raise exception 'Version identity is immutable' using errcode='55000'; end if;
  return new;
end $$;
drop trigger if exists red_guard_version on public.red_quotation_versions;
create trigger red_guard_version before update or delete on public.red_quotation_versions for each row execute function public.red_guard_version();

create or replace function public.red_mark_sent(p_version uuid,p_expected_revision bigint,p_actor uuid)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare v public.red_quotation_versions; q public.red_quotations; d public.red_quotation_documents; active_count integer;
begin
  select * into v from public.red_quotation_versions where id=p_version;
  if not found then raise exception 'Version not found' using errcode='P0002'; end if;
  select * into q from public.red_quotations where id=v.red_quotation_id for update;
  select * into v from public.red_quotation_versions where id=p_version for update;
  if v.status<>'DRAFT' or q.archived_at is not null then raise exception 'Draft version required' using errcode='55000'; end if;
  select * into d from public.red_quotation_documents where version_id=p_version;
  if d.version_id is null or d.revision<>p_expected_revision then raise exception '다시 불러오고 가격을 저장해 주세요.' using errcode='40001'; end if;
  select count(*) into active_count from jsonb_each(d.document->'packages') p cross join lateral jsonb_array_elements(p.value->'cells') c
    where c->>'price_fob_per_pkg' is not null or c->>'override_price_fob_per_pkg' is not null;
  if active_count=0 or exists(select 1 from jsonb_each(d.document->'packages') p cross join lateral jsonb_array_elements(p.value->'cells') c
    where (c->>'price_fob_per_pkg' is not null or c->>'override_price_fob_per_pkg' is not null) and (c->>'offer_usd' is null or (c->>'offer_usd')::numeric<=0)) then
    raise exception '유효한 최종 USD 오퍼가 필요합니다.' using errcode='55000';
  end if;
  update public.red_quotation_versions set status='SENT',sent_at=now(),sent_by=p_actor,updated_at=now() where id=p_version;
  update public.red_quotations set updated_at=now(),status=case when v.version_no=(select max(version_no) from public.red_quotation_versions where red_quotation_id=q.id) then 'SENT' else status end where id=q.id;
  return jsonb_build_object('status','SENT');
end $$;

create or replace function public.red_guard_legacy_price() returns trigger language plpgsql as $$
begin
  -- A single immutable legacy source avoids races during first snapshot/copy.
  -- All current writes use red_save_document; stale clients must reload.
  raise exception 'Legacy prices are locked. Use atomic RED document save.' using errcode='55000';
end $$;
do $$ declare t text; begin
  foreach t in array array['red_quotation_price_matrix','red_quotation_price_matrix_v2','red_quotation_cost_inputs','red_quotation_packaging_costs_v2'] loop
    execute format('drop trigger if exists red_guard_legacy_price on public.%I',t);
    execute format('create trigger red_guard_legacy_price before insert or update or delete on public.%I for each row execute function public.red_guard_legacy_price()',t);
  end loop;
end $$;
create or replace function public.red_prevent_hard_delete() returns trigger language plpgsql as $$
begin raise exception '견적은 삭제 대신 보관 처리해 주세요.' using errcode='55000'; end $$;
drop trigger if exists red_prevent_hard_delete on public.red_quotations;
create trigger red_prevent_hard_delete before delete on public.red_quotations for each row execute function public.red_prevent_hard_delete();

create or replace function public.red_create_quotation(p_header jsonb,p_document jsonb,p_actor uuid)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare q public.red_quotations; v public.red_quotation_versions; prefix text; next_no integer;
begin
  prefix:='REDQ-'||to_char(now() at time zone 'Asia/Seoul','YYMM')||'-';
  perform pg_advisory_xact_lock(hashtext('red_quotation_number'));
  select coalesce(max(substring(red_quotation_no from length(prefix)+1)::integer),0)+1 into next_no from public.red_quotations where red_quotation_no like prefix||'%' and substring(red_quotation_no from length(prefix)+1) ~ '^[0-9]+$';
  insert into public.red_quotations(red_quotation_no,title,buyer_name,style_no,ship_from_code,currency,incoterm,status)
  values(prefix||lpad(next_no::text,greatest(4,length(next_no::text)),'0'),p_header->>'title',p_header->>'buyer_name',p_header->>'style_no',coalesce(p_header->>'ship_from_code','CN_QINGDAO'),'USD','FOB','DRAFT') returning * into q;
  insert into public.red_quotation_versions(red_quotation_id,version_no,status,change_summary) values(q.id,1,'DRAFT','Initial v1') returning * into v;
  p_document:=jsonb_set(p_document,'{header}',to_jsonb(q)||jsonb_build_object('quotation_date',to_char(now() at time zone 'Asia/Seoul','YYYY-MM-DD')));
  insert into public.red_quotation_documents(version_id,quotation_id,document,updated_by) values(v.id,q.id,p_document,p_actor);
  return jsonb_build_object('id',q.id,'red_quotation_no',q.red_quotation_no,'version_id',v.id);
end $$;

revoke all on function public.red_create_quotation(jsonb,jsonb,uuid) from public,anon,authenticated;
grant execute on function public.red_create_quotation(jsonb,jsonb,uuid) to service_role;
revoke all on function public.red_save_document(uuid,jsonb,bigint,uuid),public.red_create_revision(uuid,jsonb,bigint,text,uuid),public.red_mark_sent(uuid,bigint,uuid) from public,anon,authenticated;
grant execute on function public.red_save_document(uuid,jsonb,bigint,uuid),public.red_create_revision(uuid,jsonb,bigint,text,uuid),public.red_mark_sent(uuid,bigint,uuid) to service_role;
notify pgrst,'reload schema';
commit;
