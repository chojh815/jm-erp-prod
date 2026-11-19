begin;

create index if not exists idx_batch_v4_po_sku_lookup
  on public.production_batches_v4 (upper(btrim(po_no)),sku_code,vendor_initial);
create index if not exists idx_batch_legacy_po_lookup
  on public.production_batches (upper(btrim(po_no))) where buyer_code='RED';

-- These service-only views filter before pagination. Shipment status semantics
-- match the existing PO list, including confirmed shipments and Cancel Qty.
create or replace view public.v_red_batch_po_lines as
with red_orders as (
  select h.id,h.po_no,h.shipping_origin_code,h.origin_code
  from public.po_headers h join public.companies c on c.id=h.buyer_id
  where c.company_type='buyer' and upper(btrim(c.code)) in ('RBK','RED')
    and h.is_deleted is not true
    and upper(btrim(coalesce(h.status,''))) not in ('CANCELLED','CANCELED','DELETED','VOID')
), quantities as (
  select l.*,p.po_no,
    upper(coalesce(nullif(btrim(l.upc),''),nullif(btrim(l.buyer_style_no),''),nullif(btrim(l.buyer_style_code),''),'')) as sku_code,
    case when upper(btrim(p.shipping_origin_code)) in ('CN','CHINA','CN_QINGDAO','CN_JIAOZHOU') then 'Q'
         when upper(btrim(p.shipping_origin_code)) in ('VN','VIETNAM','VN_BACNINH') then 'J'
         when upper(btrim(p.origin_code)) in ('CN','CHINA','CN_QINGDAO','CN_JIAOZHOU') then 'Q'
         when upper(btrim(p.origin_code)) in ('VN','VIETNAM','VN_BACNINH') then 'J' end as expected_vendor
  from public.po_lines l join red_orders p on p.id=l.po_header_id
  where l.is_deleted is not true
), shipped as (
  select sl.po_line_id,sum(greatest(0,coalesce(sl.shipped_qty,0))) as shipped_qty
  from public.shipment_lines sl
  join public.shipments s on s.id=sl.shipment_id
  join quantities l on l.id=sl.po_line_id
  where sl.is_deleted is not true and s.is_deleted is not true
    and upper(btrim(coalesce(s.status,''))) in ('SHIPPED','CONFIRMED','CLOSED','DELIVERED','INVOICED')
  group by sl.po_line_id
)
select l.id,l.po_header_id,l.line_no,l.buyer_style_no,l.buyer_style_code,l.upc,l.color,l.size,l.description,l.is_deleted,l.sku_code,
  greatest(0,coalesce(l.qty,0)) as order_qty,
  greatest(0,coalesce(l.qty_cancelled,0)) as cancelled_qty,
  coalesce(s.shipped_qty,0) as shipped_qty,
  greatest(0,greatest(0,coalesce(l.qty,0))-greatest(0,coalesce(l.qty_cancelled,0))-coalesce(s.shipped_qty,0)) as pending_qty,
  exists(select 1 from public.production_batches_v4 b where b.buyer_code='RED'
    and upper(btrim(b.po_no))=upper(btrim(l.po_no)) and b.sku_code=l.sku_code
    and (l.expected_vendor is null or b.vendor_initial=l.expected_vendor)) as has_batch
from quantities l left join shipped s on s.po_line_id=l.id;

create or replace view public.v_red_batch_po_options as
select h.id,h.po_no,h.buyer_id,h.buyer_name,h.status,h.is_deleted,h.shipping_origin_code,h.origin_code,h.created_at,
  coalesce(sum(l.pending_qty),0) as pending_qty,
  count(l.id) filter(where l.pending_qty>0) as pending_line_count,
  count(l.id) filter(where l.pending_qty>0 and not l.has_batch) as unbatched_pending_line_count,
  exists(select 1 from public.production_batches b where b.buyer_code='RED' and upper(btrim(b.po_no))=upper(btrim(h.po_no))) as has_legacy_batch
from public.po_headers h join public.companies c on c.id=h.buyer_id
left join public.v_red_batch_po_lines l on l.po_header_id=h.id
where c.company_type='buyer' and upper(btrim(c.code)) in ('RBK','RED')
  and h.is_deleted is not true
  and upper(btrim(coalesce(h.status,''))) not in ('CANCELLED','CANCELED','DELETED','VOID')
group by h.id,h.po_no,h.buyer_id,h.buyer_name,h.status,h.is_deleted,h.shipping_origin_code,h.origin_code,h.created_at;

revoke all on public.v_red_batch_po_lines,public.v_red_batch_po_options from public,anon,authenticated;
grant select on public.v_red_batch_po_lines,public.v_red_batch_po_options to service_role;
notify pgrst,'reload schema';
commit;
