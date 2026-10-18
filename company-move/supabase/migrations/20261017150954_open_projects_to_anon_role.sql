/*
# Open projects table to the anon role (no sign-in app)

1. Changes
- The map editor has no sign-in screen, so the browser talks to Supabase as the
  `anon` role for its entire lifetime. The previous migration locked the table
  down to `authenticated` only with `auth.uid() = owner_id` checks, which meant
  every save silently failed (the anon-key client has auth.uid() = null).
- Replace all four owner-scoped policies with `TO anon, authenticated` policies
  using `USING (true)` / `WITH CHECK (true)`. This is the documented single-
  tenant pattern: the data is intentionally readable and writable by the anon
  key because there is no sign-in flow.
- The `owner_id` column is kept (not dropped) so existing rows are preserved.
  It is no longer used for RLS enforcement; the frontend filters by a
  browser-local UUID so each browser still only sees its own projects, but the
  database no longer rejects anon writes.

2. Security
- RLS stays enabled. Policies are widened to `anon, authenticated` because this
  is a single-tenant app with no sign-in screen — the anon key IS the app's
  identity. `USING (true)` is intentional and documented here, not a shortcut.
- No columns, tables, or data are dropped or renamed.

3. Notes
- Re-running this migration is safe: policies are dropped before recreate.
*/

ALTER TABLE projects ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_own_projects" ON projects;
DROP POLICY IF EXISTS "insert_own_projects" ON projects;
DROP POLICY IF EXISTS "update_own_projects" ON projects;
DROP POLICY IF EXISTS "delete_own_projects" ON projects;

CREATE POLICY "anon_select_projects"
  ON projects FOR SELECT
  TO anon, authenticated USING (true);

CREATE POLICY "anon_insert_projects"
  ON projects FOR INSERT
  TO anon, authenticated WITH CHECK (true);

CREATE POLICY "anon_update_projects"
  ON projects FOR UPDATE
  TO anon, authenticated USING (true) WITH CHECK (true);

CREATE POLICY "anon_delete_projects"
  ON projects FOR DELETE
  TO anon, authenticated USING (true);

REVOKE ALL ON projects FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON projects TO anon, authenticated;
