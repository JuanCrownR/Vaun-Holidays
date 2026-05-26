-- migration-012-guest-guide.sql
-- Run in Supabase SQL Editor → New query → paste → Run
-- Adds guest_guide JSONB column to properties table

ALTER TABLE properties
  ADD COLUMN IF NOT EXISTS guest_guide JSONB DEFAULT '{}'::jsonb;
