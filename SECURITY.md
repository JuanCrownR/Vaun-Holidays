# Vaun Holidays — Security Notes

This document tracks security hardening that has been applied and lists the
manual steps that still need to be done in the Supabase dashboard (which
code can't do for you).

## ✅ Implemented in code

### Critical fixes

1. **Public self-signup removed.**
   The "Create account" button on the login page has been removed
   (`index.html`). The signup modal is no longer reachable from the UI.
   New accounts must be created by an admin via the Users panel
   (`/api/admin-users invite` action), which sends a Supabase-issued
   invite email and lets the recipient set their own password.

2. **Signup role hardcoded to lowest privilege.**
   On the off-chance the signup modal is reached (e.g. through devtools),
   the role-selector UI is gone and the role is forced to `staff` in
   `handleSignup()`. Admins can promote new users from the Users panel
   afterwards.

3. **Anonymous read of operational tables removed** —
   see `migration-014-tighten-rls.sql`. After running, anon can no
   longer read `properties`, `bookings`, `cleaning_completions`,
   or `jobs`. The public guest guide (`/api/guide`) keeps working
   because it uses the server-side service role key.

### High-severity fixes

4. **Stored-XSS via `maps_url` patched.**
   `api/guide.js` now has a `safeUrl()` validator that rejects any URL
   scheme other than `http(s):`, `mailto:`, `tel:` — so a poisoned
   `javascript:` URL in a POI map link can no longer execute JS in a
   guest's browser. Applied to: POI `maps_url`, photo URLs, property
   thumbnail URL.

### Medium-severity fixes

5. **Stored-XSS in admin Users panel patched.**
   `${u.email}`, `${u.name}`, and `initials` are now all `escapeHtml`'d.
   IDs/emails passed into onclick attributes use `JSON.stringify`-then-
   `escapeHtml` so quote/angle-bracket characters can't break out.

6. **Calendar tooltip XSS patched.**
   The previous partial escape (only `"`) is replaced with full
   `escapeHtml()`. Same fix applied to the calendar preview popover
   (`notes`, property names, task type).

7. **Stored-XSS in department/all-tasks job rows patched.**
   Every `${propNames[j.property]}` interpolation is now wrapped in
   `escapeHtml()`. The activity-feed `addActivity()` helper also escapes
   its text before injecting into the DOM.

### Hardening headers on the public guide

8. **`api/guide.js` now sets:**
   - `Content-Security-Policy` — restricts script, style, font, and img
     sources. `frame-ancestors 'none'` and `X-Frame-Options: DENY`
     block clickjacking embeds.
   - `X-Content-Type-Options: nosniff`
   - `Referrer-Policy: strict-origin-when-cross-origin`
   - `Permissions-Policy` — denies camera, microphone, geolocation.

---

## ⚠️ Manual steps you still need to do

These can't be done in code — only you can do them.

### 1. Run the new RLS migration in Supabase

Open the Supabase SQL Editor for project
`xgdvmanykllnaxtbygny` and paste in the contents of
`migration-014-tighten-rls.sql`. Click **Run**.

Verify it worked by also running:
```sql
select schemaname, tablename, policyname, roles, cmd
from pg_policies
where schemaname = 'public' and cmd = 'SELECT'
order by tablename;
```
Every row's `roles` column should be `{authenticated}` — none should
contain `anon` or `public`.

### 2. Disable public email/password sign-up

The code changes prevent the UI from offering signup, but a savvy
attacker could still call `sb.auth.signUp(...)` directly. Belt-and-
braces: also flip the Supabase setting.

- Supabase dashboard → **Authentication** → **Providers** → **Email**
- Toggle **"Enable Sign Ups"** off
- Save

After this, only admin-invited users can join — exactly matching the
new app behaviour.

### 3. (Optional, future) Enforce role at the DB level

Currently every authenticated user has `for all to authenticated using
(true)` write access. The `role` in `user_metadata` is read by the UI
to lock certain controls (e.g. cleaners can't delete properties), but
the **database itself** doesn't enforce this. A logged-in cleaner who
opens devtools and calls `sb.from('properties').delete().eq('id','...')`
will succeed.

Tightening this needs decisions about per-role permissions
(what can each role read/write?) that I shouldn't make for you. When
you're ready, the pattern is roughly:

```sql
create or replace function public.current_role()
returns text language sql stable as $$
  select coalesce(auth.jwt() -> 'user_metadata' ->> 'role', 'staff');
$$;

-- Example: only admin/manager can update properties
drop policy "properties_write_auth" on public.properties;
create policy "properties_admin_manager_write" on public.properties
  for all to authenticated
  using (public.current_role() in ('admin','manager'))
  with check (public.current_role() in ('admin','manager'));
```

Repeat per table with policies appropriate to that table's purpose
(cleaners can update job status but not delete properties, etc.).

### 4. (Optional, future) Pre-commit secret scanning

Install `trufflehog` or `git-secrets` as a pre-commit hook so an
accidentally pasted SUPABASE_SERVICE_ROLE_KEY can never be committed:

```bash
brew install trufflehog
# add to .git/hooks/pre-commit:
trufflehog filesystem --no-update --fail .
```

---

## Threat model summary (post-fix)

- **Anonymous outsiders** can only access the public guest guide URL,
  and that response is rate-limit-able by Vercel CDN. They cannot read
  any DB rows directly anymore.
- **Authenticated users** (only admin-invited ones now) have full read +
  write to the DB via the dashboard. The UI restricts what each role can
  do, but the DB does not (see manual step #3 above).
- **Public guest guide** is hardened against:
  - Stored XSS via `javascript:` URLs in POI links or photos.
  - Clickjacking (CSP + X-Frame-Options).
  - Inline-script injection from poisoned content (CSP still allows
    inline scripts from our own server-rendered HTML; tightening this
    further requires moving inline JS to external files + nonces).

Last reviewed: 2026-05-27.
