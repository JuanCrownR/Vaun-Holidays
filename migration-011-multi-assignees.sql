-- migration-011-multi-assignees.sql
-- Run in Supabase SQL Editor → New query → paste → Run
--
-- Adds an `assignees` JSONB column to jobs so tasks can be assigned to
-- multiple people.  The existing `assigned_to` TEXT column is kept for
-- backward-compatibility and always mirrors the first assignee's name.

ALTER TABLE jobs
  ADD COLUMN IF NOT EXISTS assignees JSONB DEFAULT '[]'::jsonb;

-- Back-fill existing rows: if assigned_to has a value, wrap it in a
-- single-item array so the new column is consistent.
UPDATE jobs
SET assignees = jsonb_build_array(jsonb_build_object('name', assigned_to, 'email', ''))
WHERE assigned_to IS NOT NULL
  AND assigned_to <> ''
  AND (assignees IS NULL OR assignees = '[]'::jsonb);
