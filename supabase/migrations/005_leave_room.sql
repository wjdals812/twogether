-- Leaving a room. The last member to leave deletes the room (places and comments cascade).
create function leave_room() returns void
language plpgsql security definer set search_path = public as $$
declare rid uuid;
begin
  if auth.uid() is null then raise exception 'not logged in'; end if;
  select room_id into rid from room_members where user_id = auth.uid();
  if rid is null then return; end if;
  perform 1 from rooms where id = rid for update; -- same lock as join_room, so nobody joins a room that is being deleted
  delete from room_members where room_id = rid and user_id = auth.uid();
  if not exists (select 1 from room_members where room_id = rid) then
    delete from rooms where id = rid;
  end if;
end $$;

revoke execute on function leave_room from public, anon;
grant execute on function leave_room to authenticated;
