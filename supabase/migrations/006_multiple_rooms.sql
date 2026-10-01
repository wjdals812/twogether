-- A user can belong to several rooms; rooms get a name. Existing rooms are named 우리.
alter table rooms add column name text not null default '우리'
  check (char_length(trim(name)) between 1 and 20);

drop function create_room();
create function create_room(room_name text default '새 방') returns rooms
language plpgsql security definer set search_path = public as $$
declare r rooms;
begin
  if auth.uid() is null then raise exception 'not logged in'; end if;
  insert into rooms (name) values (trim(room_name)) returning * into r;
  insert into room_members (room_id, user_id) values (r.id, auth.uid());
  return r;
end $$;

create or replace function join_room(code text) returns rooms
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

drop function leave_room();
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

revoke execute on function create_room, leave_room, rename_room from public, anon;
grant execute on function create_room, leave_room, rename_room to authenticated;
