-- JM-ERP: Samples auto-sync from PO (tables + triggers + storage policies)

create extension if not exists "pgcrypto";

do $$
begin
  if not exists (select 1 from pg_type where typname = 'sample_type') then
    create type sample_type as enum ('APPROVAL', 'PP', 'TOP', 'FINAL');
  end if;

  if not exists (select 1 from pg_type where typname = 'sample_status') then
    create type sample_status as enum ('PLANNED', 'SENT', 'RECEIVED', 'APPROVED', 'REWORK');
  end if;
end$$;

-- po_headers (필요 컬럼 포함)
create table if not exists public.po_headers (
  id uuid primary key default gen_random_uuid(),
  po_no text not null unique,
  origin_code text,
  is_reorder boolean not null default false,
  sample_target_approval date,
  sample_target_pp date,
  sample_target_top date,
  sample_target_final date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_po_headers_po_no on public.po_headers (po_no);
create index if not exists idx_po_headers_updated_at on public.po_headers (updated_at);

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end$$;

drop trigger if exists trg_po_headers_touch on public.po_headers;
create trigger trg_po_headers_touch
before update on public.po_headers
for each row execute procedure public.touch_updated_at();

-- sample_milestones
create table if not exists public.sample_milestones (
  id uuid primary key default gen_random_uuid(),
  po_id uuid not null references public.po_headers(id) on delete cascade,
  po_no text not null,
  type sample_type not null,
  style_no text,
  origin_code text,
  planned_date date,
  actual_date date,
  status sample_status not null default 'PLANNED',
  carrier text,
  tracking_no text,
  attachments jsonb default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (po_id, type)
);

create index if not exists idx_sample_milestones_po       on public.sample_milestones (po_id);
create index if not exists idx_sample_milestones_po_no    on public.sample_milestones (po_no);
create index if not exists idx_sample_milestones_type     on public.sample_milestones (type);
create index if not exists idx_sample_milestones_planned  on public.sample_milestones (planned_date);
create index if not exists idx_sample_milestones_status   on public.sample_milestones (status);

drop trigger if exists trg_sample_milestones_touch on public.sample_milestones;
create trigger trg_sample_milestones_touch
before update on public.sample_milestones
for each row execute procedure public.touch_updated_at();

-- po_no 변경 시 milestones의 po_no도 동기화
create or replace function public.sync_milestones_po_no()
returns trigger language plpgsql as $$
begin
  if new.po_no is distinct from old.po_no then
    update public.sample_milestones
       set po_no = new.po_no
     where po_id = new.id;
  end if;
  return new;
end$$;

drop trigger if exists trg_sync_milestones_po_no on public.po_headers;
create trigger trg_sync_milestones_po_no
after update of po_no on public.po_headers
for each row execute procedure public.sync_milestones_po_no();

-- upsert helper
create or replace function public.upsert_milestone_from_po(
  p_po_id uuid,
  p_po_no text,
  p_type  sample_type,
  p_plan  date
) returns void language plpgsql as $$
begin
  if p_plan is null then
    return;
  end if;

  insert into public.sample_milestones (po_id, po_no, type, planned_date, status)
  values (p_po_id, p_po_no, p_type, p_plan, 'PLANNED')
  on conflict (po_id, type) do update
    set planned_date = excluded.planned_date;
end$$;

-- 메인 동기화 트리거: po_headers 저장/수정 시 milestones 자동 upsert
create or replace function public.sync_sample_milestones()
returns trigger language plpgsql as $$
begin
  if (new.is_reorder is false or new.is_reorder is null) then
    perform public.upsert_milestone_from_po(new.id, new.po_no, 'APPROVAL', new.sample_target_approval);
  end if;

  perform public.upsert_milestone_from_po(new.id, new.po_no, 'PP',    new.sample_target_pp);
  perform public.upsert_milestone_from_po(new.id, new.po_no, 'TOP',   new.sample_target_top);
  perform public.upsert_milestone_from_po(new.id, new.po_no, 'FINAL', new.sample_target_final);

  return new;
end$$;

drop trigger if exists trg_sync_sample_milestones_ins on public.po_headers;
drop trigger if exists trg_sync_sample_milestones_upd on public.po_headers;

create trigger trg_sync_sample_milestones_ins
after insert on public.po_headers
for each row execute procedure public.sync_sample_milestones();

create trigger trg_sync_sample_milestones_upd
after update of sample_target_approval, sample_target_pp, sample_target_top, sample_target_final, is_reorder
on public.po_headers
for each row execute procedure public.sync_sample_milestones();

-- 뷰 (옵션)
create or replace view public.v_sample_milestones as
select
  m.*,
  h.origin_code as po_origin_code,
  h.is_reorder
from public.sample_milestones m
join public.po_headers h on h.id = m.po_id;

-- 스토리지 버킷 + 정책 (샘플 파일 업로드용)
insert into storage.buckets (id, name, public)
select 'sample-files', 'sample-files', true
where not exists (select 1 from storage.buckets where id = 'sample-files');

-- Storage bucket policies (idempotent: only create if not exists)
do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'storage'
      and tablename  = 'objects'
      and policyname = 'Public read sample-files'
  ) then
    create policy "Public read sample-files"
    on storage.objects for select
    using (bucket_id = 'sample-files');
  end if;

  if not exists (
    select 1
    from pg_policies
    where schemaname = 'storage'
      and tablename  = 'objects'
      and policyname = 'Authenticated write sample-files'
  ) then
    create policy "Authenticated write sample-files"
    on storage.objects for insert
    to authenticated
    with check (bucket_id = 'sample-files');
  end if;

  if not exists (
    select 1
    from pg_policies
    where schemaname = 'storage'
      and tablename  = 'objects'
      and policyname = 'Authenticated update sample-files'
  ) then
    create policy "Authenticated update sample-files"
    on storage.objects for update
    to authenticated
    using (bucket_id = 'sample-files')
    with check (bucket_id = 'sample-files');
  end if;
end
$$;

-- RLS (프로토타입용 느슨한 정책: 운영에선 회사별로 강화 권장)
alter table public.po_headers enable row level security;
alter table public.sample_milestones enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where policyname='po_headers_all' and tablename='po_headers') then
    create policy po_headers_all on public.po_headers
    for all to authenticated using (true) with check (true);
  end if;

  if not exists (select 1 from pg_policies where policyname='sample_milestones_all' and tablename='sample_milestones') then
    create policy sample_milestones_all on public.sample_milestones
    for all to authenticated using (true) with check (true);
  end if;
end$$;

