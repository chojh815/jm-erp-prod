create table if not exists public.subcontract_payables (
  id uuid primary key default gen_random_uuid(),
  work_sheet_id uuid references public.work_sheet_headers(id),
  vendor_id uuid references public.companies(id),
  po_no text,
  work_sheet_no text,
  vendor_name text,
  receipt_date date not null,
  received_qty numeric(18, 2) not null default 0,
  currency text not null default 'CNY',
  unit_cost numeric(18, 4) not null default 0,
  gross_amount numeric(18, 2) generated always as (round(received_qty * unit_cost, 2)) stored,
  claim_deduction_amount numeric(18, 2) not null default 0,
  other_deduction_amount numeric(18, 2) not null default 0,
  total_amount numeric(18, 2) generated always as (
    greatest(round(received_qty * unit_cost, 2) - claim_deduction_amount - other_deduction_amount, 0)
  ) stored,
  payment_terms_days integer not null default 60,
  due_date date not null,
  status text not null default 'OPEN' check (status in ('OPEN', 'PARTIAL', 'PAID', 'VOID')),
  paid_amount numeric(18, 2) not null default 0,
  paid_date date,
  note text,
  is_deleted boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_subcontract_payables_due_date
  on public.subcontract_payables (due_date);

create index if not exists idx_subcontract_payables_vendor
  on public.subcontract_payables (vendor_id);

create index if not exists idx_subcontract_payables_work_sheet
  on public.subcontract_payables (work_sheet_id);

create or replace function public.enforce_subcontract_payable_qty_limit()
returns trigger
language plpgsql
as $$
declare
  v_order_qty numeric(18, 2);
  v_received_qty numeric(18, 2);
begin
  if new.work_sheet_id is null or new.is_deleted = true or new.status = 'VOID' then
    return new;
  end if;

  select coalesce(sum(coalesce(qty, 0)), 0)
    into v_order_qty
    from public.work_sheet_lines
   where work_sheet_id = new.work_sheet_id
     and coalesce(is_deleted, false) = false;

  if v_order_qty > 0 then
    select coalesce(sum(coalesce(received_qty, 0)), 0)
      into v_received_qty
      from public.subcontract_payables
     where work_sheet_id = new.work_sheet_id
       and id <> new.id
       and is_deleted = false
       and status <> 'VOID';

    if v_received_qty + coalesce(new.received_qty, 0) > v_order_qty then
      raise exception 'Received qty exceeds work sheet qty. Order qty %, already received %, this receipt %.',
        v_order_qty, v_received_qty, coalesce(new.received_qty, 0)
        using errcode = '23514';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_enforce_subcontract_payable_qty_limit
  on public.subcontract_payables;

create trigger trg_enforce_subcontract_payable_qty_limit
before insert or update of work_sheet_id, received_qty, status, is_deleted
on public.subcontract_payables
for each row
execute function public.enforce_subcontract_payable_qty_limit();
