-- Remote message bubble MVP for the desktop pet.
-- Run this in the Supabase SQL Editor.
--
-- Security model:
-- - Public clients can call send_pet_message(pair_code, content, sender_name).
-- - sender_name is kept for RPC compatibility but the template stores and broadcasts it as "TA".
-- - Public clients cannot directly read or write pet_pairs or pet_messages.
-- - The receiver subscribes to a private Broadcast topic stored only on your PC.
-- - Never put service_role, database passwords, or Postgres URLs in clients.

create extension if not exists pgcrypto with schema extensions;

create table if not exists public.pet_pairs (
  id uuid primary key default gen_random_uuid(),
  pair_code_hash text not null unique,
  realtime_topic text not null unique,
  display_name text,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  constraint pet_pairs_realtime_topic_length check (char_length(realtime_topic) >= 16)
);

create table if not exists public.pet_messages (
  id bigint generated always as identity primary key,
  pair_id uuid not null references public.pet_pairs(id) on delete cascade,
  sender_name text not null default 'TA',
  content text not null,
  created_at timestamptz not null default now(),
  constraint pet_messages_content_length check (
    char_length(btrim(content)) between 1 and 200
  )
);

alter table public.pet_messages
drop constraint if exists pet_messages_content_length;

alter table public.pet_messages
add constraint pet_messages_content_length check (
  char_length(btrim(content)) between 1 and 200
);

alter table public.pet_pairs enable row level security;
alter table public.pet_messages enable row level security;

revoke all on public.pet_pairs from anon, authenticated;
revoke all on public.pet_messages from anon, authenticated;

create or replace function public.hash_pet_pair_code(pair_code text)
returns text
language sql
immutable
strict
set search_path = public, pg_temp
as $$
  select encode(extensions.digest(pair_code::text, 'sha256'::text), 'hex');
$$;

create or replace function public.is_enabled_pet_realtime_topic(channel_topic text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.pet_pairs
    where enabled = true
      and ('pet:' || realtime_topic) = channel_topic
  );
$$;

create or replace function public.send_pet_message(
  pair_code text,
  content text,
  sender_name text default 'TA'
)
returns table (
  message_id bigint,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = public, realtime, pg_temp
as $$
declare
  matched_pair public.pet_pairs%rowtype;
  clean_content text := btrim(coalesce($2, ''));
  clean_sender_name text := 'TA';
  recent_message_count integer;
  new_message_id bigint;
  new_created_at timestamptz;
begin
  if char_length(coalesce($1, '')) < 4 then
    raise exception 'invalid pair code';
  end if;

  if char_length(clean_content) = 0 then
    raise exception 'message content is required';
  end if;

  if char_length(clean_content) > 200 then
    raise exception 'message content is too long';
  end if;

  select *
  into matched_pair
  from public.pet_pairs as p
  where p.pair_code_hash = encode(extensions.digest($1::text, 'sha256'::text), 'hex')
    and p.enabled = true
  limit 1;

  if not found then
    raise exception 'invalid pair code';
  end if;

  select count(*)
  into recent_message_count
  from public.pet_messages as m
  where m.pair_id = matched_pair.id
    and m.created_at > now() - interval '1 minute';

  if recent_message_count >= 10 then
    raise exception 'too many messages, please wait a minute';
  end if;

  insert into public.pet_messages as inserted_message (pair_id, sender_name, content)
  values (matched_pair.id, clean_sender_name, clean_content)
  returning inserted_message.id, inserted_message.created_at
  into new_message_id, new_created_at;

  perform realtime.send(
    jsonb_build_object(
      'id', new_message_id,
      'content', clean_content,
      'senderName', clean_sender_name,
      'createdAt', new_created_at
    ),
    'pet_message',
    'pet:' || matched_pair.realtime_topic,
    true
  );

  return query select new_message_id, new_created_at;
end;
$$;

create or replace function public.get_recent_pet_messages(
  realtime_topic_input text
)
returns table (
  id bigint,
  content text,
  sender_name text,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    messages.id,
    messages.content,
    messages.sender_name,
    messages.created_at
  from public.pet_messages as messages
  join public.pet_pairs as pairs
    on pairs.id = messages.pair_id
  where pairs.enabled = true
    and pairs.realtime_topic = regexp_replace(
      btrim(coalesce(realtime_topic_input, '')),
      '^pet:',
      ''
    )
    and messages.created_at >= now() - interval '5 days'
  order by messages.created_at desc
  limit 50;
$$;

revoke all on function public.hash_pet_pair_code(text) from public;
revoke all on function public.is_enabled_pet_realtime_topic(text) from public;
revoke all on function public.send_pet_message(text, text, text) from public;
revoke all on function public.get_recent_pet_messages(text) from public;

grant usage on schema public to anon, authenticated;
grant execute on function public.is_enabled_pet_realtime_topic(text) to authenticated;
grant execute on function public.send_pet_message(text, text, text) to anon, authenticated;
grant execute on function public.get_recent_pet_messages(text) to authenticated;

alter table realtime.messages enable row level security;

drop policy if exists "pet receiver can receive private broadcasts" on realtime.messages;

create policy "pet receiver can receive private broadcasts"
on realtime.messages
for select
to authenticated
using (
  realtime.messages.extension = 'broadcast'
  and public.is_enabled_pet_realtime_topic((select realtime.topic()))
);

-- Pair setup example:
-- 1. Generate a pair code locally, for example 7K2m.
--    It must be at least 4 characters. Do not use weak codes such as
--    5200, 1234, birthdays, anniversaries, or other guessable values.
-- 2. Do not commit or publish the pair code.
-- 3. Run the insert below after replacing YOUR_STRONG_PAIR_CODE.
--
-- insert into public.pet_pairs (pair_code_hash, realtime_topic, display_name)
-- values (
--   public.hash_pet_pair_code('YOUR_STRONG_PAIR_CODE'),
--   encode(extensions.gen_random_bytes(16), 'hex'),
--   'desktop-pet'
-- )
-- returning id, realtime_topic;
--
-- Put the returned realtime_topic only in your local AppData config file.
