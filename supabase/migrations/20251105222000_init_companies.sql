-- 필요한 확장
create extension if not exists "pgcrypto";

-- 공통 updated_at 자동 갱신 트리거 함수
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- =========================
-- 1) companies
-- =========================
create table if not exists public.companies (
  id                     uuid primary key default gen_random_uuid(),
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),

  -- 분류/기본정보
  company_type           text,                 -- 'our','buyer','factory','vendor' 등 자유 텍스트
  company_name           text not null,
  code                   text,                 -- 사내 코드
  is_active              boolean not null default true,

  -- 주소/연락처
  country                text,
  state                  text,
  city                   text,
  zip                    text,
  address1               text,
  address2               text,
  phone                  text,
  email                  text,

  -- 세금/결제/은행
  tax_id                 text,
  currency               text,                 -- 기본 통화 (예: USD, KRW…)
  bank_name              text,
  bank_account           text,
  account_holder_name    text,
  swift                  text,

  -- 바이어 옵션 (바이어 타입일 때 주로 사용)
  buyer_payment_term     text,
  buyer_default_incoterm text,
  buyer_default_ship_mode text,
  ap_contact_name        text,
  ap_email               text,
  ap_phone               text,

  -- 원산지/공장 기본
  origin_mark            text,                 -- “Made in Korea / Vietnam / China …”
  factory_air_port       text,                 -- 예: Hanoi Noi Bai
  factory_sea_port       text,                 -- 예: Hai Phong

  -- 선호 선적/원산지(다중)
  preferred_origins      text[] default '{}',  -- 예: {'KR','VN'}

  -- 메모
  memo                   text
);

-- 변경 시 updated_at 자동 갱신
drop trigger if exists trg_companies_updated_at on public.companies;
create trigger trg_companies_updated_at
before update on public.companies
for each row execute procedure public.set_updated_at();

-- 조회 최적화
create index if not exists idx_companies_name on public.companies using gin (to_tsvector('simple', company_name));
create index if not exists idx_companies_active on public.companies (is_active);

-- =========================
-- 2) company_sites (회사별 선적지/공장/지점)
-- =========================
create table if not exists public.company_sites (
  id                     uuid primary key default gen_random_uuid(),
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),

  company_id             uuid not null references public.companies(id) on delete cascade,

  site_name              text not null,        -- 지점/공장 이름
  is_default             boolean not null default false,

  -- 원산지/선적 관련
  origin_code            text,                 -- 내부 origin code (예: KR_SEOUL / VN_BACNINH …)
  origin_country         text,                 -- 국가명 텍스트

  -- 주소/연락처
  country                text,
  state                  text,
  city                   text,
  zip                    text,
  address1               text,
  address2               text,
  phone                  text,

  -- 세금/수출자
  tax_id                 text,
  exporter_of_record     boolean not null default false,

  -- 은행 (사이트 단위 별도 계좌가 있을 수 있음)
  bank_name              text,
  bank_account           text,
  account_holder_name    text,
  swift                  text
);

-- 변경 시 updated_at 자동 갱신
drop trigger if exists trg_company_sites_updated_at on public.company_sites;
create trigger trg_company_sites_updated_at
before update on public.company_sites
for each row execute procedure public.set_updated_at();

-- 한 회사당 기본지점은 하나만 허용 (is_default = true) - 부분 유니크 인덱스
create unique index if not exists uq_company_sites_default_per_company
  on public.company_sites (company_id)
  where is_default is true;

-- 중복 방지: 동일 회사에서 동일 사이트명 1회만
create unique index if not exists uq_company_sites_name_per_company
  on public.company_sites (company_id, site_name);

-- 조회 최적화
create index if not exists idx_company_sites_company on public.company_sites (company_id);
create index if not exists idx_company_sites_origin on public.company_sites (origin_code);


-- =========================
-- RLS (Row Level Security)
--  - 브라우저 조회: anon/ authenticated 모두 SELECT 허용
--  - 쓰기: authenticated 허용 (service_role은 RLS 우회)
-- =========================

-- companies
alter table public.companies enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'companies' and policyname = 'Allow read to anon'
  ) then
    create policy "Allow read to anon"
      on public.companies for select
      to anon, authenticated
      using (true);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'companies' and policyname = 'Allow write to authenticated'
  ) then
    create policy "Allow write to authenticated"
      on public.companies for all
      to authenticated
      using (true)
      with check (true);
  end if;
end $$;

-- company_sites
alter table public.company_sites enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'company_sites' and policyname = 'Allow read to anon'
  ) then
    create policy "Allow read to anon"
      on public.company_sites for select
      to anon, authenticated
      using (true);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'company_sites' and policyname = 'Allow write to authenticated'
  ) then
    create policy "Allow write to authenticated"
      on public.company_sites for all
      to authenticated
      using (true)
      with check (true);
  end if;
end $$;
