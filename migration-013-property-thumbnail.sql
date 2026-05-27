-- migration-013-property-thumbnail.sql
-- Adds a thumbnail_url column to properties.
-- Used to store a single representative photo for each property,
-- displayed in the dashboard property cards.
-- Idempotent — safe to re-run.

alter table properties add column if not exists thumbnail_url text;
