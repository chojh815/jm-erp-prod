begin;
-- Minimal maintenance metadata survives a purge; business quote records do not.
create table if not exists public.quotation_number_reservations(quotation_no text primary key,quote_id uuid not null,created_at timestamptz not null default now());
insert into public.quotation_number_reservations(quotation_no,quote_id) select quotation_no,id from public.quotation_headers on conflict(quotation_no) do nothing;
create table if not exists public.quotation_file_cleanup_jobs(
 id uuid primary key default gen_random_uuid(),quote_id uuid not null,bucket_name text not null,file_path text not null,created_by uuid not null,
 state text not null default 'pending' check(state in ('pending','processing','done','retained')),attempts integer not null default 0,
 lease_until timestamptz,last_error text,created_at timestamptz not null default now(),finished_at timestamptz,unique(quote_id,bucket_name,file_path)
);
alter table public.quotation_number_reservations enable row level security;
alter table public.quotation_file_cleanup_jobs enable row level security;
revoke all on public.quotation_number_reservations,public.quotation_file_cleanup_jobs from public,anon,authenticated;
grant select,insert on public.quotation_number_reservations to service_role;
grant select on public.quotation_file_cleanup_jobs to service_role;

create or replace function public.quotation_reserve_number() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare prefix text;n integer;
begin
 if new.quotation_no ~ '^Q-[0-9]{4}-[0-9]+$' then
  perform pg_advisory_xact_lock(hashtext('general_quotation_number'));
  prefix:=substring(new.quotation_no from 1 for 7);
  select coalesce(max(substring(quotation_no from 8)::integer),0)+1 into n from public.quotation_number_reservations where quotation_no like prefix||'%' and substring(quotation_no from 8) ~ '^[0-9]+$';
  new.quotation_no:=prefix||lpad(n::text,greatest(4,length(n::text)),'0');
 end if;
 insert into public.quotation_number_reservations(quotation_no,quote_id) values(new.quotation_no,new.id);
 return new;
end $$;
drop trigger if exists quotation_reserve_number on public.quotation_headers;
create trigger quotation_reserve_number before insert on public.quotation_headers for each row execute function public.quotation_reserve_number();

-- Determine the precise row set without assuming every legacy table exists.
create or replace function public.quotation_purge_ids(t text,q uuid,lines uuid[],items uuid[],variants uuid[],versions uuid[])
returns jsonb language plpgsql set search_path=public,pg_temp as $$
declare predicate text:='false';c text;out_ids jsonb;relation regclass;
begin
 relation:=to_regclass('public.'||quote_ident(t));if relation is null then return '[]'::jsonb;end if;
 foreach c in array array['quotation_id','quotation_line_id','quotation_item_id','quotation_variant_id','variant_id','version_id'] loop
  if exists(select 1 from pg_attribute where attrelid=relation and attname=c and not attisdropped) then
   predicate:=predicate||case c when 'quotation_id' then ' or quotation_id=$1' when 'quotation_line_id' then ' or quotation_line_id=any($2)' when 'quotation_item_id' then ' or quotation_item_id=any($3)' when 'quotation_variant_id' then ' or quotation_variant_id=any($4)' when 'variant_id' then ' or variant_id=any($4)' else ' or version_id=any($5)' end;
  end if;
 end loop;
 execute format('select coalesce(jsonb_agg(id order by id),''[]''::jsonb) from public.%I where %s',t,predicate) into out_ids using q,lines,items,variants,versions;
 return out_ids;
end $$;
create or replace function public.quotation_purge_plan(q uuid) returns jsonb language plpgsql set search_path=public,pg_temp as $$
declare p jsonb:=jsonb_build_object('quotation_headers',jsonb_build_array(q));t text;l uuid[]:='{}';i uuid[]:='{}';v uuid[]:='{}';ver uuid[]:='{}';
begin
 foreach t in array array['quotation_versions','quotation_lines','quotation_items','quotation_line_keys'] loop
  p:=p||jsonb_build_object(t,public.quotation_purge_ids(t,q,l,i,v,ver));
 end loop;
 select array_agg(x::uuid) into l from (select jsonb_array_elements_text(p->'quotation_lines') x union select jsonb_array_elements_text(p->'quotation_line_keys')) s;
 select array_agg(x::uuid) into i from jsonb_array_elements_text(p->'quotation_items') x;
 select array_agg(x::uuid) into ver from jsonb_array_elements_text(p->'quotation_versions') x;
 p:=p||jsonb_build_object('quotation_variants',public.quotation_purge_ids('quotation_variants',q,l,i,v,ver));
 select array_agg(x::uuid) into v from jsonb_array_elements_text(p->'quotation_variants') x;
 foreach t in array array['quotation_variant_lines','quotation_tiers','quotation_item_tiers','quotation_line_attachments'] loop
  p:=p||jsonb_build_object(t,public.quotation_purge_ids(t,q,l,i,v,ver));
 end loop;
 return p;
end $$;

-- Block cross-quote and external references, including ON DELETE CASCADE edges.
create or replace function public.quotation_purge_dependencies(p jsonb) returns jsonb language plpgsql set search_path=public,pg_temp as $$
declare r record;found_ref boolean;out_names jsonb:='[]';parent_ids uuid[];child_ids uuid[];condition text;cols text[];j integer;
begin
 for r in select con.*,ch.relname child_table,cs.nspname child_schema,pa.relname parent_table,ps.nspname parent_schema from pg_constraint con join pg_class ch on ch.oid=con.conrelid join pg_namespace cs on cs.oid=ch.relnamespace join pg_class pa on pa.oid=con.confrelid join pg_namespace ps on ps.oid=pa.relnamespace where con.contype='f' and ps.nspname='public' and p?pa.relname loop
  select array_agg(x::uuid) into parent_ids from jsonb_array_elements_text(p->r.parent_table) x;
  if coalesce(array_length(parent_ids,1),0)=0 then continue;end if;
  condition:='true';
  for j in 1..array_length(r.conkey,1) loop
   condition:=condition||format(' and c.%I=p.%I',(select attname from pg_attribute where attrelid=r.conrelid and attnum=r.conkey[j]),(select attname from pg_attribute where attrelid=r.confrelid and attnum=r.confkey[j]));
  end loop;
  child_ids:='{}';if r.child_schema='public' and p?r.child_table then select coalesce(array_agg(x::uuid),'{}') into child_ids from jsonb_array_elements_text(p->r.child_table) x;end if;
  execute format('select exists(select 1 from %I.%I c join %I.%I p on %s where p.id=any($1) %s)',r.child_schema,r.child_table,r.parent_schema,r.parent_table,condition,case when r.child_schema='public' and p?r.child_table then 'and not(c.id=any($2))' else '' end) into found_ref using parent_ids,child_ids;
  if found_ref then out_names:=out_names||jsonb_build_array(r.child_table);end if;
  -- A targeted child must not also belong to another quote through a second FK.
  if r.child_schema='public' and p?r.child_table and coalesce(array_length(child_ids,1),0)>0 then
   execute format('select exists(select 1 from %I.%I c join %I.%I p on %s where c.id=any($2) and not(p.id=any($1)))',r.child_schema,r.child_table,r.parent_schema,r.parent_table,condition) into found_ref using parent_ids,child_ids;
   if found_ref then out_names:=out_names||jsonb_build_array(r.child_table);end if;
  end if;
 end loop;
 -- UUID soft references are not necessarily represented by FK constraints.
 for r in select c.relname,a.attname from pg_class c join pg_namespace n on n.oid=c.relnamespace join pg_attribute a on a.attrelid=c.oid where n.nspname='public' and c.relkind in ('r','p') and not(p?c.relname) and c.relname not like 'red\_%' escape '\' and a.atttypid='uuid'::regtype and not a.attisdropped and a.attname in ('quotation_id','quotation_header_id','quotation_version_id','quotation_line_id','quotation_item_id','quotation_variant_id') loop
  cols:=case when r.attname in ('quotation_id','quotation_header_id') then array['quotation_headers'] when r.attname='quotation_version_id' then array['quotation_versions'] when r.attname='quotation_line_id' then array['quotation_lines','quotation_line_keys'] when r.attname='quotation_item_id' then array['quotation_items'] else array['quotation_variants'] end;
  select array_agg(distinct x::uuid) into parent_ids from unnest(cols) t cross join lateral jsonb_array_elements_text(p->t) x;
  execute format('select exists(select 1 from public.%I where %I=any($1))',r.relname,r.attname) into found_ref using parent_ids;
  if found_ref then out_names:=out_names||jsonb_build_array(r.relname);end if;
 end loop;
 if exists(select 1 from pg_attribute where attrelid='public.costing_headers'::regclass and attname='quotation_no' and not attisdropped) then
  execute 'select exists(select 1 from public.costing_headers where quotation_no=(select quotation_no from public.quotation_headers where id=$1))' into found_ref using (p->'quotation_headers'->>0)::uuid;
  if found_ref then out_names:=out_names||jsonb_build_array('costing_headers');end if;
 end if;
 return out_names;
end $$;

create or replace function public.quotation_purge_preview(p_quote uuid) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare q public.quotation_headers;p jsonb;deps jsonb;reasons jsonb:='[]';counts jsonb;token text;vdata jsonb;fdata jsonb;
begin
 select * into q from public.quotation_headers where id=p_quote;if not found then raise exception '견적이 없거나 이미 삭제되었습니다.' using errcode='P0002';end if;
 p:=public.quotation_purge_plan(p_quote);
 if upper(coalesce(q.status,'')) not in ('DRAFT','NEW','OPEN','PENDING','REQUESTED','IN_PROGRESS','DELETED') or coalesce(q.is_sent,false) or q.sent_at is not null or not exists(select 1 from public.quotation_versions where quotation_id=q.id) or exists(select 1 from public.quotation_versions where quotation_id=q.id and (status<>'DRAFT' or sent_at is not null or sent_by is not null or coalesce(header_snapshot->>'is_sent','false')='true' or nullif(header_snapshot->>'sent_at','') is not null or upper(coalesce(header_snapshot->>'status','DRAFT')) not in ('DRAFT','NEW','OPEN','PENDING','REQUESTED','IN_PROGRESS','DELETED'))) then
  reasons:=reasons||jsonb_build_array('발송·확정 이력이 있는 견적은 완전 삭제할 수 없습니다. 보관을 사용해 주세요.');
 end if;
 deps:=public.quotation_purge_dependencies(p);if jsonb_array_length(deps)>0 then reasons:=reasons||jsonb_build_array('다른 견적 또는 업무 자료와 연결되어 있어 완전 삭제할 수 없습니다.');end if;
 if exists(select 1 from public.quotation_line_attachments where id in(select x::uuid from jsonb_array_elements_text(p->'quotation_line_attachments') x) and (bucket_name not in ('quotation-version-files','quotation-attachments') or file_path is null or file_path='' or file_path ~ '(^|/)\.\.(/|$)')) then reasons:=reasons||jsonb_build_array('첨부 저장 경로 확인이 필요하여 삭제를 중단합니다.');end if;
 select jsonb_object_agg(key,jsonb_array_length(value)) into counts from jsonb_each(p);
 counts:=counts||jsonb_build_object('document_lines',(select coalesce(sum(jsonb_array_length(document->'lines')),0) from public.quotation_versions where quotation_id=q.id and document is not null));
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'revision',revision,'updated_at',updated_at,'status',status) order by id),'[]') into vdata from public.quotation_versions where quotation_id=q.id;
 select coalesce(jsonb_agg(to_jsonb(a) order by a.id),'[]') into fdata from public.quotation_line_attachments a where id in(select x::uuid from jsonb_array_elements_text(p->'quotation_line_attachments') x);
 token:=md5(jsonb_build_object('header',to_jsonb(q),'versions',vdata,'plan',p,'files',fdata)::text);
 return jsonb_build_object('id',q.id,'quotation_no',q.quotation_no,'buyer_name',q.buyer_name,'subject',q.subject,'eligible',jsonb_array_length(reasons)=0,'reasons',reasons,'counts',counts,'confirmation_token',token);
end $$;

create or replace function public.quotation_purge_row_allowed(t text,r jsonb) returns boolean language plpgsql set search_path=public,pg_temp as $$
declare p jsonb;
begin
 if current_setting('app.quotation_purge',true) is null or current_setting('app.quotation_purge',true)='' then return false;end if;
 p:=current_setting('app.quotation_purge_targets',true)::jsonb;
 return coalesce(p->t @> jsonb_build_array(r->>'id'),false);
end $$;
create or replace function public.quotation_protect() returns trigger language plpgsql as $$
begin
 if tg_op='DELETE' then if public.quotation_purge_row_allowed(tg_table_name,to_jsonb(old)) then return old;end if;raise exception '견적 이력은 삭제 대신 보관해 주세요.' using errcode='55000';end if;
 if current_setting('app.quotation_write',true) is distinct from 'on' then raise exception '통합 견적 저장 기능을 사용해 주세요.' using errcode='55000';end if;
 if tg_table_name='quotation_versions' and tg_op='UPDATE' then
  if old.status<>'DRAFT' and to_jsonb(old) is distinct from to_jsonb(new) then raise exception '발송/확정본은 변경할 수 없습니다.' using errcode='55000';end if;
  if old.id<>new.id or old.quotation_id<>new.quotation_id or old.version_no<>new.version_no then raise exception '버전 연결은 변경할 수 없습니다.' using errcode='55000';end if;
 end if;return new;
end $$;
create or replace function public.quotation_legacy_readonly() returns trigger language plpgsql as $$
begin if tg_op='DELETE' and public.quotation_purge_row_allowed(tg_table_name,to_jsonb(old)) then return old;end if;raise exception '기존 견적 가격은 보존됩니다. 새 통합 견적 화면을 사용해 주세요.' using errcode='55000';end $$;
do $$begin if to_regclass('public.quotation_tiers') is not null then
 execute 'drop trigger if exists quotation_legacy_readonly on public.quotation_tiers';
 execute 'create trigger quotation_legacy_readonly before insert or update or delete on public.quotation_tiers for each row execute function public.quotation_legacy_readonly()';
end if;end $$;

create or replace function public.quotation_purge_commit(p_quote uuid,p_confirmation_no text,p_token text,p_actor uuid) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare r record;q public.quotation_headers;p jsonb;preview jsonb;ids uuid[];t text;count_before integer;
begin
 -- Serialize soft-reference writers before inspecting and removing the target.
 for r in select distinct c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace join pg_attribute a on a.attrelid=c.oid where n.nspname='public' and c.relkind in ('r','p') and c.relname not in ('quotation_headers','quotation_versions','quotation_line_keys','quotation_line_attachments','quotation_lines','quotation_items','quotation_variants','quotation_variant_lines','quotation_tiers','quotation_item_tiers') and c.relname not like 'red\_%' escape '\' and a.atttypid='uuid'::regtype and a.attname in ('quotation_id','quotation_header_id','quotation_version_id','quotation_line_id','quotation_item_id','quotation_variant_id') and not a.attisdropped order by c.relname loop
  execute format('lock table public.%I in share mode',r.relname);
 end loop;
 select * into q from public.quotation_headers where id=p_quote for update;if not found then raise exception '견적이 없거나 이미 삭제되었습니다.' using errcode='P0002';end if;
 if p_confirmation_no is distinct from q.quotation_no then raise exception '견적번호를 정확히 입력해 주세요.' using errcode='55000';end if;
 p:=public.quotation_purge_plan(q.id);
 for r in select key,value from jsonb_each(p) order by key loop
  if to_regclass('public.'||quote_ident(r.key)) is not null then
   select array_agg(x::uuid) into ids from jsonb_array_elements_text(r.value) x;
   execute format('select id from public.%I where id=any($1) for update',r.key) using ids;
  end if;
 end loop;
 preview:=public.quotation_purge_preview(q.id);
 if preview->>'confirmation_token' is distinct from p_token then raise exception '견적 내용이 변경되었습니다. 삭제 창을 다시 열어 확인해 주세요.' using errcode='40001';end if;
 if not (preview->>'eligible')::boolean then raise exception '%',preview->'reasons'->>0 using errcode='55000';end if;
 insert into public.quotation_file_cleanup_jobs(quote_id,bucket_name,file_path,created_by)
 select distinct q.id,a.bucket_name,a.file_path,p_actor from public.quotation_line_attachments a where a.id in(select x::uuid from jsonb_array_elements_text(p->'quotation_line_attachments') x) on conflict(quote_id,bucket_name,file_path) do nothing;
 perform set_config('app.quotation_purge',q.id::text,true);perform set_config('app.quotation_purge_targets',p::text,true);
 foreach t in array array['quotation_line_attachments','quotation_variant_lines','quotation_tiers','quotation_item_tiers','quotation_variants','quotation_items','quotation_lines','quotation_line_keys','quotation_versions','quotation_headers'] loop
  if to_regclass('public.'||quote_ident(t)) is not null then
   select array_agg(x::uuid) into ids from jsonb_array_elements_text(p->t) x;
   execute format('delete from public.%I where id=any($1)',t) using ids;
  end if;
 end loop;
 perform set_config('app.quotation_purge','',true);perform set_config('app.quotation_purge_targets','',true);
 return jsonb_build_object('deleted',true,'id',q.id,'quotation_no',q.quotation_no,'counts',preview->'counts','cleanup_pending',(select count(*) from public.quotation_file_cleanup_jobs where quote_id=q.id and created_by=p_actor and state in ('pending','processing')));
end $$;

create or replace function public.quotation_purge_cleanup_claim(p_quote uuid,p_actor uuid,p_limit integer default 20) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare j public.quotation_file_cleanup_jobs;jobs jsonb:='[]';remaining integer;retained integer;
begin
 for j in select * from public.quotation_file_cleanup_jobs where quote_id=p_quote and created_by=p_actor and (state='pending' or state='processing' and lease_until<now()) order by created_at,id limit least(greatest(p_limit,1),20) for update skip locked loop
  if exists(select 1 from public.quotation_line_attachments where bucket_name=j.bucket_name and file_path=j.file_path) then update public.quotation_file_cleanup_jobs set state='retained',finished_at=now() where id=j.id;
  else update public.quotation_file_cleanup_jobs set state='processing',lease_until=now()+interval '2 minutes',attempts=attempts+1 where id=j.id;jobs:=jobs||jsonb_build_array(jsonb_build_object('id',j.id,'bucket',j.bucket_name,'path',j.file_path));end if;
 end loop;
 select count(*) filter(where state in ('pending','processing')),count(*) filter(where state='retained') into remaining,retained from public.quotation_file_cleanup_jobs where quote_id=p_quote and created_by=p_actor;
 return jsonb_build_object('jobs',jobs,'pending',remaining,'retained',retained);
end $$;
create or replace function public.quotation_purge_cleanup_finish(p_job uuid,p_actor uuid,p_error text default null) returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin update public.quotation_file_cleanup_jobs set state=case when p_error is null then 'done' else 'pending' end,finished_at=case when p_error is null then now() else null end,lease_until=null,last_error=left(p_error,500) where id=p_job and created_by=p_actor and state='processing';end $$;

-- Give the existing Costing soft links FK-like concurrency protection. Unchanged
-- legacy links are preserved; a stale writer cannot relink a purged quote later.
create or replace function public.quotation_costing_link_guard() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare n jsonb:=to_jsonb(new);o jsonb;column_name text;ref text;owner_id uuid;line_owner uuid;
begin
 if tg_op='UPDATE' then o:=to_jsonb(old);end if;
 foreach column_name in array array['quotation_id','quotation_line_id','quotation_no'] loop
  ref:=nullif(n->>column_name,'');if ref is null or tg_op='UPDATE' and n->column_name is not distinct from o->column_name then continue;end if;
  owner_id:=null;
  if column_name='quotation_id' then owner_id:=ref::uuid;
  elsif column_name='quotation_line_id' then
   select quotation_id into owner_id from public.quotation_line_keys where id=ref::uuid;
   if owner_id is null then raise exception '삭제되었거나 유효하지 않은 견적 행입니다.' using errcode='55000';end if;
  else select quote_id into owner_id from public.quotation_number_reservations where quotation_no=ref;if owner_id is null then continue;end if;
  end if;
  perform 1 from public.quotation_headers where id=owner_id for key share;
  if not found then raise exception '이미 삭제되었거나 유효하지 않은 견적입니다.' using errcode='55000';end if;
  if column_name='quotation_line_id' then
   perform 1 from public.quotation_line_keys where id=ref::uuid for key share;
   if not found then raise exception '삭제된 견적 행입니다.' using errcode='55000';end if;
  end if;
 end loop;
 return new;
end $$;
drop trigger if exists quotation_costing_link_guard on public.costing_headers;
create trigger quotation_costing_link_guard before insert or update on public.costing_headers for each row execute function public.quotation_costing_link_guard();

revoke all on function public.quotation_reserve_number(),public.quotation_costing_link_guard(),public.quotation_purge_ids(text,uuid,uuid[],uuid[],uuid[],uuid[]),public.quotation_purge_plan(uuid),public.quotation_purge_dependencies(jsonb),public.quotation_purge_preview(uuid),public.quotation_purge_row_allowed(text,jsonb),public.quotation_purge_commit(uuid,text,text,uuid),public.quotation_purge_cleanup_claim(uuid,uuid,integer),public.quotation_purge_cleanup_finish(uuid,uuid,text) from public,anon,authenticated;
-- Row trigger helpers remain callable by existing server-side write functions.
grant execute on function public.quotation_purge_row_allowed(text,jsonb),public.quotation_purge_preview(uuid),public.quotation_purge_commit(uuid,text,text,uuid),public.quotation_purge_cleanup_claim(uuid,uuid,integer),public.quotation_purge_cleanup_finish(uuid,uuid,text) to service_role;
notify pgrst,'reload schema';
commit;
