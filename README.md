# Billing App (Mbill)

Backend-focused documentation for the mandi billing platform so a senior developer can quickly understand the project, run it locally, and test the APIs with `curl`.

## 1. Project Summary

This project is a multi-tenant billing and ERP-style application for mandi and trader workflows.

Main hierarchy:

- Super Admin
- Trader
- Company
- User

Main business modules:

- Authentication and company switching
- Purchase bills
- Sales bills
- Payments
- Stock and stock ledger
- Masters (products, parties, suppliers, units, banks, etc.)
- Reports
- Super Admin and subscription management

## 2. Backend Stack

The backend is built with:

- Next.js 16 App Router
- Route Handlers under `app/api/**`
- TypeScript
- Prisma ORM
- SQLite for local development
- Turso/libSQL for shared or production deployments
- JWT access and refresh token sessions stored in secure cookies
- Zod validation for request payloads

Important note:

- This backend is **not an API-key-authenticated backend**
- It uses **login + cookie session authentication**
- So for most app APIs, testing with `curl` means:
  1. login first
  2. store cookies
  3. call protected APIs with the cookie jar

## 3. Current AI Status

There is currently **no internal AI endpoint** in this repository.

What this means:

- No OpenAI key is used by the app backend right now
- No `/api/ai` or LLM route exists in the current codebase
- OCR-related packages exist for bank statement parsing (`tesseract.js`, `pdf-parse`, `xlsx`, `exceljs`), but that is document parsing, not chat/LLM integration

If your senior asks for an **AI API key curl test**, that test will be for an external provider directly, not for this project's backend.

## 4. How the Backend Is Organized

Key backend locations:

- [app/api](/Users/himanshujoshi/Desktop/Project/billing-app/Mbill/app/api): all HTTP API route handlers
- [lib/config.ts](/Users/himanshujoshi/Desktop/Project/billing-app/Mbill/lib/config.ts): environment validation and runtime mode selection
- [lib/prisma.ts](/Users/himanshujoshi/Desktop/Project/billing-app/Mbill/lib/prisma.ts): Prisma client and Turso adapter setup
- [lib/auth.ts](/Users/himanshujoshi/Desktop/Project/billing-app/Mbill/lib/auth.ts): credential authentication logic
- [lib/api-security.ts](/Users/himanshujoshi/Desktop/Project/billing-app/Mbill/lib/api-security.ts): auth helpers, role checks, company scoping
- [prisma/schema.prisma](/Users/himanshujoshi/Desktop/Project/billing-app/Mbill/prisma/schema.prisma): database schema
- [TECHNICAL_DOCUMENTATION.md](/Users/himanshujoshi/Desktop/Project/billing-app/Mbill/TECHNICAL_DOCUMENTATION.md): deeper architecture notes

## 5. Authentication Model

The app uses cookie-based auth.

Primary auth routes:

- `POST /api/auth/login` or `POST /api/auth`
- `GET /api/auth/me`
- `POST /api/auth/company`
- `POST /api/auth/logout`
- `GET /api/security/csrf`

Behavior:

- User logs in with `userId`, `password`, and optional `traderId`
- Backend validates credentials
- Backend issues access and refresh session cookies
- Active company can be switched after login
- Protected APIs read user/company context from cookies and auth helpers

## 6. Environment Variables

Base local development env:

```env
NODE_ENV=development
DATABASE_URL="file:./dev.db"
JWT_SECRET="replace-with-a-long-random-secret-at-least-32-chars"
REFRESH_SECRET="replace-with-a-different-long-random-secret-at-least-32-chars"
ALLOWED_ORIGINS="http://localhost:3000"
```

Production/shared database env:

```env
TURSO_DATABASE_URL="libsql://your-database.turso.io"
TURSO_AUTH_TOKEN="your-turso-auth-token"
USE_TURSO="true"
JWT_SECRET="replace-with-a-long-random-secret-at-least-32-chars"
REFRESH_SECRET="replace-with-a-different-long-random-secret-at-least-32-chars"
ALLOWED_ORIGINS="https://your-domain.com"
```

Important rules from the code:

- Either `DATABASE_URL` or `TURSO_DATABASE_URL` must exist
- If Turso runtime is used, `TURSO_AUTH_TOKEN` is required
- In production, `ALLOWED_ORIGINS` is required
- Supabase config is optional, but if enabled, all related env values must be present

Use [`.env.example`](/Users/himanshujoshi/Desktop/Project/billing-app/Mbill/.env.example) as the base template.

## 7. Local Setup

```bash
npm install
npx prisma generate
npm run prisma:migrate:deploy
npm run dev
```

Local app URL:

```bash
http://localhost:3000
```

Useful commands:

```bash
npm run lint
npx tsc --noEmit
npm run prisma:migrate:deploy
npm run prisma:migrate:baseline
npm run prisma:dbpush
npm run bootstrap:super-admin -- <userId> <password> [name]
```

## 8. Backend API Style

This project uses Next.js route handlers instead of Express or Fastify.

Examples:

- `app/api/auth/route.ts`
- `app/api/products/route.ts`
- `app/api/purchase-bills/route.ts`
- `app/api/payments/route.ts`

Common backend characteristics:

- JSON request/response APIs
- Zod schema validation on write operations
- Company-level access control
- Role checks such as `super_admin`, `trader_admin`, `company_admin`, `company_user`
- Pagination on large list endpoints

## 9. Main APIs Your Senior Should Know

Core auth/session:

- `POST /api/auth`
- `GET /api/auth/me`
- `POST /api/auth/company`
- `POST /api/auth/logout`
- `GET /api/security/csrf`

Core business endpoints:

- `GET /api/companies`
- `GET /api/products`
- `POST /api/products`
- `GET /api/purchase-bills`
- `POST /api/purchase-bills`
- `GET /api/payments`
- `POST /api/payments`
- `GET /api/reports/dashboard`

Bulk or master-data style endpoints also exist for:

- parties
- suppliers
- banks
- transports
- units
- payment modes
- mandi types
- sales items
- financial years

## 10. `curl` API Testing for This Project

### 10.1 Login and save cookies

Use a cookie jar because the app uses cookie auth.

```bash
curl -i \
  -c cookies.txt \
  -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "demo_user",
    "password": "demo_password",
    "traderId": "demo_trader"
  }'
```

You can also call:

```bash
POST /api/auth
```

because `app/api/auth/login/route.ts` re-exports the same handler.

Expected response shape:

```json
{
  "success": true,
  "user": {},
  "trader": {},
  "company": {},
  "bootstrap": {
    "companyId": "company-id",
    "defaultRoute": "/some-route",
    "permissions": [],
    "grantedReadModules": 0,
    "grantedWriteModules": 0,
    "companies": []
  }
}
```

### 10.2 Check logged-in user

```bash
curl -i \
  -b cookies.txt \
  http://localhost:3000/api/auth/me
```

### 10.3 Get available companies

```bash
curl -i \
  -b cookies.txt \
  http://localhost:3000/api/companies
```

### 10.4 Switch active company

Replace `COMPANY_ID` with a company returned by `/api/companies`.

```bash
curl -i \
  -b cookies.txt \
  -c cookies.txt \
  -X POST http://localhost:3000/api/auth/company \
  -H "Content-Type: application/json" \
  -d '{
    "companyId": "COMPANY_ID",
    "force": true
  }'
```

### 10.5 Fetch products for the active company

After company selection, many APIs work from session/company context.

```bash
curl -i \
  -b cookies.txt \
  "http://localhost:3000/api/products?page=1&pageSize=20&withMeta=true"
```

If needed for tooling, this route also reads company context from request headers such as:

- `x-company-id`
- `x-auth-company-id`

Example:

```bash
curl -i \
  -b cookies.txt \
  -H "x-company-id: COMPANY_ID" \
  "http://localhost:3000/api/products?page=1&pageSize=20&search=soy&withMeta=true"
```

### 10.6 Create a product

```bash
curl -i \
  -b cookies.txt \
  -H "Content-Type: application/json" \
  -H "x-company-id: COMPANY_ID" \
  -X POST http://localhost:3000/api/products \
  -d '{
    "name": "Test Product",
    "unit": "KG",
    "hsnCode": "1201",
    "gstRate": 5,
    "sellingPrice": 100,
    "description": "Created from curl",
    "isActive": true
  }'
```

### 10.7 Fetch purchase bills

```bash
curl -i \
  -b cookies.txt \
  "http://localhost:3000/api/purchase-bills?companyId=COMPANY_ID&page=1&pageSize=20"
```

### 10.8 Create a purchase bill

This is a representative sample payload. IDs must exist in your database.

```bash
curl -i \
  -b cookies.txt \
  -H "Content-Type: application/json" \
  -X POST http://localhost:3000/api/purchase-bills \
  -d '{
    "companyId": "COMPANY_ID",
    "billNumber": "1001",
    "billDate": "2026-04-12",
    "farmerName": "Test Farmer",
    "farmerAddress": "Test Village",
    "farmerContact": "9876543210",
    "productId": "PRODUCT_ID",
    "noOfBags": 10,
    "weight": 100,
    "rate": 2500,
    "payableAmount": 250000,
    "paidAmount": 0
  }'
```

### 10.9 Fetch payments

```bash
curl -i \
  -b cookies.txt \
  "http://localhost:3000/api/payments?companyId=COMPANY_ID&page=1&pageSize=20"
```

### 10.10 Create a payment

This payload depends on a valid company, bill, and payment mode in the database.

```bash
curl -i \
  -b cookies.txt \
  -H "Content-Type: application/json" \
  -X POST http://localhost:3000/api/payments \
  -d '{
    "companyId": "COMPANY_ID",
    "billType": "purchase",
    "billId": "PURCHASE_BILL_ID",
    "payDate": "2026-04-12",
    "amount": 1000,
    "mode": "cash",
    "status": "paid"
  }'
```

### 10.11 Logout

```bash
curl -i \
  -b cookies.txt \
  -c cookies.txt \
  -X POST http://localhost:3000/api/auth/logout
```

## 11. CSRF Token Check

For clients that need to inspect the current CSRF token:

```bash
curl -i \
  -b cookies.txt \
  http://localhost:3000/api/security/csrf
```

Typical response:

```json
{
  "ok": true,
  "data": {
    "csrfToken": "token-value",
    "namespace": "app",
    "refreshedAt": "2026-04-12T00:00:00.000Z"
  }
}
```

## 12. Pagination Pattern

Large list APIs support pagination.

Supported query params:

- `page`
- `pageSize`
- `limit`
- `search`
- `withMeta=true`

Example:

```bash
curl -b cookies.txt \
  "http://localhost:3000/api/products?page=1&pageSize=50&search=rice&withMeta=true"
```

Paginated response pattern:

```json
{
  "data": [],
  "meta": {
    "page": 1,
    "pageSize": 50,
    "total": 0,
    "totalPages": 0,
    "hasNext": false,
    "hasPrev": false
  }
}
```

## 13. Database Notes

Local development:

- Uses SQLite through Prisma
- Good for one developer machine

Shared or production deployment:

- Use Turso/libSQL
- All users should connect to the same deployed app and same shared database

If each laptop runs its own local SQLite file, data will not be shared.

## 14. AI API Key Test Example

This section is **not part of the Mbill backend**. It is only for testing an external AI provider key directly.

If your senior only wants to verify that an AI API key is working, use the provider's own HTTP API.

### Example: OpenAI key test

Set the key:

```bash
export OPENAI_API_KEY="your_api_key_here"
```

Then test with:

```bash
curl https://api.openai.com/v1/responses \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $OPENAI_API_KEY" \
  -d '{
    "model": "gpt-4.1-mini",
    "input": "Say hello in one short line."
  }'
```

If the key is valid, you should get a JSON response from OpenAI.

If the key is invalid, you will usually get:

- `401 Unauthorized`, or
- an error JSON saying the API key is invalid

## 15. What to Tell Your Senior

Short version:

- The backend is built with `Next.js App Router + Route Handlers`
- ORM is `Prisma`
- Local DB is `SQLite`
- Production/shared DB is `Turso/libSQL`
- Auth is `JWT + refresh token cookies`, not API key auth
- API validation uses `Zod`
- Protected APIs are tenant-aware and company-scoped
- There is currently no internal AI endpoint in this project
- External AI key testing should be done directly against the AI provider using `curl`

## 16. Troubleshooting

### App does not start

Check:

- `.env` values
- `JWT_SECRET`
- `REFRESH_SECRET`
- database config

### Prisma schema mismatch

Run:

```bash
npx prisma generate
npm run prisma:migrate:deploy
```

### Login works but business APIs fail

Usually one of these:

- no active company selected
- missing cookie jar in `curl`
- wrong `companyId`
- user does not have permission for that module

### Local data not visible on another machine

That is expected with local SQLite.

Use:

- one deployed app
- one shared Turso database

## 17. Suggested Next Improvement

If the team plans to add AI to this project later, the clean approach would be:

1. add a dedicated route like `POST /api/ai/prompt`
2. keep provider keys only in server env vars
3. never expose the provider key to the browser
4. document request/response format separately from core billing APIs
