-- Migration 009: Contacts table
-- Run this in the Supabase SQL editor at https://supabase.com/dashboard

CREATE TABLE IF NOT EXISTS public.contacts (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  name        TEXT NOT NULL,
  type        TEXT NOT NULL DEFAULT 'staff'
                CHECK (type IN ('staff','cleaner','trade','supplier','owner')),
  company     TEXT,
  email       TEXT,
  phone       TEXT,
  notes       TEXT,
  created_by  UUID REFERENCES auth.users(id) ON DELETE SET NULL
);

-- Enable RLS
ALTER TABLE public.contacts ENABLE ROW LEVEL SECURITY;

-- Allow all authenticated users to read and manage contacts
CREATE POLICY "Authenticated users can manage contacts"
  ON public.contacts
  FOR ALL
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);
