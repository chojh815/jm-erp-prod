-- ======== COMPANIES 확장 ========
do $$
begin
  -- 기본 필드
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='companies' and column_name='name')
  then alter table public.companies add column name text; end if;

  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='companies' and column_name='code')
  then alter table public.companies add column code text; end if;

  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='companies' and column_name='country')
  then alter table public.companies add column country text; end if;

  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='companies' and column_name='currency')
  then alter table public.companies add column currency text; end if;

  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='companies' and column_name='phone')
  then alter table public.companies add column phone text; end if;

  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='companies' and column_name='email')
  then alter table public.companies add column email text; end if;

  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='companies' and column_name='address')
  then alter table public.companies add column address text; end if;

  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='companies' and column_name='note')
  then alter table public.companies add column note text; end if;

  -- 거래/정산/물류 관련
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='companies' and column_name='tax_id')
  then alter table public.companies add column tax_id text; end if;

  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='companies' and column_name='bank_name')
  then alter table public.companies add column bank_name text; end if;

  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='companies' and column_name='bank_account')
  then alter table public.companies add column bank_account text; end if;

  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='companies' and column_name='account_holder_name')
  then alter table public.companies add column account_holder_name text; end if;

  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='companies' and column_name='swift')
  then alter table public.companies add column swift text; end if;

  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='companies' and column_name='buyer_payment_term')
  then alter table public.companies add column buyer_payment_term text; end if;

  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='companies' and column_name='buyer_default_incoterm')
  then alter table public.companies add column buyer_default_incoterm text; end if;

  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='companies' and column_name='buyer_default_ship_mode')
  then alter table public.companies add column buyer_default_ship_mode text; end if;

  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='companies' and column_name='ap_contact_name')
  then alter table public.companies add column ap_contact_name text; end if;

  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='companies' and column_name='ap_email')
  then alter table public.companies add column ap_email text; end if;

  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='companies' and column_name='ap_phone')
  then alter table public.companies add column ap_phone text; end if;

  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='companies' and column_name='origin_mark')
  then alter table public.companies add column origin_mark text; end if;

  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='companies' and column_name='factory_air_port')
  then alter table public.companies add column factory_air_port text; end if;

  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='companies' and column_name='factory_sea_port')
  then alter table public.companies add column factory_sea_port text; end if;

  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='companies' and column_name='preferred_origins')
  then alter table public.companies add column preferred_origins text[] default '{}'; end if;

  -- 필수 기본(이미 있더라도 보강)
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='companies' and column_name='is_active')
  then alter table public.companies add column is_active boolean not null default true; end if;
end$$;

-- code 유니크(널 허용) 인덱스
create index if not exists companies_code_idx on public.companies(code);
create unique index if not exists companies_code_unique_notnull on public.companies(code) where code is not null;

-- name/company_name 동기화 트리거
create or replace function public.sync_company_name()
returns trigger language plpgsql as $$
begin
  if new.company_name is null then
    new.company_name := new.name;
  end if;
  if new.name is null then
    new.name := new.company_name;
  end if;
  return new;
end $$;

drop trigger if exists trg_sync_company_name on public.companies;
create trigger trg_sync_company_name
before insert or update on public.companies
for each row execute function public.sync_company_name();

-- ======== COMPANY_SITES 확장 ========
do $$
begin
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='company_sites' and column_name='company_id')
  then alter table public.company_sites add column company_id uuid; end if;

  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='company_sites' and column_name='site_type')
  then alter table public.company_sites add column site_type text; end if;

  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='company_sites' and column_name='name')
  then alter table public.company_sites add column name text; end if;

  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='company_sites' and column_name='origin_code')
  then alter table public.company_sites add column origin_code text; end if;

  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='company_sites' and column_name='origin_country')
  then alter table public.company_sites add column origin_country text; end if;

  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='company_sites' and column_name='country')
  then alter table public.company_sites add column country text; end if;

  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='company_sites' and column_name='city')
  then alter table public.company_sites add column city text; end if;

  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='company_sites' and column_name='address')
  then alter table public.company_sites add column address text; end if;

  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='company_sites' and column_name='phone')
  then alter table public.company_sites add column phone text; end if;

  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='company_sites' and column_name='email')
  then alter table public.company_sites add column email text; end if;

  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='company_sites' and column_name='tax_id')
  then alter table public.company_sites add column tax_id text; end if;

  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='company_sites' and column_name='exporter_of_record')
  then alter table public.company_sites add column exporter_of_record boolean default false; end if;

  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='company_sites' and column_name='bank_name')
  then alter table public.company_sites add column bank_name text; end if;

  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='company_sites' and column_name='bank_account')
  then alter table public.company_sites add column bank_account text; end if;

  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='company_sites' and column_name='account_holder_name')
  then alter table public.company_sites add column account_holder_name text; end if;

  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='company_sites' and column_name='swift')
  then alter table public.company_sites add column swift text; end if;

  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='company_sites' and column_name='is_default')
  then alter table public.company_sites add column is_default boolean default false; end if;

  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='company_sites' and column_name='created_at')
  then alter table public.company_sites add column created_at timestamptz default now(); end if;

  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='company_sites' and column_name='updated_at')
  then alter table public.company_sites add column updated_at timestamptz default now(); end if;
end$$;

-- FK 보장
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.company_sites'::regclass
      and contype = 'f'
      and conname = 'company_sites_company_id_fkey'
  )
  then
    alter table public.company_sites
      add constraint company_sites_company_id_fkey
      foreign key (company_id) references public.companies(id) on delete cascade;
  end if;
end$$;

-- updated_at 트리거 (양쪽 테이블)
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

do $$
begin
  if not exists (select 1 from pg_trigger where tgname='trg_companies_updated')
  then create trigger trg_companies_updated before update on public.companies
       for each row execute function public.set_updated_at(); end if;

  if not exists (select 1 from pg_trigger where tgname='trg_company_sites_updated')
  then create trigger trg_company_sites_updated before update on public.company_sites
       for each row execute function public.set_updated_at(); end if;
end$$;

-- PostgREST 스키마 캐시 리로드
select pg_notify('pgrst', 'reload schema');
