# Supabase Auth + RLS Migration

This document covers the migration from the current custom JWT + middleware RBAC model to Supabase Auth + database-enforced Row Level Security.

## Current Auth Audit

### Custom JWT/session currently in control

- [`lib/auth.ts`](/Users/himanshujoshi/Desktop/Project/billing-app/lib/auth.ts)
  - Verifies legacy bcrypt passwords from `public."User"`.
  - Issues custom access and refresh JWTs with `userId`, `traderId`, `name`, and `role`.
- [`lib/session.ts`](/Users/himanshujoshi/Desktop/Project/billing-app/lib/session.ts)
  - Stores those JWTs in HttpOnly cookies.
  - Owns refresh and CSRF cookie lifecycle.
- [`middleware.ts`](/Users/himanshujoshi/Desktop/Project/billing-app/middleware.ts)
  - Verifies the custom JWT on every API request.
  - Injects `x-user-id`, `x-trader-id`, `x-user-role`, `x-user-role-normalized`, `x-company-id`, and `x-user-db-id`.
  - Enforces company scope with Prisma before the route handler runs.
- [`lib/api-security.ts`](/Users/himanshujoshi/Desktop/Project/billing-app/lib/api-security.ts)
  - Builds auth context entirely from middleware-injected headers.
  - Enforces `ensureCompanyAccess()`, `requireRoles()`, and route-module permission checks from Prisma `UserPermission`.
- [`app/api/auth/route.ts`](/Users/himanshujoshi/Desktop/Project/billing-app/app/api/auth/route.ts)
  - Handles login against the legacy `User.password` hash.
- [`app/api/auth/refresh/route.ts`](/Users/himanshujoshi/Desktop/Project/billing-app/app/api/auth/refresh/route.ts)
  - Reissues the custom JWT from the custom refresh token.
- [`app/api/auth/me/route.ts`](/Users/himanshujoshi/Desktop/Project/billing-app/app/api/auth/me/route.ts)
  - Hydrates session state by rereading `public."User"` and company scope from Prisma.
- [`app/api/auth/company/route.ts`](/Users/himanshujoshi/Desktop/Project/billing-app/app/api/auth/company/route.ts)
  - Stores the selected company in a separate cookie, still backed by the custom session.
- [`app/api/auth/permissions/route.ts`](/Users/himanshujoshi/Desktop/Project/billing-app/app/api/auth/permissions/route.ts)
  - Reads Prisma `UserPermission` after `ensureCompanyAccess()`.
- [`app/layout.tsx`](/Users/himanshujoshi/Desktop/Project/billing-app/app/layout.tsx)
  - Browser fetch interceptor retries `401` via `/api/auth/refresh`.
- [`app/login/page.tsx`](/Users/himanshujoshi/Desktop/Project/billing-app/app/login/page.tsx)
  - Current UI posts `traderId`, `userId`, `password` to the custom `/api/auth` route.

### Route surface still relying on header-based RBAC

Every user-scoped business route that imports `ensureCompanyAccess()` or `requireAuthContext()` is still protected in the application layer instead of the database. The first wave includes:

- master routes: `banks`, `markas`, `payment-modes`, `products`, `parties`, `farmers`, `suppliers`, `transports`, `units`, `sales-items`
- transactions: `purchase-bills`, `special-purchase-bills`, `sales-bills`, `payments`, `stock-ledger`, `stock/adjustment`
- reports and company-selection endpoints

The result is:

- authorization is trusted from middleware-set headers
- Prisma queries bypass Postgres RLS entirely
- Supabase cannot be the source of truth for access control yet

## Target Schema

Step 1 schema and policies live in:

- [`supabase/sql/20260322_auth_profiles_rls_step1.sql`](/Users/himanshujoshi/Desktop/Project/billing-app/supabase/sql/20260322_auth_profiles_rls_step1.sql)
- [`supabase/sql/20260322_auth_profiles_backfill_step1.sql`](/Users/himanshujoshi/Desktop/Project/billing-app/supabase/sql/20260322_auth_profiles_backfill_step1.sql)

### Auth-linked profile model

`public.profiles`

- `id uuid primary key references auth.users(id) on delete cascade`
- `legacy_user_id text unique`
- `trader_id text not null references public."Trader"(id)`
- `user_code text not null`
- `full_name text`
- `app_role text`
- `login_email text unique`
- `default_company_id text references public."Company"(id)`
- `is_active boolean`
- timestamps

Why this shape:

- `auth.users` becomes the identity source
- `profiles` keeps app-specific billing claims and legacy mapping
- `legacy_user_id` lets us backfill from the current `public."User"` table without losing references

### Company access model

`public.profile_company_access`

- `profile_id uuid references public.profiles(id) on delete cascade`
- `company_id text references public."Company"(id) on delete cascade`
- `is_default boolean`
- `is_active boolean`
- timestamps
- primary key `(profile_id, company_id)`

### Company permission model

`public.profile_company_permissions`

- `profile_id uuid`
- `company_id text`
- `module text`
- `can_read boolean`
- `can_write boolean`
- timestamps
- primary key `(profile_id, company_id, module)`

Why this stays separate from `profile_company_access`:

- company membership is not the same as module privilege
- it mirrors the current `UserPermission` matrix closely, which keeps the UI stable during migration

## Custom Claims Model

The Step 1 hook injects compact claims into the Supabase access token:

- `app_role`
- `trader_id`
- `user_db_id`
- `default_company_id`
- `company_ids` only when the token stays small enough

Helper functions in SQL:

- `public.current_app_role()`
- `public.current_trader_id()`
- `public.current_user_db_id()`
- `public.current_default_company_id()`
- `public.current_company_ids()`
- `public.has_company_access(target_company_id text)`
- `public.has_company_module_access(target_company_id text, requested_module text, requested_action text)`

## Exact Migration Order

### Phase 0: prerequisites

1. Point `DATABASE_URL` and `DIRECT_URL` to Supabase Postgres.
2. Set:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`
3. Deploy the existing Prisma schema to Supabase Postgres.
4. Run the existing master-data migration first if needed:
   - [`scripts/migrate-master-store-to-db.ts`](/Users/himanshujoshi/Desktop/Project/billing-app/scripts/migrate-master-store-to-db.ts)

### Phase 1: introduce Auth-linked app profiles

1. Apply [`supabase/sql/20260322_auth_profiles_rls_step1.sql`](/Users/himanshujoshi/Desktop/Project/billing-app/supabase/sql/20260322_auth_profiles_rls_step1.sql).
2. Configure the Supabase Custom Access Token Hook to call `public.custom_access_token_hook`.
3. Create or migrate Supabase Auth users.
4. Ensure `public.profiles.legacy_user_id` points to the old `public."User".id`.
5. Run [`supabase/sql/20260322_auth_profiles_backfill_step1.sql`](/Users/himanshujoshi/Desktop/Project/billing-app/supabase/sql/20260322_auth_profiles_backfill_step1.sql).

### Phase 2: hybrid login without UI breakage

Keep the current login form, but change what `/api/auth` does internally:

1. Accept the same `traderId`, `userId`, `password`.
2. Verify the legacy bcrypt password once against `public."User"`.
3. Upsert the matching Supabase Auth user if missing.
4. If the user exists but has not been synced to Supabase Auth yet, set/update the Supabase password on successful legacy login.
5. Sign in to Supabase Auth server-side and return Supabase session cookies.
6. During rollout, continue issuing the legacy custom session in parallel so old routes keep working.

This avoids a forced password reset and keeps the existing login UI unchanged.

### Phase 3: session bridge in Next.js

1. Add Supabase browser/server/route clients.
2. Add an SSR session refresh layer using `supabase.auth.getClaims()` in middleware/proxy-compatible code.
3. Update `/api/auth/me`, `/api/auth/company`, and `/api/auth/permissions` to prefer the Supabase session first, then fall back to legacy cookies during rollout.
4. Keep `/api/auth/refresh` only as a rollout bridge until all UI and APIs are on Supabase Auth.

### Phase 4: first RLS-enforced resource slice

Move the smallest low-risk masters first:

1. `Bank`
2. `Marka`
3. `PaymentMode`

These are now implemented as hybrid routes:

- [`app/api/banks/route.ts`](/Users/himanshujoshi/Desktop/Project/billing-app/app/api/banks/route.ts)
- [`app/api/markas/route.ts`](/Users/himanshujoshi/Desktop/Project/billing-app/app/api/markas/route.ts)
- [`app/api/payment-modes/route.ts`](/Users/himanshujoshi/Desktop/Project/billing-app/app/api/payment-modes/route.ts)

Behavior:

- if a valid Supabase Auth session with app claims exists, the route uses Supabase data access and RLS applies
- otherwise it falls back to the current Prisma + `ensureCompanyAccess()` path

This makes rollout reversible and keeps the UI stable.

### Phase 5: remaining user-scoped masters

Next move:

- `Party`
- `Farmer`
- `Supplier`
- `Product`
- `Transport`
- `Unit`
- `SalesItemMaster`

Each gets:

- helper policies
- hybrid route conversion
- regression tests comparing Supabase vs legacy behavior

### Phase 6: transactions and reports

After masters are stable:

- `PurchaseBill`
- `SalesBill`
- `Payment`
- `StockLedger`
- report queries through authenticated server flows or SQL views/RPC

This phase should add dedicated helper policies for bill ownership, party joins, and report-safe aggregate reads.

### Phase 7: cutover

1. Remove middleware header injection as the primary auth source.
2. Switch all user-scoped data routes to Supabase-authenticated access.
3. Keep Prisma only for:
   - migrations
   - admin maintenance scripts
   - super-admin tooling that intentionally uses the service role
4. Remove the legacy custom JWT refresh flow.

## First Safe Implementation: Bank, Marka, PaymentMode

### New Supabase bridge files

- [`lib/supabase/client.ts`](/Users/himanshujoshi/Desktop/Project/billing-app/lib/supabase/client.ts)
- [`lib/supabase/server.ts`](/Users/himanshujoshi/Desktop/Project/billing-app/lib/supabase/server.ts)
- [`lib/supabase/route.ts`](/Users/himanshujoshi/Desktop/Project/billing-app/lib/supabase/route.ts)
- [`lib/supabase/auth-bridge.ts`](/Users/himanshujoshi/Desktop/Project/billing-app/lib/supabase/auth-bridge.ts)
- [`lib/supabase/admin.ts`](/Users/himanshujoshi/Desktop/Project/billing-app/lib/supabase/admin.ts)
- [`lib/supabase/shared.ts`](/Users/himanshujoshi/Desktop/Project/billing-app/lib/supabase/shared.ts)

### Why this slice is safe

- these tables are company-scoped and low-risk compared with bills/payments
- the API contract stays unchanged
- the route only opts into Supabase when a real Supabase session exists
- fallback to the legacy auth path prevents a hard cutover outage

### RLS coverage already included

Step 1 SQL enables separate select/insert/update/delete policies for:

- `public."Company"`
- `public."Bank"`
- `public."Marka"`
- `public."PaymentMode"`

## Rollout Checks

### Before turning on hybrid auth in production

1. Apply Step 1 SQL in a staging Supabase project.
2. Create at least:
   - one company user
   - one company admin
   - one trader admin
3. Backfill `profiles`, `profile_company_access`, and `profile_company_permissions`.
4. Validate that `supabase.auth.getClaims()` returns:
   - `app_role`
   - `trader_id`
   - `user_db_id`
   - `default_company_id`
5. Validate `Bank`, `Marka`, and `PaymentMode` CRUD from two companies under the same trader and from another trader.

### Minimum regression matrix

- user with single-company access can only read/write their company
- user with multi-company access can switch companies and only see the selected company rows
- trader admin can access all permitted trader companies
- super admin can access all companies
- revoked `UserPermission` blocks writes under RLS
- locked/deleted company rows do not leak through `Company` policies

## Rollback

### Application rollback

1. Stop sending users through Supabase-authenticated code paths.
2. Keep using the existing legacy `/api/auth` session only.
3. Because the first slice is hybrid, `Bank`, `Marka`, and `PaymentMode` continue working through Prisma.

### Database rollback

1. Disable the custom access token hook in Supabase.
2. If required, drop the new policies from:
   - `public."Company"`
   - `public."Bank"`
   - `public."Marka"`
   - `public."PaymentMode"`
3. Leave `profiles` and related access tables in place unless you need a hard rollback; they are additive and do not alter existing business rows.

## Important Constraints

- Do not switch transaction routes to Supabase-authenticated access until the login/session bridge is in place.
- Do not remove the legacy cookies until `/api/auth/me`, `/api/auth/company`, and `/api/auth/permissions` are Supabase-first.
- Do not rely on browser local storage for auth state; Supabase session cookies should remain the source of truth.
