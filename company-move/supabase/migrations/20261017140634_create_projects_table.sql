/*
# Create projects table for the map editor

1. New Tables
- `projects`
  - `name` (text, primary key) — the user-given project name (or "__auto" for autosave)
  - `data` (jsonb, not null) — the full MapState snapshot including items, zones, notes, image, etc.
  - `auto` (boolean, default false) — whether this is an autosave row
  - `t` (bigint, not null) — epoch milliseconds timestamp for sorting
  - `created_at` (timestamptz, default now()) — server-side creation timestamp

2. Security
- Enable RLS on `projects`.
- Allow anon + authenticated full CRUD because this is a single-tenant app with no sign-in.
- USING (true) / WITH CHECK (true) is intentional: all data is shared/public.

3. Notes
- The `name` column serves as the natural primary key (project names are unique).
- The `__auto` row is a reserved name used for autosave.
- The `data` jsonb column stores the complete project snapshot as a single JSON object.
*/

CREATE TABLE IF NOT EXISTS projects (
  name text PRIMARY KEY,
  data jsonb NOT NULL,
  auto boolean NOT NULL DEFAULT false,
  t bigint NOT NULL,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE projects ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_select_projects" ON projects;
CREATE POLICY "anon_select_projects"
ON projects FOR SELECT
TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "anon_insert_projects" ON projects;
CREATE POLICY "anon_insert_projects"
ON projects FOR INSERT
TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "anon_update_projects" ON projects;
CREATE POLICY "anon_update_projects"
ON projects FOR UPDATE
TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "anon_delete_projects" ON projects;
CREATE POLICY "anon_delete_projects"
ON projects FOR DELETE
TO anon, authenticated USING (true);
