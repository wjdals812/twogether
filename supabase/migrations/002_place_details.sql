-- Adds status/memo/rating to places. Existing rows become 'want'.
alter table places
  add column status text not null default 'want' check (status in ('want', 'visited')),
  add column memo text not null default '',
  add column rating smallint check (rating between 1 and 5);
