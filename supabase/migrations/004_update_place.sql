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
