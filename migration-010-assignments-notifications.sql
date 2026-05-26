-- migration-010-assignments-notifications.sql
-- Run in Supabase SQL Editor → New query → paste → Run

-- 1. Per-property department assignments (stored in the properties row)
ALTER TABLE properties
  ADD COLUMN IF NOT EXISTS department_assignments JSONB DEFAULT '{}'::jsonb;

-- 2. Global department defaults (one row per department)
CREATE TABLE IF NOT EXISTS department_defaults (
  department  TEXT PRIMARY KEY,
  user_name   TEXT NOT NULL DEFAULT '',
  user_email  TEXT NOT NULL DEFAULT '',
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE department_defaults ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Authenticated full access dept defaults" ON department_defaults;
CREATE POLICY "Authenticated full access dept defaults"
  ON department_defaults FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

-- Seed one row per department so upserts work cleanly
INSERT INTO department_defaults (department) VALUES
  ('cleaning'), ('maintenance'), ('inspections'), ('operations'), ('compliance'), ('keys')
ON CONFLICT (department) DO NOTHING;

-- 3. In-app notifications (visible to all authenticated users)
CREATE TABLE IF NOT EXISTS notifications (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  type        TEXT NOT NULL,          -- 'task_assigned' | 'task_updated'
  title       TEXT NOT NULL,
  body        TEXT NOT NULL DEFAULT '',
  job_id      UUID,                   -- optional reference
  property_id TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Authenticated full access notifications" ON notifications;
CREATE POLICY "Authenticated full access notifications"
  ON notifications FOR ALL TO authenticated
  USING (true) WITH CHECK (true);
