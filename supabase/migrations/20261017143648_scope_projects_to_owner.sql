/*
# Scope saved projects to their owner

1. Changes
- Add `owner_id` (uuid) to `projects`, defaulting to `auth.uid()`, referencing the
  authenticated caller that created the row.
- Replace the global `name` primary key with a per-owner uniqueness rule so two
  different owners may each have a project called e.g. "Nyár".
- Enforce a canonical project name per owner via a unique index on
  `lower(btrim(name))`, so names differing only by case or padding collide at the
  database rather than silently shadowing one another.

2. Security
- All four `USING (true)` policies are replaced with owner-scoped policies granted
  only `TO authenticated`. The `anon` role loses its table privileges entirely, so
  an unauthenticated caller holding the public anon key can no longer read,
  overwrite or delete other people's maps.
- The UPDATE policy repeats the ownership test in `WITH CHECK` so a row cannot be
  reassigned to another owner.

3. Notes
- No rows, columns or tables are dropped. Pre-existing rows have a NULL `owner_id`
  and are therefore no longer served to clients; they remain in the table.
*/

ALTER TABLE projects ADD COLUMN IF NOT EXISTS owner_id uuid DEFAULT auth.uid();

-- Per-owner identity replaces the global name key. Dropping this constraint
-- removes no data; the replacement index below is strictly narrower per owner.
ALTER TABLE projects DROP CONSTRAINT IF EXISTS projects_pkey;

CREATE UNIQUE INDEX IF NOT EXISTS projects_owner_name_canonical_idx
  ON projects (owner_id, lower(btrim(name)));

CREATE INDEX IF NOT EXISTS projects_owner_id_idx ON projects (owner_id);

ALTER TABLE projects ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_select_projects" ON projects;
DROP POLICY IF EXISTS "anon_insert_projects" ON projects;
DROP POLICY IF EXISTS "anon_update_projects" ON projects;
DROP POLICY IF EXISTS "anon_delete_projects" ON projects;

CREATE POLICY "select_own_projects"
  ON projects FOR SELECT
  TO authenticated
  USING (auth.uid() = owner_id);

CREATE POLICY "insert_own_projects"
  ON projects FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = owner_id);

CREATE POLICY "update_own_projects"
  ON projects FOR UPDATE
  TO authenticated
  USING (auth.uid() = owner_id)
  WITH CHECK (auth.uid() = owner_id);

CREATE POLICY "delete_own_projects"
  ON projects FOR DELETE
  TO authenticated
  USING (auth.uid() = owner_id);

REVOKE ALL ON projects FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON projects TO authenticated;
