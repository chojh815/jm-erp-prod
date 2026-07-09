-- Preserve discounted PO unit prices entered with three decimal places.
-- The existing po_lines.unit_price column is referenced by database views, so
-- store the precise value in a separate column without disturbing those views.

alter table if exists public.po_lines
  add column if not exists unit_price_precise numeric(18, 6);

update public.po_lines
set
  unit_price_precise = round((amount / nullif(qty, 0))::numeric, 6),
  updated_at = now()
where
  is_deleted = false
  and qty is not null
  and qty <> 0
  and amount is not null
  and (
    unit_price_precise is null
    or abs(round((amount / nullif(qty, 0))::numeric, 6) - unit_price_precise) > 0.000001
  );
