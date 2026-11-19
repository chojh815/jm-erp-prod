begin;

-- Older records have no SKU/run identity and may use globally unique batch
-- strings. Keep them in production_batches and store 4.0 records explicitly.
create or replace function public.kiss_batch_code_v4(p_date date,p_vendor text,p_run integer,p_type text,p_version integer)
returns text language plpgsql immutable strict set search_path=public,pg_temp as $$
declare iso_year integer:=extract(isoyear from p_date)::integer; day_letters text;
begin
  if iso_year not between 2016 and 2037 or p_vendor !~ '^[A-Z]$' or p_run not between 1 and 3
     or p_type not in ('V','M') or p_version not between 0 and 9 then
    raise exception 'Invalid KISS 4.0 batch inputs.' using errcode='22023';
  end if;
  day_letters:=(array['ABCDEFG','HJKLNPQ','RSTUWXY'])[p_run];
  return p_vendor||substr('PQRSTUVWXYZABCDEFGHIJK',iso_year-2015,1)||to_char(p_date,'IW')||
    substr(day_letters,extract(isodow from p_date)::integer,1)||p_type||p_version::text;
end;
$$;

create table if not exists public.production_batches_v4 (
  id uuid primary key default gen_random_uuid(),
  buyer_code text not null default 'RED' check(buyer_code='RED'),
  guideline_version text not null default '4.0' check(guideline_version='4.0'),
  sku_code text not null check(sku_code=upper(btrim(sku_code)) and length(sku_code) between 1 and 120),
  mfg_date date not null,
  vendor_initial text not null check(vendor_initial ~ '^[A-Z]$'),
  run_no integer not null check(run_no between 1 and 3),
  label_type text not null check(label_type in ('V','M')),
  version integer not null check(version between 0 and 9),
  batch_code text not null check(length(batch_code)=7),
  base_batch_id uuid references public.production_batches_v4(id),
  po_no text check(length(po_no)<=200),
  created_by uuid not null,
  created_at timestamptz not null default now(),
  unique(buyer_code,vendor_initial,sku_code,mfg_date,run_no,version),
  check(batch_code=public.kiss_batch_code_v4(mfg_date,vendor_initial,run_no,label_type,version)),
  check((version=0 and base_batch_id is null) or (version>0 and base_batch_id is not null))
);
alter table public.production_batches_v4 enable row level security;
revoke all on public.production_batches_v4 from public,anon,authenticated;
grant select,update,delete on public.production_batches_v4 to service_role;

create or replace function public.kiss_batch_v4_immutable() returns trigger language plpgsql set search_path=public,pg_temp as $$
begin
  if to_jsonb(new)-'po_no' is distinct from to_jsonb(old)-'po_no' then
    raise exception '배치 정보는 변경할 수 없습니다. 라벨 수정 버전을 생성해 주세요.' using errcode='55000';
  end if;
  return new;
end;
$$;
drop trigger if exists kiss_batch_v4_immutable on public.production_batches_v4;
create trigger kiss_batch_v4_immutable before update on public.production_batches_v4
for each row execute function public.kiss_batch_v4_immutable();

create or replace function public.create_kiss_batch_v4(
  p_sku text,p_date date,p_vendor text,p_run integer,p_type text,p_version integer,
  p_po text,p_source uuid,p_actor uuid
) returns public.production_batches_v4
language plpgsql security definer set search_path=public,pg_temp as $$
declare source_row public.production_batches_v4; root_id uuid; latest integer; saved public.production_batches_v4;
begin
  p_sku:=upper(btrim(p_sku)); p_vendor:=upper(btrim(p_vendor)); p_type:=upper(btrim(p_type));
  if p_actor is null or p_sku is null or p_date is null or p_vendor is null or p_run is null or p_type is null or p_version is null then
    raise exception '필수 배치 정보를 입력해 주세요.' using errcode='22023';
  end if;
  -- All revisions and originals of one SKU/date/run share a transaction lock.
  perform pg_advisory_xact_lock(hashtextextended('kiss-v4:'||p_vendor||':'||p_sku||':'||p_date::text||':'||p_run::text,0));
  if p_source is null then
    if p_version<>0 then raise exception '새 생산 배치는 라벨 버전 0으로 등록해 주세요.' using errcode='22023';end if;
  else
    select * into source_row from public.production_batches_v4 where id=p_source for update;
    if not found then raise exception '원본 배치가 없습니다.' using errcode='P0002';end if;
    if (source_row.sku_code,source_row.mfg_date,source_row.vendor_initial,source_row.run_no,source_row.label_type)
       is distinct from (p_sku,p_date,p_vendor,p_run,p_type) then
      raise exception '라벨 수정 시 원본 생산 배치 정보를 유지해 주세요.' using errcode='22023';
    end if;
    select max(version) into latest from public.production_batches_v4 where buyer_code='RED'
      and vendor_initial=p_vendor and sku_code=p_sku and mfg_date=p_date and run_no=p_run;
    if source_row.version<>latest or p_version<>latest+1 then
      raise exception '최신 라벨 버전을 다시 선택해 주세요.' using errcode='40001';
    end if;
    root_id:=coalesce(source_row.base_batch_id,source_row.id);
  end if;
  insert into public.production_batches_v4(sku_code,mfg_date,vendor_initial,run_no,label_type,version,batch_code,base_batch_id,po_no,created_by)
  values(p_sku,p_date,p_vendor,p_run,p_type,p_version,
    public.kiss_batch_code_v4(p_date,p_vendor,p_run,p_type,p_version),root_id,nullif(btrim(p_po),''),p_actor)
  returning * into saved;
  return saved;
end;
$$;

revoke all on function public.kiss_batch_code_v4(date,text,integer,text,integer),public.kiss_batch_v4_immutable(),
 public.create_kiss_batch_v4(text,date,text,integer,text,integer,text,uuid,uuid) from public,anon,authenticated;
grant execute on function public.kiss_batch_code_v4(date,text,integer,text,integer),
 public.create_kiss_batch_v4(text,date,text,integer,text,integer,text,uuid,uuid) to service_role;
notify pgrst,'reload schema';
commit;
