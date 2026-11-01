begin;
select set_config('app.quotation_write','on',true);
alter table public.quotation_headers add column if not exists archived_at timestamptz;
alter table public.quotation_headers add column if not exists archived_by uuid;
create table if not exists public.quotation_versions (
 id uuid primary key default gen_random_uuid(),quotation_id uuid not null references public.quotation_headers(id),
 version_no integer not null,status text not null default 'DRAFT' check(status in ('DRAFT','SENT','CONFIRMED')),
 document jsonb,header_snapshot jsonb not null,revision bigint not null default 0,
 previous_version_id uuid references public.quotation_versions(id),change_note text not null default '',
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(),updated_by uuid,
 sent_at timestamptz,sent_by uuid,unique(quotation_id,version_no)
);
create table if not exists public.quotation_line_keys(id uuid primary key,quotation_id uuid not null references public.quotation_headers(id));
alter table public.quotation_line_attachments add column if not exists version_id uuid references public.quotation_versions(id);
alter table public.quotation_line_attachments add column if not exists bucket_name text not null default 'quotation-attachments';
insert into public.quotation_versions(quotation_id,version_no,status,header_snapshot,sent_at)
 select h.id,1,case when upper(coalesce(h.status,'')) in ('SENT','CONFIRMED') then upper(h.status) when coalesce(h.is_sent,false) then 'SENT' when upper(coalesce(h.status,'')) in ('DRAFT','NEW','OPEN','PENDING','REQUESTED','IN_PROGRESS','DELETED','') then 'DRAFT' else 'CONFIRMED' end,
 to_jsonb(h)||jsonb_build_object('buyer_id',coalesce(h.buyer_id,a.buyer_id),'buyer_name',coalesce(nullif(h.buyer_name,''),a.display_name,to_jsonb(c)->>'company_name',to_jsonb(c)->>'name'),'buyer_code',coalesce(nullif(h.buyer_code,''),to_jsonb(c)->>'code')),h.sent_at
 from public.quotation_headers h left join public.quote_accounts a on a.id=h.quote_account_id left join public.companies c on c.id=coalesce(h.buyer_id,a.buyer_id) on conflict(quotation_id,version_no) do nothing;
update public.quotation_headers set archived_at=coalesce(deleted_at,now()) where is_deleted=true and archived_at is null;
insert into public.quotation_line_keys(id,quotation_id) select id,quotation_id from public.quotation_lines where quotation_id is not null on conflict(id) do nothing;
insert into public.quotation_line_keys(id,quotation_id) select id,quotation_id from public.quotation_items where quotation_id is not null on conflict(id) do nothing;
update public.quotation_line_attachments a set version_id=v.id from public.quotation_versions v where a.version_id is null and a.quotation_id=v.quotation_id and v.version_no=1;
create index if not exists quotation_version_file_idx on public.quotation_line_attachments(version_id,quotation_line_id);
alter table public.quotation_versions enable row level security;
alter table public.quotation_line_keys enable row level security;
revoke all on public.quotation_versions,public.quotation_line_keys from anon,authenticated;
grant all on public.quotation_versions,public.quotation_line_keys to service_role;
grant select,insert,update on public.quotation_headers,public.quotation_line_attachments to service_role;
grant select on public.quotation_lines,public.quotation_items,public.quotation_variants,public.quotation_variant_lines,public.costing_headers,public.companies to service_role;

create or replace function public.quotation_protect() returns trigger language plpgsql as $$
begin
 if tg_op='DELETE' then raise exception '견적 이력은 삭제 대신 보관해 주세요.' using errcode='55000'; end if;
 if current_setting('app.quotation_write',true) is distinct from 'on' then raise exception '통합 견적 저장 기능을 사용해 주세요.' using errcode='55000'; end if;
 if tg_table_name='quotation_versions' and tg_op='UPDATE' then
  if old.status<>'DRAFT' and to_jsonb(old) is distinct from to_jsonb(new) then raise exception '발송/확정본은 변경할 수 없습니다.' using errcode='55000'; end if;
  if old.id<>new.id or old.quotation_id<>new.quotation_id or old.version_no<>new.version_no then raise exception '버전 연결은 변경할 수 없습니다.' using errcode='55000'; end if;
 end if;
 return new;
end $$;
do $$declare t text;begin
 foreach t in array array['quotation_headers','quotation_versions','quotation_line_attachments','quotation_line_keys'] loop
  execute format('drop trigger if exists quotation_protect on public.%I',t);
  execute format('create trigger quotation_protect before insert or update or delete on public.%I for each row execute function public.quotation_protect()',t);
  execute format('revoke insert,update,delete on public.%I from anon,authenticated',t);
 end loop;
end $$;
create or replace function public.quotation_legacy_readonly() returns trigger language plpgsql as $$
begin raise exception '기존 견적 가격은 보존됩니다. 새 통합 견적 화면을 사용해 주세요.' using errcode='55000';end $$;
do $$declare t text;begin
 foreach t in array array['quotation_lines','quotation_items','quotation_variants','quotation_variant_lines','quotation_item_tiers'] loop
  if to_regclass('public.'||t) is not null then
   execute format('drop trigger if exists quotation_legacy_readonly on public.%I',t);
   execute format('create trigger quotation_legacy_readonly before insert or update or delete on public.%I for each row execute function public.quotation_legacy_readonly()',t);
   execute format('revoke insert,update,delete on public.%I from anon,authenticated',t);
  end if;
 end loop;
end $$;

create or replace function public.quotation_write(p_action text,p_quote uuid,p_version uuid,p_revision bigint,p_document jsonb,p_actor uuid,p_note text default '',p_file jsonb default null)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare q public.quotation_headers;v public.quotation_versions;n public.quotation_versions;d jsonb;h jsonb;l jsonb;k uuid;no integer;prefix text;fn text;
begin
 perform set_config('app.quotation_write','on',true);
 if p_action='create' then
  h:=p_document->'header';prefix:='Q-'||to_char(now() at time zone 'Asia/Seoul','YYMM')||'-';
  perform pg_advisory_xact_lock(hashtext('general_quotation_number'));
  select coalesce(max(substring(quotation_no from length(prefix)+1)::integer),0)+1 into no from public.quotation_headers where quotation_no like prefix||'%' and substring(quotation_no from length(prefix)+1) ~ '^[0-9]+$';
  insert into public.quotation_headers(quotation_no,buyer_id,buyer_code,buyer_name,subject,currency,incoterm,remarks,received_at,quotation_date,valid_until,status,created_by)
  values(prefix||lpad(no::text,greatest(4,length(no::text)),'0'),nullif(h->>'buyer_id','')::uuid,h->>'buyer_code',h->>'buyer_name',h->>'subject',h->>'currency',h->>'incoterm',h->>'remarks',coalesce(nullif(h->>'received_at','')::date,current_date),nullif(h->>'quotation_date','')::date,nullif(h->>'valid_until','')::date,'DRAFT',p_actor) returning * into q;
  insert into public.quotation_versions(quotation_id,version_no,document,header_snapshot,revision,updated_by) values(q.id,1,p_document,to_jsonb(q),1,p_actor) returning * into v;
 elsif p_action in ('archive','restore') then
  select * into q from public.quotation_headers where id=p_quote for update;
  if not found then raise exception '견적이 없습니다.' using errcode='P0002';end if;
  update public.quotation_headers set archived_at=case when p_action='archive' then now() else null end,archived_by=case when p_action='archive' then p_actor else null end,is_deleted=(p_action='archive'),updated_at=now() where id=q.id;
  return jsonb_build_object('id',q.id,'archived',p_action='archive');
 else
  select * into q from public.quotation_headers where id=p_quote for update;
  if not found then raise exception '견적이 없습니다.' using errcode='P0002';end if;
  select * into v from public.quotation_versions where id=p_version and quotation_id=q.id for update;
  if not found then raise exception '이 견적의 버전이 아닙니다.' using errcode='P0002';end if;
  if q.archived_at is not null or q.is_deleted then raise exception '보관된 견적은 먼저 복원해 주세요.' using errcode='55000';end if;
  if v.revision is distinct from p_revision then raise exception '다른 사용자가 변경했습니다. 다시 불러온 후 저장해 주세요.' using errcode='40001';end if;
  if p_action='revise' then
   d:=coalesce(v.document,p_document);
   if d is null then raise exception '복사할 자료가 없습니다.' using errcode='55000';end if;
   select coalesce(max(version_no),0)+1 into no from public.quotation_versions where quotation_id=q.id;
   insert into public.quotation_versions(quotation_id,version_no,document,header_snapshot,revision,previous_version_id,change_note,updated_by) values(q.id,no,d,v.header_snapshot,1,v.id,left(p_note,2000),p_actor) returning * into n;
   insert into public.quotation_line_attachments(quotation_id,quotation_line_id,version_id,bucket_name,file_name,file_path,mime_type,file_size,created_by,created_by_email)
    select q.id,a.quotation_line_id,n.id,a.bucket_name,a.file_name,a.file_path,a.mime_type,a.file_size,p_actor,a.created_by_email from public.quotation_line_attachments a where a.quotation_id=q.id and a.version_id=v.id and not coalesce(a.is_deleted,false);
   v:=n;
  else
   if v.status<>'DRAFT' then raise exception '발송/확정본은 수정할 수 없습니다. 수정본을 만들어 주세요.' using errcode='55000';end if;
   if p_action='save' then
    update public.quotation_versions set document=p_document,revision=revision+1,updated_at=now(),updated_by=p_actor where id=v.id returning * into v;
   elsif p_action='sent' then
    d:=v.document;
    if d is null or coalesce((d->>'requires_review')::boolean,true) or jsonb_array_length(d->'lines')=0 then raise exception '가격 원본을 확인하고 저장해 주세요.' using errcode='55000';end if;
    for l in select * from jsonb_array_elements(d->'lines') loop
     if (l->>'qty')::numeric<=0 or l->>'offer_price' is null or (l->>'offer_price')::numeric<=0 or exists(select 1 from jsonb_array_elements(l->'tiers') t where t->>'offer_price' is null or (t->>'offer_price')::numeric<=0) then raise exception '모든 행과 MOQ에 유효한 최종 단가가 필요합니다.' using errcode='55000';end if;
    end loop;
    update public.quotation_versions set status='SENT',sent_at=now(),sent_by=p_actor,updated_at=now() where id=v.id returning * into v;
   elsif p_action in ('file_add','file_remove') then
    k:=(p_file->>'line_id')::uuid;
    if not exists(select 1 from jsonb_array_elements(v.document->'lines') x where x->>'id'=k::text) then raise exception '이 버전의 견적 행이 아닙니다.' using errcode='55000';end if;
    if p_action='file_add' then
     if exists(select 1 from public.quotation_line_attachments where version_id=v.id and file_path=p_file->>'path' and not coalesce(is_deleted,false)) then raise exception '이미 등록한 파일입니다.' using errcode='55000';end if;
     if (select count(*) from public.quotation_line_attachments where version_id=v.id and quotation_line_id=k and not coalesce(is_deleted,false))>=10 then raise exception '행당 첨부는 최대 10개입니다.' using errcode='55000';end if;
     insert into public.quotation_line_attachments(quotation_id,quotation_line_id,version_id,bucket_name,file_name,file_path,mime_type,file_size,created_by,created_by_email)
     values(q.id,k,v.id,'quotation-version-files',p_file->>'name',p_file->>'path',p_file->>'type',(p_file->>'size')::bigint,p_actor,p_file->>'email');
    else
     update public.quotation_line_attachments set is_deleted=true,deleted_at=now() where id=(p_file->>'id')::uuid and version_id=v.id and quotation_id=q.id and quotation_line_id=k;
     if not found then raise exception '첨부가 없습니다.' using errcode='P0002';end if;
    end if;
    update public.quotation_versions set revision=revision+1,updated_at=now(),updated_by=p_actor where id=v.id returning * into v;
   else raise exception '지원하지 않는 작업입니다.' using errcode='55000';end if;
  end if;
 end if;
 -- A UUID may never move between quotations, even across versions or legacy sources.
 if v.document is not null then
  for l in select * from jsonb_array_elements(v.document->'lines') loop
   k:=(l->>'id')::uuid;
   insert into public.quotation_line_keys(id,quotation_id) values(k,q.id) on conflict(id) do nothing;
   if not exists(select 1 from public.quotation_line_keys where id=k and quotation_id=q.id) then raise exception '다른 견적의 행 ID입니다.' using errcode='55000';end if;
  end loop;
 end if;
 if v.version_no=(select max(version_no) from public.quotation_versions where quotation_id=q.id) then
  h:=v.document->'header';
  update public.quotation_headers set status=v.status,is_sent=(v.status='SENT'),sent_at=v.sent_at,updated_at=now(),buyer_id=coalesce(nullif(h->>'buyer_id','')::uuid,buyer_id),buyer_name=coalesce(h->>'buyer_name',buyer_name),buyer_code=coalesce(h->>'buyer_code',buyer_code),buyer_brand_name=coalesce(h->>'brand',buyer_brand_name),subject=coalesce(h->>'subject',subject),currency=coalesce(h->>'currency',currency),incoterm=coalesce(h->>'incoterm',incoterm),remarks=coalesce(h->>'remarks',remarks),quotation_date=coalesce(nullif(h->>'quotation_date','')::date,quotation_date),received_at=coalesce(nullif(h->>'received_at','')::date,received_at),valid_until=nullif(h->>'valid_until','')::date,style_no=coalesce(v.document->'lines'->0->>'style_no',style_no) where id=q.id;
 end if;
 return jsonb_build_object('id',q.id,'quotation_id',q.id,'quotation_no',q.quotation_no,'version_id',v.id,'version_no',v.version_no,'revision',v.revision,'status',v.status);
end $$;
revoke all on function public.quotation_write(text,uuid,uuid,bigint,jsonb,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.quotation_write(text,uuid,uuid,bigint,jsonb,uuid,text,jsonb) to service_role;
insert into storage.buckets(id,name,public,file_size_limit) values('quotation-version-files','quotation-version-files',false,10485760) on conflict(id) do update set public=false,file_size_limit=10485760;
drop policy if exists quotation_files_no_direct_clients on storage.objects;
create policy quotation_files_no_direct_clients on storage.objects as restrictive for all to anon,authenticated using(bucket_id<>'quotation-version-files') with check(bucket_id<>'quotation-version-files');
notify pgrst,'reload schema';
commit;
