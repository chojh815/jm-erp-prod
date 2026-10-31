begin;
alter table public.sample_requests add column if not exists request_kind text not null default 'SAMPLE';

create table if not exists public.sample_request_topics (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.sample_requests(id),
  title text not null check(length(trim(title)) between 1 and 200),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  unique(request_id, title), unique(request_id, id)
);
create table if not exists public.sample_request_members (
  request_id uuid not null references public.sample_requests(id),
  user_id uuid not null references auth.users(id),
  added_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  primary key(request_id, user_id)
);
create index if not exists sample_request_members_user_idx on public.sample_request_members(user_id, request_id);
create table if not exists public.sample_request_history (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.sample_requests(id),
  topic_id uuid,
  received_date date not null,
  title text not null check(length(trim(title)) between 1 and 200),
  entry_kind text not null check(entry_kind in ('COST','REVISION','BUYER_REQUEST','PROGRESS','OTHER')),
  source text not null check(source in ('EMAIL','WECHAT','INTERNAL','OTHER')),
  sender text not null default '',
  note text not null default '' check(length(note)<=10000),
  visibility text not null default 'TEAM' check(visibility in ('TEAM','MANAGEMENT')),
  files jsonb not null default '[]'::jsonb check(jsonb_typeof(files)='array' and jsonb_array_length(files)<=5),
  search_filenames text not null default '',
  previous_entry_id uuid,
  created_by uuid not null references auth.users(id),
  created_by_name text not null,
  created_by_email text not null,
  created_at timestamptz not null default now(),
  unique(request_id, id),
  foreign key(request_id, topic_id) references public.sample_request_topics(request_id,id),
  foreign key(request_id, previous_entry_id) references public.sample_request_history(request_id,id)
);
create index if not exists sample_request_history_date_idx on public.sample_request_history(request_id, received_date desc, created_at desc, id desc);
create index if not exists sample_request_history_topic_idx on public.sample_request_history(topic_id);

-- APIs enforce session identity, permissions and request membership. Direct clients
-- cannot bypass those checks; Storage access is through short-lived signed tokens.
alter table public.sample_request_topics enable row level security;
alter table public.sample_request_members enable row level security;
alter table public.sample_request_history enable row level security;
revoke all on public.sample_request_topics, public.sample_request_members, public.sample_request_history from anon, authenticated;
grant all on public.sample_request_topics, public.sample_request_members, public.sample_request_history to service_role;

insert into storage.buckets(id,name,public,file_size_limit)
values ('sample-request-history','sample-request-history',false,41943040)
on conflict(id) do update set public=false,file_size_limit=41943040;
drop policy if exists sample_history_no_direct_clients on storage.objects;
create policy sample_history_no_direct_clients on storage.objects as restrictive
  for all to anon, authenticated
  using (bucket_id <> 'sample-request-history')
  with check (bucket_id <> 'sample-request-history');
notify pgrst, 'reload schema';
commit;
