begin;

alter table public.product_development_headers
  add column product_subcategory text,
  add constraint product_development_garment_subcategory_check check (
    product_subcategory is null
    or (
      product_category is not distinct from 'G'
      and product_subcategory in ('HAT_CAP', 'SOCKS', 'T_SHIRT', 'PANTS', 'OTHER')
    )
  );

notify pgrst, 'reload schema';

commit;
