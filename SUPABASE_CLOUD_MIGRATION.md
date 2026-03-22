# Supabase Cloud-First Migration Audit

## Current Reality

This app is **not browser-local-first today**. The real source of truth is:

- `Prisma + SQLite` in local development
- a local DB file at `prisma/prisma/dev.db`
- custom JWT auth and cookie sessions
- Next.js API routes as the only business-data contract for the UI

The browser uses only a few small local helpers:

- `lib/default-product.ts`
  - `localStorage` for remembering a default product
- `lib/super-admin-tab.ts`
  - `sessionStorage` for tab-level Super Admin gating
- `lib/client-fetch-cache.ts`
  - in-memory cache only for fetch reuse

That means the main migration is:

1. move **server data source** from local SQLite to Supabase Postgres
2. keep UI contract stable through existing API routes
3. migrate auth after the DB cutover is safe

This is the safest production path.

## Audit Summary

### Local database footprint

- `58` modules currently import `@/lib/prisma`
- `47` API routes directly use Prisma-backed reads/writes

### Current auth model

- custom login in `app/api/auth/route.ts`
- custom JWT generation and verification in `lib/auth.ts`
- custom cookie sessions in `lib/session.ts`
- tenancy and permissions enforced in:
  - `middleware.ts`
  - `lib/api-security.ts`
  - `UserPermission` table

### Current database models

Main tables already exist in Prisma for the business domain:

- `Trader`
- `User`
- `Company`
- `UserPermission`
- `Party`
- `Farmer`
- `Supplier`
- `Unit`
- `Product`
- `PurchaseBill`
- `PurchaseItem`
- `SpecialPurchaseBill`
- `SpecialPurchaseItem`
- `SalesBill`
- `SalesItem`
- `SalesItemMaster`
- `StockLedger`
- `Payment`
- `AuditLog`
- `Transport`
- `Bank`
- `Marka`
- `PaymentMode`
- `TransportBill`

### Current UI/data flow

The UI is mostly already cleanly separated from persistence:

- screens call Next.js API routes
- API routes call Prisma
- Prisma points to SQLite locally today

This is good news because we can change the DB backend with fewer UI breaks.

## What Is Wrong In The Current Flow

### 1. Local SQLite is still the operational database

Even though there is a PostgreSQL Prisma schema, the active runtime still points to:

- `prisma/schema.prisma`
- `provider = "sqlite"`

That means:

- every local machine can diverge
- reports and totals depend on a local file
- multi-device consistency is weak
- production-grade concurrency is limited

### 2. Auth is custom and tightly coupled to local tables

The current login/session stack:

- reads users from Prisma
- verifies bcrypt password locally
- issues custom JWT
- stores custom cookies

This works, but it is not yet Supabase Auth.

### 3. Company isolation depends on app logic, not database-native policy

Tenant isolation is mostly enforced in:

- `middleware.ts`
- `lib/api-security.ts`
- per-route company filters

This is workable, but the database itself is not enforcing row-level access yet.

### 4. Migration risk exists if DB and auth are changed together

If we switch:

- database
- auth
- session model
- server access rules

all in one step, we create unnecessary risk.

## What Should Change First

### First change

**Move the database to Supabase Postgres first, while keeping the existing UI and most API route contracts unchanged.**

This gives us:

- cloud database as source of truth
- stable UI
- lower migration risk
- easier verification of totals and reports

### Second change

Add:

- idempotent write safeguards
- sync/error logging
- export/import migration tooling

### Third change

Only after the app is stable on Supabase Postgres:

- move login to Supabase Auth
- map Supabase auth users to app users/companies
- apply RLS policies

## Recommended Final Architecture

### Source of truth

- Supabase PostgreSQL

### Auth

- Supabase Auth

### File storage

- Supabase Storage

### UI caching only

- draft forms
- unsaved bill temp state
- retry queue for temporary offline handling

### App access pattern

- frontend -> Next.js app / API routes
- API routes -> Prisma or Supabase server client
- DB -> Supabase Postgres

For this codebase, the best migration path is:

- keep API routes as the boundary first
- change the DB under them
- then gradually move auth and direct cloud capabilities

## Exact Migration Order

### Phase 1: Audit and freeze data model

Done in this pass:

- identified local database usage
- identified browser-only storage usage
- confirmed current auth/session flow
- confirmed data model already exists in both SQLite and PostgreSQL Prisma schema files

### Phase 2: Database cutover to Supabase Postgres

1. create Supabase project
2. set:
   - `DATABASE_URL` -> Supabase pooler URL
   - `DIRECT_URL` -> Supabase direct DB URL
3. run:
   - `npm run prisma:generate:postgres`
   - `npm run prisma:migrate:deploy:postgres`
4. point runtime to Postgres in deployment
5. verify all existing API routes without changing UI routes

### Phase 3: One-time data migration

1. export current SQLite data
2. import into Supabase Postgres
3. preserve original IDs where possible
4. mark migration batch
5. stop production reads from SQLite

### Phase 4: Write safety

Add to transactional writes:

- `clientRequestId`
- idempotent insert rules
- retry-safe upserts where appropriate
- sync/error logging

Target tables:

- `SalesBill`
- `PurchaseBill`
- `Payment`
- `StockLedger`

### Phase 5: Auth migration

1. create Supabase Auth users
2. map `auth.users.id` to application users
3. keep app-level `User`, `Company`, `Trader`, `UserPermission`
4. gradually replace custom login/session
5. move to server-side Supabase session validation

### Phase 6: RLS

After auth is on Supabase:

- add `company_id` and ownership-aware policies
- keep service role server-side only
- keep publishable key client-side only

## Proposed Supabase Schema Direction

The current Prisma PostgreSQL schema is already a strong base.

Use it as the initial Supabase relational structure for:

- users
- traders
- companies
- user permissions
- parties / farmers / suppliers
- units / products
- sales / purchase / special purchase
- stock ledger
- payments
- banks / markas / payment modes
- audit logs

### Mandatory fields across business tables

Keep or add:

- `id`
- `createdAt`
- `updatedAt`
- `companyId` where applicable
- `createdBy` / `userId` where relevant
- `deletedAt` where soft delete already exists

### Add next for sync safety

Recommended future columns:

- `clientRequestId String?`
- `migrationBatchId String?`
- `migratedFrom String?`
- `sourceUpdatedAt DateTime?`

Recommended unique indexes:

- `@@unique([companyId, clientRequestId])` on mutation-heavy tables

## RLS Strategy

Do **not** start with direct frontend SQL access.

For this app, the safe order is:

1. database migration first
2. keep server API authorization
3. add Supabase Auth
4. then add RLS

Recommended RLS claim model later:

- `app_role`
- `user_db_id`
- `trader_id`
- `company_ids`

Recommended policy idea:

- `super_admin`: unrestricted
- `trader_admin`: trader-matched rows
- `company_admin/company_user`: company-scoped rows only

## Files Added In This Pass

### Supabase scaffolding

- `lib/supabase/shared.ts`
- `lib/supabase/client.ts`
- `lib/supabase/server.ts`
- `lib/supabase/admin.ts`

These are not wired into production paths yet. They are safe scaffolding for the next migration phases.

### Migration helper

- `scripts/export-local-data-for-supabase.ts`

Package script:

- `npm run supabase:export-local`

This exports the current local Prisma/SQLite dataset to:

- `migration-data/sqlite-export-for-supabase-<timestamp>.json`

## Current Browser Storage Usage Inventory

Only these browser stores remain:

- `lib/default-product.ts`
  - default product helper
- `lib/super-admin-tab.ts`
  - tab session helper

No full business ledger, bill, report, payment, or stock source-of-truth data is stored in browser local storage.

## Important Safety Notes

- do not expose `SUPABASE_SERVICE_ROLE_KEY` to the client
- do not connect frontend directly to database URLs
- do not remove SQLite/runtime fallback until migration is verified
- do not migrate auth and DB in one deployment cut
- do not skip company-level access verification during import

## Recommended Next Implementation Step

### The safest next coding phase is:

1. add a dedicated migration/import script for Supabase Postgres
2. add `clientRequestId` to write-heavy transaction tables
3. wire a Supabase-backed server data layer behind a small repository boundary
4. move one module first:
   - `companies`
   - `banks`
   - `products`
   - or `sales bills`

The best first transactional candidate is:

- `SalesBill` + `SalesItem` + `Payment`

because it touches the most business-critical paths:

- billing
- outstanding
- reports
- payments

