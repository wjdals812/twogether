-- Full schema. Re-running wipes `places` (dev data only).
drop table if exists course_calls cascade;
drop table if exists room_courses cascade;
drop table if exists place_comments cascade;
drop table if exists places cascade;
drop table if exists room_members cascade;
drop table if exists rooms cascade;
drop function if exists is_member(uuid);
drop function if exists create_room(text);
drop function if exists join_room(text);
drop function if exists leave_room(uuid);
drop function if exists rename_room(uuid, text);
drop function if exists update_place(uuid, jsonb);
drop function if exists take_course_call();

create table rooms (
  id uuid primary key default gen_random_uuid(),
  invite_code text not null unique default upper(substr(md5(random()::text), 1, 6)),
  name text not null default '새 방' check (char_length(trim(name)) between 1 and 20),
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
  rating smallint check (rating between 1 and 5),
  added_by uuid not null default auth.uid() references auth.users,
  created_at timestamptz not null default now(),
  unique (room_id, kakao_id)
);

create table place_comments (
  id uuid primary key default gen_random_uuid(),
  place_id uuid not null references places on delete cascade,
  room_id uuid not null references rooms on delete cascade,
  user_id uuid not null default auth.uid() references auth.users,
  body text not null check (length(trim(body)) > 0),
  created_at timestamptz not null default now()
);
create index on place_comments (place_id, created_at);

create table room_courses (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references rooms on delete cascade,
  summary text not null default '' check (char_length(summary) <= 500),
  stops jsonb not null check (jsonb_typeof(stops) = 'array' and jsonb_array_length(stops) between 1 and 10),
  created_by uuid not null default auth.uid() references auth.users,
  created_at timestamptz not null default now()
);
create index on room_courses (room_id, created_at desc);

create table course_calls (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  created_at timestamptz not null default now()
);
create index on course_calls (user_id, created_at desc);
create index on course_calls (created_at);

-- security definer avoids RLS recursion when policies check membership
create function is_member(rid uuid) returns boolean
language sql security definer set search_path = public stable as $$
  select exists (select 1 from room_members where room_id = rid and user_id = auth.uid())
$$;

alter table rooms enable row level security;
alter table room_members enable row level security;
alter table places enable row level security;
alter table place_comments enable row level security;
alter table room_courses enable row level security;
alter table course_calls enable row level security; -- no policies: only take_course_call() touches it

create policy "members read room" on rooms for select using (is_member(id));
create policy "members read members" on room_members for select using (is_member(room_id));
create policy "members manage places" on places for all
  using (is_member(room_id)) with check (is_member(room_id));
create policy "members read comments" on place_comments for select using (is_member(room_id));
create policy "members add comments" on place_comments for insert
  with check (is_member(room_id) and user_id = auth.uid());
create policy "authors delete comments" on place_comments for delete using (user_id = auth.uid());
create policy "members read courses" on room_courses for select using (is_member(room_id));
create policy "members add courses" on room_courses for insert
  with check (is_member(room_id) and created_by = auth.uid());
create policy "members delete courses" on room_courses for delete using (is_member(room_id));
-- no insert policies on rooms/room_members: only the functions below can write them

create function create_room(room_name text default '새 방') returns rooms
language plpgsql security definer set search_path = public as $$
declare r rooms;
begin
  if auth.uid() is null then raise exception 'not logged in'; end if;
  insert into rooms (name) values (trim(room_name)) returning * into r;
  insert into room_members (room_id, user_id) values (r.id, auth.uid());
  return r;
end $$;

create function join_room(code text) returns rooms
language plpgsql security definer set search_path = public as $$
declare r rooms;
begin
  if auth.uid() is null then raise exception 'not logged in'; end if;
  select * into r from rooms where invite_code = upper(trim(code)) for update; -- lock: serialize concurrent joins
  if not found then raise exception 'invalid invite code'; end if;
  if exists (select 1 from room_members where room_id = r.id and user_id = auth.uid()) then
    raise exception 'already in this room';
  end if;
  if (select count(*) from room_members where room_id = r.id) >= 4 then
    raise exception 'room is full';
  end if;
  insert into room_members (room_id, user_id) values (r.id, auth.uid());
  return r;
end $$;

create function leave_room(rid uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not logged in'; end if;
  if not exists (select 1 from room_members where room_id = rid and user_id = auth.uid()) then return; end if;
  perform 1 from rooms where id = rid for update; -- same lock as join_room, so nobody joins a room that is being deleted
  delete from room_members where room_id = rid and user_id = auth.uid();
  if not exists (select 1 from room_members where room_id = rid) then
    delete from rooms where id = rid;
  end if;
end $$;

create function rename_room(rid uuid, new_name text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_member(rid) then raise exception 'not a member'; end if;
  update rooms set name = trim(new_name) where id = rid;
end $$;

revoke execute on function create_room, join_room, leave_room, rename_room from public, anon;
grant execute on function create_room, join_room, leave_room, rename_room to authenticated;

-- Limits for the AI course function: 10 seconds between calls, 15 per user and 200 for the whole site in a rolling day.
create function take_course_call() returns text
language plpgsql security definer set search_path = public as $
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'not logged in'; end if;
  perform pg_advisory_xact_lock(hashtext('course_calls')); -- one caller at a time, so parallel requests cannot slip past a limit
  delete from course_calls where created_at < now() - interval '2 days';
  if exists (select 1 from course_calls where user_id = uid and created_at > now() - interval '10 seconds') then
    return 'too_fast';
  end if;
  if (select count(*) from course_calls where user_id = uid and created_at > now() - interval '1 day') >= 15 then
    return 'user_limit';
  end if;
  if (select count(*) from course_calls where created_at > now() - interval '1 day') >= 200 then
    return 'site_limit';
  end if;
  insert into course_calls (user_id) values (uid);
  return 'ok';
end $;

revoke execute on function take_course_call from public, anon;
grant execute on function take_course_call to authenticated;

-- POST-based fallback for browsers/networks that block PATCH. security invoker: RLS still applies.
create function update_place(pid uuid, fields jsonb) returns void
language sql security invoker set search_path = public as $$
  update places set
    status = coalesce(fields->>'status', status),
    rating = case when fields ? 'rating' then (fields->>'rating')::smallint else rating end
  where id = pid
$$;

revoke execute on function update_place from public, anon;
grant execute on function update_place to authenticated;

alter publication supabase_realtime add table places;
alter publication supabase_realtime add table place_comments;
