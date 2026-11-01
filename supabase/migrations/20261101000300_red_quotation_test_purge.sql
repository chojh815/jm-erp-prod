begin;
create table if not exists public.red_quotation_number_reservations(quotation_no text primary key,quote_id uuid not null,created_at timestamptz not null default now());
insert into public.red_quotation_number_reservations select red_quotation_no,id,now() from public.red_quotations on conflict do nothing;
alter table public.red_quotation_number_reservations enable row level security;
revoke all on public.red_quotation_number_reservations from public,anon,authenticated;
grant select on public.red_quotation_number_reservations to service_role;
create or replace function public.red_reserve_number() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare prefix text;n integer;
begin
 perform pg_advisory_xact_lock(hashtext('red_quotation_number'));
 if new.red_quotation_no ~ '^REDQ-[0-9]{4}-[0-9]+$' then
 prefix:=substring(new.red_quotation_no from 1 for 10);
 select coalesce(max(substring(quotation_no from 11)::integer),0)+1 into n from public.red_quotation_number_reservations where quotation_no like prefix||'%' and substring(quotation_no from 11) ~ '^[0-9]+$';
 new.red_quotation_no:=prefix||lpad(n::text,greatest(4,length(n::text)),'0');end if;
 insert into public.red_quotation_number_reservations(quotation_no,quote_id) values(new.red_quotation_no,new.id);return new;
end $$;
drop trigger if exists red_reserve_number on public.red_quotations;
create trigger red_reserve_number before insert on public.red_quotations for each row execute function public.red_reserve_number();
create table if not exists public.red_quotation_file_cleanup_jobs(
 id uuid primary key default gen_random_uuid(),quote_id uuid not null,bucket_name text not null,file_path text not null,created_by uuid not null,
 state text not null default 'pending' check(state in ('pending','processing','done','retained')),attempts integer not null default 0,
 lease_until timestamptz,last_error text,created_at timestamptz not null default now(),finished_at timestamptz,unique(quote_id,bucket_name,file_path)
);
alter table public.red_quotation_file_cleanup_jobs enable row level security;
revoke all on public.red_quotation_file_cleanup_jobs from public,anon,authenticated;
grant select on public.red_quotation_file_cleanup_jobs to service_role;

create or replace function public.red_purge_plan(q uuid) returns jsonb language plpgsql set search_path=public,pg_temp as $$
declare p jsonb:='{}';t text;r jsonb;vs uuid[];
begin
 select array_agg(id) into vs from public.red_quotation_versions where red_quotation_id=q;
 foreach t in array array['red_quotations','red_quotation_versions','red_quotation_documents','red_quotation_price_matrix','red_quotation_price_matrix_v2','red_quotation_cost_inputs','red_quotation_packaging_costs_v2','red_quotation_images'] loop
 if to_regclass('public.'||t) is null then continue;end if;
 execute format('select coalesce(jsonb_agg(to_jsonb(a) order by to_jsonb(a)::text),''[]'') from public.%I a where (to_jsonb(a)->>''quotation_id''=$1::text or to_jsonb(a)->>''red_quotation_id''=$1::text or to_jsonb(a)->>''red_quotation_version_id''=any($2::text[]) or to_jsonb(a)->>''quotation_version_id''=any($2::text[]) or to_jsonb(a)->>''version_id''=any($2::text[]) or ($3=''red_quotations'' and to_jsonb(a)->>''id''= $1::text))',t) into r using q,vs,t;
 p:=p||jsonb_build_object(t,r);
 end loop;return p;
end $$;
create or replace function public.red_purge_dependencies(p jsonb) returns boolean language plpgsql set search_path=public,pg_temp as $$
declare r record;j integer;condition text;found_ref boolean;q text:=p->'red_quotations'->0->>'id';vs text[];
begin
 select array_agg(x->>'id') into vs from jsonb_array_elements(p->'red_quotation_versions') x;
 for r in select con.*,ch.relname ct,cs.nspname cn,pa.relname pt,ps.nspname pn from pg_constraint con join pg_class ch on ch.oid=con.conrelid join pg_namespace cs on cs.oid=ch.relnamespace join pg_class pa on pa.oid=con.confrelid join pg_namespace ps on ps.oid=pa.relnamespace where con.contype='f' and ps.nspname='public' and p?pa.relname loop
 condition:='true';for j in 1..array_length(r.conkey,1) loop
 condition:=condition||format(' and c.%I=b.%I',(select attname from pg_attribute where attrelid=r.conrelid and attnum=r.conkey[j]),(select attname from pg_attribute where attrelid=r.confrelid and attnum=r.confkey[j]));end loop;
 execute format('select exists(select 1 from %I.%I c join %I.%I b on %s where ($1 @> jsonb_build_array(to_jsonb(b))) and not($2 @> jsonb_build_array(to_jsonb(c))))',r.cn,r.ct,r.pn,r.pt,condition) into found_ref using p->r.pt,case when r.cn='public' then coalesce(p->r.ct,'[]') else '[]'::jsonb end;
 if found_ref then return true;end if;
 -- Reject targeted records which also link to another quote's parent.
 if r.cn='public' and p?r.ct then
 execute format('select exists(select 1 from %I.%I c join %I.%I b on %s where ($2 @> jsonb_build_array(to_jsonb(c))) and not($1 @> jsonb_build_array(to_jsonb(b))))',r.cn,r.ct,r.pn,r.pt,condition) into found_ref using p->r.pt,p->r.ct;
 if found_ref then return true;end if;end if;
 end loop;
 for r in select c.relname,a.attname from pg_class c join pg_namespace n on n.oid=c.relnamespace join pg_attribute a on a.attrelid=c.oid where n.nspname='public' and c.relkind in ('r','p') and not(p?c.relname) and not a.attisdropped and a.attname in ('red_quotation_id','red_quotation_version_id') loop
 execute format('select exists(select 1 from public.%I where %I::text=$1 or %I::text=any($2))',r.relname,r.attname,r.attname) into found_ref using q,vs;
 if found_ref then return true;end if;end loop;
 return false;
end $$;
create or replace function public.red_purge_preview(p_quote uuid) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare q public.red_quotations;p jsonb;reasons jsonb:='[]';counts jsonb;
begin
 select * into q from public.red_quotations where id=p_quote;if not found then raise exception '견적이 없거나 이미 삭제되었습니다.' using errcode='P0002';end if;
 p:=public.red_purge_plan(p_quote);
 if upper(coalesce(q.status,''))<>'DRAFT' or coalesce(to_jsonb(q)->>'is_sent','false')='true' or nullif(to_jsonb(q)->>'sent_at','') is not null or not exists(select 1 from public.red_quotation_versions where red_quotation_id=q.id) or exists(select 1 from public.red_quotation_versions where red_quotation_id=q.id and (status is distinct from 'DRAFT' or sent_at is not null or sent_by is not null)) or exists(select 1 from public.red_quotation_documents where quotation_id=q.id and (upper(coalesce(document#>>'{header,status}','DRAFT'))<>'DRAFT' or coalesce(document#>>'{header,is_sent}','false')='true' or nullif(document#>>'{header,sent_at}','') is not null)) then reasons:=reasons||jsonb_build_array('발송·확정 이력이 있는 견적은 완전 삭제할 수 없습니다. 보관을 사용해 주세요.');end if;
 if exists(select 1 from jsonb_each(p) t cross join lateral jsonb_array_elements(t.value) x where
 (nullif(x->>'quotation_id','') is not null and x->>'quotation_id'<>q.id::text) or
 (nullif(x->>'red_quotation_id','') is not null and x->>'red_quotation_id'<>q.id::text) or
 (nullif(x->>'red_quotation_version_id','') is not null and not exists(select 1 from public.red_quotation_versions where id::text=x->>'red_quotation_version_id' and red_quotation_id=q.id)) or
 (nullif(x->>'quotation_version_id','') is not null and not exists(select 1 from public.red_quotation_versions where id::text=x->>'quotation_version_id' and red_quotation_id=q.id))) then
 reasons:=reasons||jsonb_build_array('서로 다른 견적의 자료 연결을 먼저 확인해 주세요.');end if;
 if public.red_purge_dependencies(p) then reasons:=reasons||jsonb_build_array('다른 견적 또는 업무 자료와 연결되어 있어 완전 삭제할 수 없습니다.');end if;
 if exists(select 1 from jsonb_array_elements(coalesce(p->'red_quotation_images','[]')) x where nullif(x->>'path','') is null or x->>'path' ~ '(^|/)\.\.(/|$)') then reasons:=reasons||jsonb_build_array('이미지 저장 경로 확인이 필요합니다.');end if;
 select jsonb_object_agg(key,jsonb_array_length(value)) into counts from jsonb_each(p);
 counts:=counts||jsonb_build_object('quotation_versions',jsonb_array_length(p->'red_quotation_versions'),'quotation_line_attachments',coalesce(jsonb_array_length(p->'red_quotation_images'),0),'document_lines',(select coalesce(sum(jsonb_array_length(v.value->'cells')),0) from public.red_quotation_documents d cross join lateral jsonb_each(d.document->'packages') v where d.quotation_id=q.id));
 return jsonb_build_object('id',q.id,'quotation_no',q.red_quotation_no,'buyer_name',q.buyer_name,'subject',q.title,'counts',counts,'eligible',jsonb_array_length(reasons)=0,'reasons',reasons,'confirmation_token',md5(p::text));
end $$;
create or replace function public.red_purge_row_allowed(t text,r jsonb) returns boolean language plpgsql set search_path=public,pg_temp as $$
begin if current_setting('app.red_purge',true) is distinct from 'on' then return false;end if;return coalesce(current_setting('app.red_purge_targets',true)::jsonb->t @> jsonb_build_array(r),false);end $$;
create or replace function public.red_guard_document() returns trigger language plpgsql as $$
declare v public.red_quotation_versions; q public.red_quotations;
begin
 if tg_op='DELETE' and public.red_purge_row_allowed(tg_table_name,to_jsonb(old)) then return old;end if;
  if tg_op='DELETE' then raise exception 'Quotation history cannot be deleted' using errcode='55000'; end if;
  select * into q from public.red_quotations where id=new.quotation_id for update;
  select * into v from public.red_quotation_versions where id=new.version_id for update;
  if v.id is null or v.red_quotation_id<>new.quotation_id then raise exception 'Invalid version association' using errcode='55000'; end if;
  if v.status<>'DRAFT' or q.archived_at is not null then raise exception 'Sent/confirmed or archived quotations are read-only' using errcode='55000'; end if;
  if tg_op='UPDATE' and (old.version_id<>new.version_id or old.quotation_id<>new.quotation_id) then raise exception 'Version association is immutable' using errcode='55000'; end if;
  return new;
end $$;
create or replace function public.red_guard_version() returns trigger language plpgsql as $$
begin
 if tg_op='DELETE' and public.red_purge_row_allowed(tg_table_name,to_jsonb(old)) then return old;end if;
  if tg_op='DELETE' then raise exception 'Use archive instead of deleting quotation history' using errcode='55000'; end if;
  if old.status<>'DRAFT' and to_jsonb(old) is distinct from to_jsonb(new) then raise exception 'Sent/confirmed version is immutable' using errcode='55000'; end if;
  if old.red_quotation_id<>new.red_quotation_id or old.version_no<>new.version_no or old.id<>new.id then raise exception 'Version identity is immutable' using errcode='55000'; end if;
  return new;
end $$;
create or replace function public.red_guard_legacy_price() returns trigger language plpgsql as $$
begin
 if tg_op='DELETE' and public.red_purge_row_allowed(tg_table_name,to_jsonb(old)) then return old;end if;
  -- A single immutable legacy source avoids races during first snapshot/copy.
  -- All current writes use red_save_document; stale clients must reload.
  raise exception 'Legacy prices are locked. Use atomic RED document save.' using errcode='55000';
end $$;
create or replace function public.red_prevent_hard_delete() returns trigger language plpgsql as $$
begin
 if tg_op='DELETE' and public.red_purge_row_allowed(tg_table_name,to_jsonb(old)) then return old;end if; raise exception '견적은 삭제 대신 보관 처리해 주세요.' using errcode='55000'; end $$;

create or replace function public.red_purge_commit(p_quote uuid,p_confirmation_no text,p_token text,p_actor uuid) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare p jsonb;preview jsonb;r record;t text;
begin
 -- Rare maintenance action: table locks close legacy write and CASCADE races.
 for r in select relname from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind in ('r','p') and (relname in ('red_quotations','red_quotation_versions','red_quotation_documents','red_quotation_price_matrix','red_quotation_price_matrix_v2','red_quotation_cost_inputs','red_quotation_packaging_costs_v2','red_quotation_images') or exists(select 1 from pg_attribute a where a.attrelid=c.oid and not a.attisdropped and a.attname in ('red_quotation_id','red_quotation_version_id'))) order by relname loop execute format('lock table public.%I in share row exclusive mode',r.relname);end loop;
 preview:=public.red_purge_preview(p_quote);
 if p_confirmation_no is distinct from preview->>'quotation_no' then raise exception '견적번호를 정확히 입력해 주세요.' using errcode='55000';end if;
 if p_token is distinct from preview->>'confirmation_token' then raise exception '견적 내용이 변경되었습니다. 삭제 창을 다시 열어 확인해 주세요.' using errcode='40001';end if;
 if not(preview->>'eligible')::boolean then raise exception '%',preview->'reasons'->>0 using errcode='55000';end if;
 p:=public.red_purge_plan(p_quote);
 insert into public.red_quotation_file_cleanup_jobs(quote_id,bucket_name,file_path,created_by) select distinct p_quote,'red-quotation-images',x->>'path',p_actor from jsonb_array_elements(coalesce(p->'red_quotation_images','[]')) x;
 perform set_config('app.red_purge','on',true);perform set_config('app.red_purge_targets',p::text,true);
 foreach t in array array['red_quotation_images','red_quotation_documents','red_quotation_packaging_costs_v2','red_quotation_cost_inputs','red_quotation_price_matrix_v2','red_quotation_price_matrix','red_quotation_versions','red_quotations'] loop
 if p?t then execute format('delete from public.%I a where $1 @> jsonb_build_array(to_jsonb(a))',t) using p->t;end if;end loop;
 perform set_config('app.red_purge','',true);perform set_config('app.red_purge_targets','',true);
 return preview||jsonb_build_object('deleted',true,'cleanup_pending',(select count(*) from public.red_quotation_file_cleanup_jobs where quote_id=p_quote and created_by=p_actor));
end $$;
create or replace function public.red_purge_cleanup_claim(p_quote uuid,p_actor uuid,p_limit integer default 20) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare j public.red_quotation_file_cleanup_jobs;jobs jsonb:='[]';remaining integer;retained integer;
begin
 for j in select * from public.red_quotation_file_cleanup_jobs where quote_id=p_quote and created_by=p_actor and (state='pending' or state='processing' and lease_until<now()) order by created_at,id limit least(greatest(p_limit,1),20) for update skip locked loop
  if exists(select 1 from public.red_quotation_images where path=j.file_path) then update public.red_quotation_file_cleanup_jobs set state='retained',finished_at=now() where id=j.id;
  else update public.red_quotation_file_cleanup_jobs set state='processing',lease_until=now()+interval '2 minutes',attempts=attempts+1 where id=j.id;jobs:=jobs||jsonb_build_array(jsonb_build_object('id',j.id,'bucket',j.bucket_name,'path',j.file_path));end if;
 end loop;
 select count(*) filter(where state in ('pending','processing')),count(*) filter(where state='retained') into remaining,retained from public.red_quotation_file_cleanup_jobs where quote_id=p_quote and created_by=p_actor;
 return jsonb_build_object('jobs',jobs,'pending',remaining,'retained',retained);
end $$;
create or replace function public.red_purge_cleanup_finish(p_job uuid,p_actor uuid,p_error text default null) returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin update public.red_quotation_file_cleanup_jobs set state=case when p_error is null then 'done' else 'pending' end,finished_at=case when p_error is null then now() else null end,lease_until=null,last_error=left(p_error,500) where id=p_job and created_by=p_actor and state='processing';end $$;

revoke all on function public.red_reserve_number(),public.red_purge_plan(uuid),public.red_purge_dependencies(jsonb),public.red_purge_row_allowed(text,jsonb),public.red_purge_preview(uuid),public.red_purge_commit(uuid,text,text,uuid),public.red_purge_cleanup_claim(uuid,uuid,integer),public.red_purge_cleanup_finish(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.red_purge_row_allowed(text,jsonb),public.red_purge_preview(uuid),public.red_purge_commit(uuid,text,text,uuid),public.red_purge_cleanup_claim(uuid,uuid,integer),public.red_purge_cleanup_finish(uuid,uuid,text) to service_role;

-- Reject new/changed soft links to a purged quote, including writers resumed
-- after the maintenance lock. Existing unchanged legacy links are left intact.
create or replace function public.red_purge_link_guard() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare col text;n jsonb:=to_jsonb(new);o jsonb;ref text;owner_id uuid;
begin
 if tg_op='UPDATE' then o:=to_jsonb(old);end if;
 foreach col in array array['red_quotation_id','red_quotation_version_id'] loop
 ref:=nullif(n->>col,'');if ref is null or tg_op='UPDATE' and n->col is not distinct from o->col then continue;end if;
 if col='red_quotation_id' then owner_id:=ref::uuid;
 else select red_quotation_id into owner_id from public.red_quotation_versions where id=ref::uuid;end if;
 perform 1 from public.red_quotations where id=owner_id for key share;
 if not found then raise exception '삭제되었거나 유효하지 않은 RED 견적입니다.' using errcode='55000';end if;
 if col='red_quotation_version_id' then perform 1 from public.red_quotation_versions where id=ref::uuid for key share;if not found then raise exception '삭제된 RED 견적 버전입니다.' using errcode='55000';end if;end if;
 end loop;return new;
end $$;
do $$declare r record;begin
 for r in select distinct c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace join pg_attribute a on a.attrelid=c.oid where n.nspname='public' and c.relkind in ('r','p') and c.relname not in ('red_quotations','red_quotation_versions','red_quotation_documents','red_quotation_price_matrix','red_quotation_price_matrix_v2','red_quotation_cost_inputs','red_quotation_packaging_costs_v2','red_quotation_images') and not a.attisdropped and a.attname in ('red_quotation_id','red_quotation_version_id') loop
 execute format('drop trigger if exists red_purge_link_guard on public.%I',r.relname);
 execute format('create trigger red_purge_link_guard before insert or update on public.%I for each row execute function public.red_purge_link_guard()',r.relname);
 end loop;
end $$;
revoke all on function public.red_purge_link_guard() from public,anon,authenticated;
notify pgrst,'reload schema';commit;
