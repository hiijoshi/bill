# Billing App Technical Documentation

## Overview

This project is a multi-tenant mandi ERP built on Next.js App Router. The active production data path is Prisma with the libSQL adapter for Turso. Local development can still use SQLite for convenience, but production should be treated as Turso-only.

The tenant model is:

- `Trader` -> top-level tenant
- `Company` -> business unit under a trader
- `User` -> scoped to a trader and optionally a company

The core business areas are:

- purchases
- sales
- payments
- stock
- masters
- reports
- subscription
- super admin

## Runtime Architecture

### Frontend

- Next.js 16 App Router
- React 19
- Tailwind CSS 4
- Radix UI primitives

### Backend

- Next.js route handlers
- Prisma Client
- Turso/libSQL in production through `@prisma/adapter-libsql`
- SQLite only for local development

### Authentication

- Database-backed user authentication
- JWT access + refresh tokens
- Optional Supabase auth bridge, enabled only when all Supabase env variables are configured

## Database Strategy

### Production

Use:

- `TURSO_DATABASE_URL`
- `TURSO_AUTH_TOKEN`
- `USE_TURSO=true`

Deploy schema changes with:

```bash
npm run prisma:migrate:deploy
```

### Local Development

Use:

```env
DATABASE_URL="file:./dev.db"
```

Initialize locally with:

```bash
npx prisma generate
npm run prisma:migrate:deploy
```

If you are adopting an older database that already has tables but no `_prisma_migrations` history, run:

```bash
npm run prisma:migrate:baseline
```

## Configuration Rules

- All secrets must come from environment variables.
- `ALLOWED_ORIGINS` is required in production.
- If any Supabase env variable is set, the full Supabase config must be present.
- Vercel builds use a temporary SQLite path only for Prisma client generation; request-time data access should still go to Turso in production.

## Important Files

- [config.ts](/Users/himanshujoshi/Desktop/Project/billing-app/Mbill/lib/config.ts): env validation and runtime mode detection
- [prisma.ts](/Users/himanshujoshi/Desktop/Project/billing-app/Mbill/lib/prisma.ts): Prisma + Turso adapter initialization
- [build.mjs](/Users/himanshujoshi/Desktop/Project/billing-app/Mbill/scripts/build.mjs): Vercel-safe build entrypoint
- [schema.prisma](/Users/himanshujoshi/Desktop/Project/billing-app/Mbill/prisma/schema.prisma): canonical Prisma schema
- [route.ts](/Users/himanshujoshi/Desktop/Project/billing-app/Mbill/app/api/auth/route.ts): main login flow
- [import/route.ts](/Users/himanshujoshi/Desktop/Project/billing-app/Mbill/app/api/payments/bank-statement/import/route.ts): heavy batch payment import path

## Financial Year

The app uses the Indian financial year:

- starts on `1 April`
- ends on `31 March`

Financial years are stored in the `FinancialYear` model and resolved centrally from [financial-years.ts](/Users/himanshujoshi/Desktop/Project/billing-app/Mbill/lib/financial-years.ts).

Default behavior:

- views and reports default to the active financial year
- write actions validate that the target date belongs to an open financial year

## Performance Notes

Key production-safe optimizations already applied:

- request-scoped auth and permission caching
- prepared-page initial bootstraps for important screens
- batched bank-statement imports
- large list endpoints with pagination support
- indexed tenant/date-heavy Prisma models

## Production Checklist

1. Set the real Turso production environment variables in Vercel.
2. Set long random `JWT_SECRET` and `REFRESH_SECRET`.
3. Set `ALLOWED_ORIGINS` to the public app URL list.
4. Run `npm run prisma:migrate:deploy` against Turso.
5. Run `npm run build`.
6. Verify login, company switching, dashboard, purchase, sales, payment, reports, and superadmin flows on the deployed URL.

## Operational Notes

- Keep debug/test routes out of production.
- Do not commit `.env` files or generated DB files.
- Use [`.env.example`](/Users/himanshujoshi/Desktop/Project/billing-app/Mbill/.env.example) as the env template.
