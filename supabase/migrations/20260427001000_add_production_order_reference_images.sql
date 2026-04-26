alter table public.production_order_headers
  add column if not exists reference_images jsonb not null default '[]'::jsonb;

do $$
begin
  perform pg_notify('pgrst', 'reload schema');
exception
  when others then
    null;
end;
$$;

