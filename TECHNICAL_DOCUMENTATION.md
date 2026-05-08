# Billing App Technical Documentation

## Overview

This project is a multi-tenant mandi ERP built on Next.js App Router. The application now runs on server-local SQLite only (Prisma + `DATABASE_URL`).

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
- SQLite for development and production deployments where the app server stores local DB files

### Authentication

- Database-backed user authentication
- JWT access + refresh tokens
- Local database-backed authentication only

## Database Strategy

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
- Cloud auth/database bridge variables are not used.

## Important Files

- [config.ts](/Users/himanshujoshi/Desktop/Project/billing-app/Mbill/lib/config.ts): env validation
- [prisma.ts](/Users/himanshujoshi/Desktop/Project/billing-app/Mbill/lib/prisma.ts): local Prisma client initialization
- [build.mjs](/Users/himanshujoshi/Desktop/Project/billing-app/Mbill/scripts/build.mjs): build entrypoint
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

1. Set long random `JWT_SECRET` and `REFRESH_SECRET`.
2. Set `DATABASE_URL` to a writable server-local SQLite file path.
3. Set `ALLOWED_ORIGINS` to the public app URL list.
4. Run `npm run prisma:migrate:deploy`.
5. Run `npm run build`.
6. Verify login, company switching, dashboard, purchase, sales, payment, reports, and superadmin flows on the deployed URL.

## Operational Notes

- Keep debug/test routes out of production.
- Do not commit `.env` files or generated DB files.
- Use [`.env.example`](/Users/himanshujoshi/Desktop/Project/billing-app/Mbill/.env.example) as the env template.
