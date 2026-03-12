# Billing App (Mandi Multi-Tenant System)

Production-style billing platform for mandi/trader workflows with strict tenant isolation:

- Super Admin -> Trader -> Company -> User hierarchy
- Company-scoped Purchase, Sales, Stock, Payment flows
- Universal unit conversion anchor (1 Quintal = 100 KG)
- Server-side auth/scope enforcement and validation

## Current Status (March 2026)

Core app is running with major bug-fix and stability passes completed.

### Recently Fixed

- Sales Entry section structure corrected (Totals + Additional Charges separated cleanly)
- Purchase default-product behavior moved to Product Master (not repeated in entry forms)
- Abort handling improved in client request helpers and entry pages
- Transport/Product/Party/Supplier validations hardened
- Paid amount over payable amount checks enforced in purchase/special purchase/payment flows
- Lock/unlock and auth consistency improved in super-admin + main flows

### Added/Improved Features

- Optional default purchase product from master data
- Better form validation messages and safe numeric parsing
- Improved API response handling for failed/non-JSON responses
- Cleaner data load fallbacks for empty lists and partial records
- Purchase bill snapshot storage for reliable future print output
- Save Purchase Bill + Save & Print flow (formatted bill print route)
- Standardized purchase status values: `unpaid`, `partial`, `paid`

## Bulk Data Support (Large Scale)

To handle large datasets without UI lag, list APIs now support **server-side pagination + search**.

### Supported Query Params

- `page` (default: 1 when enabled)
- `pageSize` or `limit` (max: 200)
- `search` (server-side contains filter)
- `withMeta=true` (forces paginated response shape)

### Response Shapes

When pagination is **not** requested:

```json
[
  { "id": "...", "name": "..." }
]
```

When pagination **is** requested (`page/pageSize` or `withMeta=true`):

```json
{
  "data": [{ "id": "...", "name": "..." }],
  "meta": {
    "page": 1,
    "pageSize": 50,
    "total": 1240,
    "totalPages": 25,
    "hasNext": true,
    "hasPrev": false
  }
}
```

### APIs with Bulk Mode

- `GET /api/products`
- `GET /api/parties`
- `GET /api/suppliers`
- `GET /api/transports`
- `GET /api/purchase-bills`
- `GET /api/sales-bills`
- `GET /api/payments`

Example:

```bash
GET /api/products?companyId=<COMPANY_ID>&page=1&pageSize=50&search=soy&withMeta=true
```

## Security and Data Isolation

- Company access checks are enforced on server-side routes
- Role-based checks are enforced on protected endpoints
- Strict schema validation via Zod on write APIs
- Numeric and phone normalization to block invalid payloads
- Soft-delete aware reads (where implemented in route logic)

## Tech Stack

- Next.js 16 (App Router)
- TypeScript
- Tailwind + Shadcn UI
- Prisma ORM
- SQLite (dev) / PostgreSQL (recommended for production, shared multi-device)

## Multi-Device Permanent Data (Important)

If you run this app separately on different laptops with local SQLite, each device has its own DB file, so data will not match.

To make users/traders/companies/passwords permanent and shared across all devices:

1. Deploy one central app server (VPS/Render/Railway/Vercel + Node runtime).
2. Use one shared PostgreSQL database (Neon/Supabase/RDS/Railway).
3. Point all devices to the same hosted app URL.

### Required Production Env

```env
DATABASE_URL="postgresql://USER:PASSWORD@HOST:5432/DB?sslmode=require"
JWT_SECRET="long-random-32+"
REFRESH_SECRET="long-random-32+"
ALLOWED_ORIGINS="https://your-app-domain.com"
NEXT_PUBLIC_LIVE_SYNC_MS="20000"
```

### Development Env (current local)

```env
DATABASE_URL="file:./dev.db"
```

## Local Setup

```bash
npm install
npx prisma generate
npx prisma db push
npm run dev
```

App URLs:

- `http://localhost:3000` (or next available port)

## Production Setup (Shared Web App)

```bash
# 1) install
npm install

# 2) generate prisma client
npm run prisma:generate:postgres

# 3) apply schema to production database
npm run prisma:dbpush:postgres

# 4) build and run
npm run build
npm run start
```

Then open the same deployed URL from all devices. Super Admin changes will persist in the shared DB.

## Real-Time Sync Behavior

- Sidebar privileges auto-refresh (default every 60s)
- Top user/company context auto-refresh (default every 60s)
- Configure refresh interval with `NEXT_PUBLIC_LIVE_SYNC_MS`

## Developer Commands

```bash
# Type check
npx tsc --noEmit

# Lint
npm run lint

# Prisma client regenerate
npx prisma generate

# Sync schema to DB (dev)
npx prisma db push

# PostgreSQL (shared web app) commands
npm run prisma:generate:postgres
npm run prisma:dbpush:postgres
```

## Troubleshooting

### 1) `Unable to acquire lock at .next/dev/lock`

Another `next dev` process is already running.

```bash
# Cross-platform reset + restart
npm run dev:clean
```

### 2) Turbopack compaction / corrupted cache messages

Clear build cache and restart:

```bash
npm run dev:clean
```

### 3) `Runtime AbortError: The user aborted a request`

Usually caused by navigation/unmount while request is in-flight. This is now handled more safely in critical entry pages; if seen, refresh once and verify endpoint response.

### 4) Wrong/non-JSON response (`Unexpected token '<'`)

API request hit an HTML/error route instead of JSON endpoint. Check route URL, auth/session, and `companyId` query.

## Data Persistence Notes

- Data is stored in the database and survives relogin/restart
- If data appears missing, check active `companyId` context and user scope first

## Next Recommended Step

For very high volume (100k+ rows), move production DB to PostgreSQL and add cursor-based pagination on ledger/report endpoints.
