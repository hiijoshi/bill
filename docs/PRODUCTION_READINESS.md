# MBill Production Readiness Notes

## Source Of Truth

- Active codebase: `Mbill`
- Ignore `Mbill-main-push` for runtime and deployment

## Runtime Model (Cleaned)

- Build: `npm run build`
- Start: `npm run start:prod`
- PM2 process uses `ecosystem.config.cjs` and runs `npm run start:prod` in `cwd=/opt/bill/current`
- Deployment script: `scripts/deploy-production.sh` (normal Next.js flow, no standalone artifact mode)

## Security / Auth Status

- Login scope is now strict `traderId` only.
- Trader name alias login path has been removed from `lib/auth.ts`.
- Security regression suite passes (19/19).

## Cleanup Done

- Removed debug/test page: `app/test-auth/page.tsx`
- Removed duplicate API file: `app/api/accounting-heads/route 2.ts`
- Removed duplicate deploy scripts:
  - `deploy 2.sh`
  - `scripts/deploy-production 2.sh`
- Removed standalone-only build script:
  - `scripts/build-standalone-package.sh`
- Removed sample/dummy seed scripts:
  - `prisma/seed-simple.ts`
  - `prisma/seed-sales-test.ts`
- Removed committed sample statement artifact:
  - `var/bank-statements/.../Mbill-ERP.pdf`
- Added ignore rules:
  - `var/bank-statements/`
  - `var/uploads/`

## API Documentation

- Full endpoint map + usage matrix:
  - `docs/API_USAGE_MAP.md`

## Validation Run

- `npm run build`: pass
- `npm run test:security`: pass (19/19)
- `npx tsx --test tests/bank-statement-quick-create-utils.test.ts`: pass (5/5)

## Remaining Note

- Turbopack emits one NFT tracing warning from bank statement parsing import trace (`statement-storage-service.ts`); build still completes successfully.
