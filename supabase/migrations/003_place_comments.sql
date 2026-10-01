-- Replaces places.memo with a per-place conversation. Existing memos become the first comment.
create table place_comments (
  id uuid primary key default gen_random_uuid(),
  place_id uuid not null references places on delete cascade,
  room_id uuid not null references rooms on delete cascade,
  user_id uuid not null default auth.uid() references auth.users,
  body text not null check (length(trim(body)) > 0),
  created_at timestamptz not null default now()
);
create index on place_comments (place_id, created_at);

alter table place_comments enable row level security;
create policy "members read comments" on place_comments for select using (is_member(room_id));
create policy "members add comments" on place_comments for insert
  with check (is_member(room_id) and user_id = auth.uid());
create policy "authors delete comments" on place_comments for delete using (user_id = auth.uid());

insert into place_comments (place_id, room_id, user_id, body, created_at)
  select id, room_id, added_by, trim(memo), created_at from places where trim(memo) <> '';

alter table places drop column memo;
alter publication supabase_realtime add table place_comments;
