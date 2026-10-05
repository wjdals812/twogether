-- Limits for the AI course function: 10 seconds between calls, 15 per user and 200 for the whole site in a rolling day.
-- Only take_course_call() reads or writes the table, so it has no policies.
create table course_calls (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  created_at timestamptz not null default now()
);
create index on course_calls (user_id, created_at desc);
create index on course_calls (created_at);
alter table course_calls enable row level security;

create function take_course_call() returns text
language plpgsql security definer set search_path = public as $$
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
end $$;

revoke execute on function take_course_call from public, anon;
grant execute on function take_course_call to authenticated;
