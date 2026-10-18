/*
# Add a canonical project-name key for safe upserts

1. Changes
- Add `name_key`, a stored generated column holding `lower(btrim(name))`.
- Move the per-owner uniqueness rule onto `(owner_id, name_key)` so it can be used
  as an upsert conflict target, while `name` keeps the capitalisation the user typed
  for display.

2. Security
- No policy or grant changes. This closes the identifier-collision problem: two
  names differing only by case or surrounding whitespace now resolve to the same
  row for the same owner instead of shadowing each other.

3. Notes
- Generated columns are computed by the database, so a client cannot submit a
  `name_key` that disagrees with `name`.
*/

ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS name_key text
  GENERATED ALWAYS AS (lower(btrim(name))) STORED;

DROP INDEX IF EXISTS projects_owner_name_canonical_idx;

CREATE UNIQUE INDEX IF NOT EXISTS projects_owner_name_key_idx
  ON projects (owner_id, name_key);
