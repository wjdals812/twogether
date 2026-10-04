-- Courses saved from the AI course dialog, shared by every member of the room (a snapshot: names, addresses, notes, walking distances).
create table room_courses (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references rooms on delete cascade,
  summary text not null default '' check (char_length(summary) <= 500),
  stops jsonb not null check (jsonb_typeof(stops) = 'array' and jsonb_array_length(stops) between 1 and 10),
  created_by uuid not null default auth.uid() references auth.users,
  created_at timestamptz not null default now()
);
create index on room_courses (room_id, created_at desc);

alter table room_courses enable row level security;
create policy "members read courses" on room_courses for select using (is_member(room_id));
create policy "members add courses" on room_courses for insert
  with check (is_member(room_id) and created_by = auth.uid());
create policy "members delete courses" on room_courses for delete using (is_member(room_id));
