create table if not exists public.production_order_headers (
  id uuid primary key default gen_random_uuid(),
  order_no text not null unique,
  order_date date not null default current_date,
  vendor_id uuid references public.companies(id),
  vendor_name text not null,
  supplier_contact text,
  delivery_date date,
  buyer_po_ref text,
  work_sheet_ref text,
  payment_terms text,
  delivery_address text,
  currency text not null default 'CNY',
  material_supplied_by_jm boolean not null default false,
  special_instructions text,
  notes text,
  prepared_by text,
  approved_by text,
  supplier_confirmation text,
  status text not null default 'DRAFT' check (status in ('DRAFT', 'CONFIRMED', 'CANCELLED')),
  subtotal_amount numeric(18,2) not null default 0,
  is_deleted boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.production_order_lines (
  id uuid primary key default gen_random_uuid(),
  header_id uuid not null references public.production_order_headers(id) on delete cascade,
  line_no integer not null default 1,
  process_type text not null,
  description text,
  qty numeric(18,2) not null default 0,
  unit text,
  unit_price numeric(18,4) not null default 0,
  amount numeric(18,2) generated always as (round(qty * unit_price, 2)) stored,
  remarks text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_production_order_headers_order_date
  on public.production_order_headers (order_date desc);

create index if not exists idx_production_order_headers_vendor
  on public.production_order_headers (vendor_id);

create index if not exists idx_production_order_headers_status
  on public.production_order_headers (status);

create index if not exists idx_production_order_lines_header
  on public.production_order_lines (header_id, line_no);

do $$
begin
  perform pg_notify('pgrst', 'reload schema');
exception
  when others then
    null;
end;
$$;

