-- Full schema. Re-running wipes `places` (dev data only).
drop table if exists places cascade;
drop table if exists room_members cascade;
drop table if exists rooms cascade;

create table rooms (
  id uuid primary key default gen_random_uuid(),
  invite_code text not null unique default upper(substr(md5(random()::text), 1, 6)),
  created_at timestamptz not null default now()
);

create table room_members (
  room_id uuid not null references rooms on delete cascade,
  user_id uuid not null references auth.users on delete cascade,
  primary key (room_id, user_id)
);

create table places (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references rooms on delete cascade,
  kakao_id text not null,
  name text not null,
  address text not null,
  lat double precision not null,
  lng double precision not null,
  status text not null default 'want' check (status in ('want', 'visited')),
  memo text not null default '',
  rating smallint check (rating between 1 and 5),
  added_by uuid not null default auth.uid() references auth.users,
  created_at timestamptz not null default now(),
  unique (room_id, kakao_id)
);

-- security definer avoids RLS recursion when policies check membership
create function is_member(rid uuid) returns boolean
language sql security definer set search_path = public stable as $$
  select exists (select 1 from room_members where room_id = rid and user_id = auth.uid())
$$;

alter table rooms enable row level security;
alter table room_members enable row level security;
alter table places enable row level security;

create policy "members read room" on rooms for select using (is_member(id));
create policy "members read members" on room_members for select using (is_member(room_id));
create policy "members manage places" on places for all
  using (is_member(room_id)) with check (is_member(room_id));
-- no insert policies on rooms/room_members: only the functions below can write them

create function create_room() returns rooms
language plpgsql security definer set search_path = public as $$
declare r rooms;
begin
  if auth.uid() is null then raise exception 'not logged in'; end if;
  if exists (select 1 from room_members where user_id = auth.uid()) then
    raise exception 'already in a room';
  end if;
  insert into rooms default values returning * into r;
  insert into room_members (room_id, user_id) values (r.id, auth.uid());
  return r;
end $$;

create function join_room(code text) returns rooms
language plpgsql security definer set search_path = public as $$
declare r rooms;
begin
  if auth.uid() is null then raise exception 'not logged in'; end if;
  if exists (select 1 from room_members where user_id = auth.uid()) then
    raise exception 'already in a room';
  end if;
  select * into r from rooms where invite_code = upper(trim(code)) for update; -- lock: serialize concurrent joins
  if not found then raise exception 'invalid invite code'; end if;
  if (select count(*) from room_members where room_id = r.id) >= 4 then
    raise exception 'room is full';
  end if;
  insert into room_members (room_id, user_id) values (r.id, auth.uid());
  return r;
end $$;

revoke execute on function create_room, join_room from public, anon;
grant execute on function create_room, join_room to authenticated;

alter publication supabase_realtime add table places;
