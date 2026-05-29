# MBill API Usage Map

Generated from `app/api/**/route.ts` and usage scans in `app`, `components`, and `lib`.

## Source Of Truth

- Active application folder: `Mbill`
- Secondary folder `Mbill-main-push` is treated as non-source snapshot and should not be used for runtime/deploy.

## API Endpoints

| Endpoint | Methods | Route File | Used In App |
|---|---|---|---|
| `/api/accounting-heads` | GET, POST, PUT, DELETE | `app/api/accounting-heads/route.ts` | `app/master/accounting-head/page.tsx`<br/>`app/payment/cash-bank/entry/page.tsx`<br/>`app/payment/journal-voucher/entry/page.tsx`<br/>`app/purchase/entry/page.tsx`<br/>`app/sales/entry/page.tsx`<br/>`lib/permissions.ts`<br/>`lib/super-admin-master-registry.ts` |
| `/api/auth` | POST, OPTIONS | `app/api/auth/route.ts` | `app/AppShell.tsx`<br/>`lib/http/api-client.ts` |
| `/api/auth/company` | GET, POST | `app/api/auth/company/route.ts` | `app/company/select/CompanySelectorSimple.tsx`<br/>`app/components/DashboardLayout.tsx`<br/>`app/components/Sidebar.tsx`<br/>`app/login/page.tsx`<br/>`app/main/dashboard/MainDashboardClient.tsx`<br/>`lib/company-context.ts` |
| `/api/auth/financial-year` | GET, POST | `app/api/auth/financial-year/route.ts` | `lib/client-financial-years.ts` |
| `/api/auth/login` | N/A | `app/api/auth/login/route.ts` | `app/AppShell.tsx`<br/>`app/login/page.tsx` |
| `/api/auth/logout` | POST | `app/api/auth/logout/route.ts` | `app/components/DashboardLayout.tsx`<br/>`components/SessionProvider.tsx` |
| `/api/auth/me` | GET | `app/api/auth/me/route.ts` | `lib/client-shell-data.ts`<br/>`lib/company-context.ts` |
| `/api/auth/permissions` | GET | `app/api/auth/permissions/route.ts` | `lib/client-permissions.ts` |
| `/api/auth/refresh` | POST | `app/api/auth/refresh/route.ts` | `app/AppShell.tsx` |
| `/api/bank-statements/batches` | POST | `app/api/bank-statements/batches/route.ts` | `app/payment/bank-statement/upload/BankStatementUploadClient.tsx` |
| `/api/bank-statements/batches/[batchId]` | GET | `app/api/bank-statements/batches/[batchId]/route.ts` | (no direct client fetch found; server/internal use) |
| `/api/bank-statements/batches/[batchId]/export` | POST | `app/api/bank-statements/batches/[batchId]/export/route.ts` | (no direct client fetch found; server/internal use) |
| `/api/bank-statements/batches/[batchId]/file` | POST | `app/api/bank-statements/batches/[batchId]/file/route.ts` | (no direct client fetch found; server/internal use) |
| `/api/bank-statements/batches/[batchId]/finalize` | POST | `app/api/bank-statements/batches/[batchId]/finalize/route.ts` | (no direct client fetch found; server/internal use) |
| `/api/bank-statements/batches/[batchId]/match` | POST | `app/api/bank-statements/batches/[batchId]/match/route.ts` | (no direct client fetch found; server/internal use) |
| `/api/bank-statements/batches/[batchId]/parse` | POST | `app/api/bank-statements/batches/[batchId]/parse/route.ts` | (no direct client fetch found; server/internal use) |
| `/api/bank-statements/batches/[batchId]/post` | POST | `app/api/bank-statements/batches/[batchId]/post/route.ts` | (no direct client fetch found; server/internal use) |
| `/api/bank-statements/batches/[batchId]/reprocess` | POST | `app/api/bank-statements/batches/[batchId]/reprocess/route.ts` | (no direct client fetch found; server/internal use) |
| `/api/bank-statements/lookups` | GET | `app/api/bank-statements/lookups/route.ts` | `app/payment/bank-statement/upload/BankStatementUploadClient.tsx` |
| `/api/bank-statements/rows/[rowId]/draft` | PATCH | `app/api/bank-statements/rows/[rowId]/draft/route.ts` | (no direct client fetch found; server/internal use) |
| `/api/bank-statements/rows/[rowId]/quick-create` | POST | `app/api/bank-statements/rows/[rowId]/quick-create/route.ts` | (no direct client fetch found; server/internal use) |
| `/api/bank-statements/rows/[rowId]/review` | PATCH | `app/api/bank-statements/rows/[rowId]/review/route.ts` | (no direct client fetch found; server/internal use) |
| `/api/bank-statements/workspace` | GET | `app/api/bank-statements/workspace/route.ts` | `app/payment/bank-statement/upload/BankStatementUploadClient.tsx` |
| `/api/banks` | GET, POST, PUT, DELETE | `app/api/banks/route.ts` | `app/master/bank/page.tsx`<br/>`app/payment/cash-bank/entry/page.tsx`<br/>`app/payment/journal-voucher/entry/page.tsx`<br/>`app/payment/purchase/entry/page.tsx`<br/>`app/payment/sales/entry/page.tsx`<br/>`lib/permissions.ts`<br/>`lib/super-admin-master-registry.ts` |
| `/api/banks/import` | POST | `app/api/banks/import/route.ts` | `app/master/bank/page.tsx` |
| `/api/companies` | GET, POST, PUT, DELETE, OPTIONS | `app/api/companies/route.ts` | `lib/client-shell-data.ts` |
| `/api/dashboard/stock-workspace` | GET | `app/api/dashboard/stock-workspace/route.ts` | `app/main/dashboard/MainDashboardClient.tsx`<br/>`app/main/dashboard/components/StockManagementTab.tsx` |
| `/api/farmers` | GET, POST, PUT, DELETE | `app/api/farmers/route.ts` | `app/payment/journal-voucher/entry/page.tsx`<br/>`app/purchase/entry/page.tsx`<br/>`lib/permissions.ts` |
| `/api/financial-years` | GET, POST | `app/api/financial-years/route.ts` | `app/master/financial-year/page.tsx`<br/>`app/super-admin/traders/[id]/page.tsx`<br/>`lib/client-financial-years.ts` |
| `/api/financial-years/[id]/activate` | POST | `app/api/financial-years/[id]/activate/route.ts` | (no direct client fetch found; server/internal use) |
| `/api/financial-years/[id]/status` | PATCH | `app/api/financial-years/[id]/status/route.ts` | (no direct client fetch found; server/internal use) |
| `/api/live-updates` | GET, POST | `app/api/live-updates/route.ts` | `lib/app-live-data.ts` |
| `/api/login` | POST | `app/api/login/route.ts` | (no direct client fetch found; server/internal use) |
| `/api/main-dashboard/overview` | GET | `app/api/main-dashboard/overview/route.ts` | `app/main/dashboard/MainDashboardClient.tsx`<br/>`lib/permissions.ts` |
| `/api/mandi-types` | GET, POST, PUT, DELETE | `app/api/mandi-types/route.ts` | `app/master/accounting-head/page.tsx`<br/>`app/master/mandi-type/page.tsx`<br/>`app/master/party/page.tsx`<br/>`app/purchase/entry/page.tsx`<br/>`lib/permissions.ts` |
| `/api/markas` | GET, POST, PUT, DELETE | `app/api/markas/route.ts` | `app/master/marka/page.tsx`<br/>`app/purchase/edit/page.tsx`<br/>`app/purchase/entry/page.tsx`<br/>`app/sales/entry/page.tsx`<br/>`lib/permissions.ts`<br/>`lib/super-admin-master-registry.ts` |
| `/api/markas/import` | POST | `app/api/markas/import/route.ts` | `app/master/marka/page.tsx` |
| `/api/parties` | GET, POST, PUT, DELETE | `app/api/parties/route.ts` | `app/master/party/page.tsx`<br/>`app/payment/cash-bank/entry/page.tsx`<br/>`app/payment/journal-voucher/entry/page.tsx`<br/>`app/payment/sales/entry/page.tsx`<br/>`app/sales/entry/page.tsx`<br/>`lib/permissions.ts`<br/>`lib/super-admin-master-registry.ts` |
| `/api/parties/import` | POST | `app/api/parties/import/route.ts` | `app/master/party/page.tsx` |
| `/api/payment-modes` | GET, POST, PUT, DELETE | `app/api/payment-modes/route.ts` | `app/master/payment-mode/page.tsx`<br/>`app/payment/cash-bank/entry/page.tsx`<br/>`app/payment/purchase/entry/page.tsx`<br/>`app/payment/sales/entry/page.tsx`<br/>`lib/permissions.ts`<br/>`lib/super-admin-master-registry.ts` |
| `/api/payment-modes/import` | POST | `app/api/payment-modes/import/route.ts` | `app/master/payment-mode/page.tsx` |
| `/api/payments` | POST, GET | `app/api/payments/route.ts` | `app/payment/cash-bank/entry/page.tsx`<br/>`app/payment/dashboard/PaymentDashboardClient.tsx`<br/>`app/payment/purchase/entry/page.tsx`<br/>`app/payment/sales/entry/page.tsx`<br/>`lib/permissions.ts` |
| `/api/payments/[id]` | PUT, DELETE | `app/api/payments/[id]/route.ts` | `app/payment/journal-voucher/entry/page.tsx`<br/>`app/payment/purchase/entry/page.tsx`<br/>`lib/client-payment-workspace.ts` |
| `/api/payments/[id]/status` | PATCH | `app/api/payments/[id]/status/route.ts` | (no direct client fetch found; server/internal use) |
| `/api/payments/allocate` | POST | `app/api/payments/allocate/route.ts` | `app/payment/purchase/entry/page.tsx` |
| `/api/payments/journal-vouchers` | GET, POST | `app/api/payments/journal-vouchers/route.ts` | `app/payment/journal-voucher/entry/page.tsx` |
| `/api/payments/workspace` | GET | `app/api/payments/workspace/route.ts` | `lib/client-payment-workspace.ts` |
| `/api/products` | GET, POST, PUT, DELETE | `app/api/products/route.ts` | `app/master/product/page.tsx`<br/>`app/master/purchase-item/page.tsx`<br/>`app/master/sales-item/page.tsx`<br/>`app/purchase/edit/page.tsx`<br/>`app/purchase/entry/page.tsx`<br/>`app/purchase/special-edit/page.tsx`<br/>`app/purchase/special-entry/page.tsx`<br/>`lib/permissions.ts`<br/>`lib/super-admin-master-registry.ts` |
| `/api/products/import` | POST | `app/api/products/import/route.ts` | `app/master/product/page.tsx` |
| `/api/profile` | GET, PATCH | `app/api/profile/route.ts` | `app/main/profile/page.tsx` |
| `/api/purchase-bills` | POST, GET, DELETE, PUT | `app/api/purchase-bills/route.ts` | `app/payment/purchase/entry/page.tsx`<br/>`app/purchase/edit/page.tsx`<br/>`app/purchase/entry/page.tsx`<br/>`app/purchase/list/PurchaseListClient.tsx`<br/>`app/purchase/view/page.tsx`<br/>`lib/permissions.ts` |
| `/api/purchase-bills/cancel` | POST | `app/api/purchase-bills/cancel/route.ts` | `app/purchase/list/PurchaseListClient.tsx`<br/>`app/purchase/view/page.tsx` |
| `/api/purchase-bills/import` | POST | `app/api/purchase-bills/import/route.ts` | (no direct client fetch found; server/internal use) |
| `/api/purchase-bills/template` | GET | `app/api/purchase-bills/template/route.ts` | (no direct client fetch found; server/internal use) |
| `/api/reports/dashboard` | GET | `app/api/reports/dashboard/route.ts` | `components/reports/ReportDashboard.tsx` |
| `/api/reports/operations` | GET | `app/api/reports/operations/route.ts` | `components/reports/OperationsReportWorkspace.tsx`<br/>`lib/server-page-workspaces.ts` |
| `/api/sales-bills` | POST, GET, PUT, DELETE | `app/api/sales-bills/route.ts` | `app/payment/sales/entry/page.tsx`<br/>`app/sales/entry/page.tsx`<br/>`app/sales/list/SalesListClient.tsx`<br/>`app/sales/view/page.tsx`<br/>`lib/permissions.ts` |
| `/api/sales-bills/cancel` | POST | `app/api/sales-bills/cancel/route.ts` | `app/sales/list/SalesListClient.tsx`<br/>`app/sales/view/page.tsx` |
| `/api/sales-bills/risk` | GET | `app/api/sales-bills/risk/route.ts` | `app/sales/entry/page.tsx` |
| `/api/sales-bills/splits` | GET, POST, DELETE | `app/api/sales-bills/splits/route.ts` | `components/sales/SalesInvoiceSplitDialog.tsx` |
| `/api/sales-bills/splits/preview` | POST | `app/api/sales-bills/splits/preview/route.ts` | `components/sales/SalesInvoiceSplitDialog.tsx` |
| `/api/sales-invoices` | GET, POST | `app/api/sales-invoices/route.ts` | `lib/permissions.ts` |
| `/api/sales-item-masters` | GET, POST, PUT, DELETE | `app/api/sales-item-masters/route.ts` | `app/master/sales-item/page.tsx`<br/>`app/sales/entry/page.tsx`<br/>`lib/permissions.ts`<br/>`lib/super-admin-master-registry.ts` |
| `/api/sales-item-masters/import` | POST | `app/api/sales-item-masters/import/route.ts` | `app/master/sales-item/page.tsx` |
| `/api/sales-items` | GET, POST, PUT, DELETE | `app/api/sales-items/route.ts` | `lib/permissions.ts` |
| `/api/security/csrf` | GET | `app/api/security/csrf/route.ts` | `app/AppShell.tsx`<br/>`app/payment/bank-statement/upload/BankStatementUploadClient.tsx`<br/>`lib/http/api-client.ts` |
| `/api/special-purchase-bills` | POST, GET, PUT, DELETE | `app/api/special-purchase-bills/route.ts` | `app/purchase/list/PurchaseListClient.tsx`<br/>`app/purchase/special-edit/page.tsx`<br/>`app/purchase/special-entry/page.tsx`<br/>`app/purchase/special-view/page.tsx`<br/>`lib/permissions.ts` |
| `/api/special-purchase-bills/cancel` | POST | `app/api/special-purchase-bills/cancel/route.ts` | `app/purchase/list/PurchaseListClient.tsx`<br/>`app/purchase/special-view/page.tsx` |
| `/api/stock-ledger` | POST, GET | `app/api/stock-ledger/route.ts` | `app/main/dashboard/components/StockManagementTab.tsx`<br/>`app/stock/adjustment/StockAdjustmentClient.tsx`<br/>`components/reports/StockReportDashboard.tsx`<br/>`lib/permissions.ts`<br/>`lib/server-page-workspaces.ts` |
| `/api/stock/adjustment` | POST | `app/api/stock/adjustment/route.ts` | `app/stock/adjustment/StockAdjustmentClient.tsx`<br/>`lib/permissions.ts` |
| `/api/subscription/actions` | POST | `app/api/subscription/actions/route.ts` | `components/subscription/SubscriptionOverview.tsx` |
| `/api/subscription/backups/[backupId]/download` | GET | `app/api/subscription/backups/[backupId]/download/route.ts` | (no direct client fetch found; server/internal use) |
| `/api/subscription/current` | GET | `app/api/subscription/current/route.ts` | `app/components/DashboardLayout.tsx`<br/>`components/subscription/SubscriptionOverview.tsx` |
| `/api/subscription/history` | GET | `app/api/subscription/history/route.ts` | `components/subscription/SubscriptionOverview.tsx` |
| `/api/super-admin` | GET, POST, PUT, DELETE | `app/api/super-admin/route.ts` | `app/AppShell.tsx`<br/>`app/super-admin/companies/[id]/page.tsx`<br/>`app/super-admin/companies/page.tsx`<br/>`app/super-admin/components/SuperAdminOverviewClient.tsx`<br/>`app/super-admin/crud/page.tsx`<br/>`app/super-admin/subscriptions/SubscriptionsClient.tsx`<br/>`app/super-admin/subscriptions/plans/page.tsx`<br/>`app/super-admin/traders/[id]/page.tsx`<br/>`app/super-admin/traders/page.tsx`<br/>`app/super-admin/users/[id]/page.tsx`<br/>`app/super-admin/users/page.tsx`<br/>`lib/http/api-client.ts` |
| `/api/super-admin/activity` | GET | `app/api/super-admin/activity/route.ts` | `app/super-admin/audit-logs/page.tsx` |
| `/api/super-admin/auth` | POST | `app/api/super-admin/auth/route.ts` | `app/AppShell.tsx`<br/>`app/super-admin/login/page.tsx` |
| `/api/super-admin/companies` | GET, POST | `app/api/super-admin/companies/route.ts` | `app/super-admin/companies/[id]/page.tsx`<br/>`app/super-admin/companies/page.tsx`<br/>`app/super-admin/components/SuperAdminOverviewClient.tsx`<br/>`app/super-admin/crud/page.tsx`<br/>`app/super-admin/users/page.tsx` |
| `/api/super-admin/companies/[id]` | GET, PUT, DELETE | `app/api/super-admin/companies/[id]/route.ts` | (no direct client fetch found; server/internal use) |
| `/api/super-admin/companies/[id]/lock` | PATCH | `app/api/super-admin/companies/[id]/lock/route.ts` | (no direct client fetch found; server/internal use) |
| `/api/super-admin/live-updates` | GET | `app/api/super-admin/live-updates/route.ts` | (no direct client fetch found; server/internal use) |
| `/api/super-admin/logout` | POST | `app/api/super-admin/logout/route.ts` | `app/super-admin/components/SuperAdminShell.tsx`<br/>`components/SessionProvider.tsx` |
| `/api/super-admin/me` | GET | `app/api/super-admin/me/route.ts` | (no direct client fetch found; server/internal use) |
| `/api/super-admin/onboard-trader` | POST | `app/api/super-admin/onboard-trader/route.ts` | (no direct client fetch found; server/internal use) |
| `/api/super-admin/overview` | GET | `app/api/super-admin/overview/route.ts` | `app/super-admin/components/SuperAdminOverviewClient.tsx` |
| `/api/super-admin/profile` | GET, PATCH | `app/api/super-admin/profile/route.ts` | `app/super-admin/components/SuperAdminShell.tsx`<br/>`app/super-admin/profile/page.tsx` |
| `/api/super-admin/refresh` | POST | `app/api/super-admin/refresh/route.ts` | `app/AppShell.tsx` |
| `/api/super-admin/stats` | GET | `app/api/super-admin/stats/route.ts` | `app/super-admin/crud/page.tsx` |
| `/api/super-admin/subscription-plans` | GET, POST | `app/api/super-admin/subscription-plans/route.ts` | `app/AppShell.tsx`<br/>`app/super-admin/subscriptions/SubscriptionsClient.tsx`<br/>`app/super-admin/subscriptions/plans/page.tsx`<br/>`app/super-admin/traders/page.tsx` |
| `/api/super-admin/subscription-plans/[id]` | GET, PUT | `app/api/super-admin/subscription-plans/[id]/route.ts` | (no direct client fetch found; server/internal use) |
| `/api/super-admin/trader-subscriptions` | GET | `app/api/super-admin/trader-subscriptions/route.ts` | `app/AppShell.tsx`<br/>`app/super-admin/subscriptions/SubscriptionsClient.tsx`<br/>`app/super-admin/traders/page.tsx` |
| `/api/super-admin/trader-subscriptions/[traderId]` | GET | `app/api/super-admin/trader-subscriptions/[traderId]/route.ts` | (no direct client fetch found; server/internal use) |
| `/api/super-admin/trader-subscriptions/[traderId]/actions` | POST | `app/api/super-admin/trader-subscriptions/[traderId]/actions/route.ts` | (no direct client fetch found; server/internal use) |
| `/api/super-admin/traders` | GET, POST | `app/api/super-admin/traders/route.ts` | `app/super-admin/companies/page.tsx`<br/>`app/super-admin/components/SuperAdminOverviewClient.tsx`<br/>`app/super-admin/crud/page.tsx`<br/>`app/super-admin/traders/[id]/page.tsx`<br/>`app/super-admin/traders/page.tsx`<br/>`app/super-admin/users/page.tsx` |
| `/api/super-admin/traders/[id]` | GET, PUT, DELETE | `app/api/super-admin/traders/[id]/route.ts` | (no direct client fetch found; server/internal use) |
| `/api/super-admin/traders/[id]/lock` | PATCH | `app/api/super-admin/traders/[id]/lock/route.ts` | (no direct client fetch found; server/internal use) |
| `/api/super-admin/users` | GET, POST | `app/api/super-admin/users/route.ts` | `app/super-admin/components/SuperAdminOverviewClient.tsx`<br/>`app/super-admin/crud/page.tsx`<br/>`app/super-admin/users/[id]/page.tsx`<br/>`app/super-admin/users/page.tsx` |
| `/api/super-admin/users/[id]` | GET, PUT, DELETE | `app/api/super-admin/users/[id]/route.ts` | (no direct client fetch found; server/internal use) |
| `/api/super-admin/users/[id]/companies` | DELETE | `app/api/super-admin/users/[id]/companies/route.ts` | (no direct client fetch found; server/internal use) |
| `/api/super-admin/users/[id]/lock` | PATCH | `app/api/super-admin/users/[id]/lock/route.ts` | (no direct client fetch found; server/internal use) |
| `/api/super-admin/users/[id]/permissions` | GET, PUT | `app/api/super-admin/users/[id]/permissions/route.ts` | (no direct client fetch found; server/internal use) |
| `/api/super-admin/users/permissions/bulk` | PUT | `app/api/super-admin/users/permissions/bulk/route.ts` | (no direct client fetch found; server/internal use) |
| `/api/suppliers` | GET, POST, PUT, DELETE | `app/api/suppliers/route.ts` | `app/master/supplier/page.tsx`<br/>`app/payment/cash-bank/entry/page.tsx`<br/>`app/purchase/special-edit/page.tsx`<br/>`app/purchase/special-entry/page.tsx`<br/>`lib/permissions.ts`<br/>`lib/super-admin-master-registry.ts` |
| `/api/suppliers/import` | POST | `app/api/suppliers/import/route.ts` | `app/master/supplier/page.tsx` |
| `/api/traders` | GET, POST, PUT, DELETE | `app/api/traders/route.ts` | `app/master/trader/page.tsx`<br/>`app/master/user/page.tsx` |
| `/api/transports` | GET, POST, PUT, DELETE | `app/api/transports/route.ts` | `app/master/transport/page.tsx`<br/>`app/sales/entry/page.tsx`<br/>`lib/permissions.ts`<br/>`lib/super-admin-master-registry.ts` |
| `/api/transports/import` | POST | `app/api/transports/import/route.ts` | `app/master/transport/page.tsx` |
| `/api/units` | GET, POST, PUT, DELETE, OPTIONS | `app/api/units/route.ts` | `app/master/product/page.tsx`<br/>`app/master/purchase-item/page.tsx`<br/>`app/master/unit/page.tsx`<br/>`app/purchase/entry/page.tsx`<br/>`app/purchase/special-entry/page.tsx`<br/>`lib/permissions.ts`<br/>`lib/super-admin-master-registry.ts` |
| `/api/units/import` | POST | `app/api/units/import/route.ts` | `app/master/unit/page.tsx` |
| `/api/users` | GET, POST, PUT, DELETE | `app/api/users/route.ts` | `app/master/user/page.tsx` |

## API Parameter Index (Auto-Extracted)

Heuristic extraction from route handlers. Verify request payload contracts in the linked `route.ts` files for strict validation rules.

<!-- API_PARAMETER_INDEX_START -->
| Endpoint | Path Params | Query Params | Body Params |
|---|---|---|---|
| `/api/accounting-heads` | - | `all`, `companyId`, `id` | - |
| `/api/auth/company` | - | - | `companyId` |
| `/api/auth/financial-year` | - | - | - |
| `/api/auth/login` | - | - | - |
| `/api/auth/logout` | - | - | - |
| `/api/auth/me` | - | - | - |
| `/api/auth/permissions` | - | `companyId`, `includeMeta` | - |
| `/api/auth/refresh` | - | - | - |
| `/api/auth` | - | - | - |
| `/api/bank-statements/batches/[batchId]/export` | `batchId` | - | - |
| `/api/bank-statements/batches/[batchId]/file` | `batchId` | - | - |
| `/api/bank-statements/batches/[batchId]/finalize` | `batchId` | - | - |
| `/api/bank-statements/batches/[batchId]/match` | `batchId` | - | - |
| `/api/bank-statements/batches/[batchId]/parse` | `batchId` | - | - |
| `/api/bank-statements/batches/[batchId]/post` | `batchId` | - | - |
| `/api/bank-statements/batches/[batchId]/reprocess` | `batchId` | - | - |
| `/api/bank-statements/batches/[batchId]` | `batchId` | `companyId` | - |
| `/api/bank-statements/batches` | - | - | - |
| `/api/bank-statements/lookups` | - | `companyId` | - |
| `/api/bank-statements/rows/[rowId]/draft` | `rowId` | - | - |
| `/api/bank-statements/rows/[rowId]/quick-create` | `rowId` | - | - |
| `/api/bank-statements/rows/[rowId]/review` | `rowId` | - | - |
| `/api/bank-statements/workspace` | - | `companyId` | - |
| `/api/banks/import` | - | - | - |
| `/api/banks` | - | `all`, `companyId`, `id` | - |
| `/api/companies` | - | `id`, `includeDeleted`, `traderId` | - |
| `/api/dashboard/stock-workspace` | - | `companyId` | - |
| `/api/farmers` | - | `all`, `companyId`, `id` | - |
| `/api/financial-years/[id]/activate` | `id` | - | - |
| `/api/financial-years/[id]/status` | `id` | - | - |
| `/api/financial-years` | - | `companyId`, `traderId` | - |
| `/api/live-updates` | - | `companyIds` | - |
| `/api/login` | - | - | - |
| `/api/main-dashboard/overview` | - | `companyId` | - |
| `/api/mandi-types` | - | `all`, `companyId`, `id` | - |
| `/api/markas/import` | - | - | - |
| `/api/markas` | - | `all`, `companyId`, `id` | - |
| `/api/parties/import` | - | `companyId` | - |
| `/api/parties` | - | `all`, `companyId`, `id`, `type` | - |
| `/api/payment-modes/import` | - | - | - |
| `/api/payment-modes` | - | `all`, `companyId`, `id` | - |
| `/api/payments/[id]` | `id` | - | - |
| `/api/payments/[id]/status` | `id` | - | - |
| `/api/payments/allocate` | - | - | - |
| `/api/payments/bank-statement/import` | - | - | - |
| `/api/payments/journal-vouchers` | - | `companyId`, `summary` | - |
| `/api/payments` | - | `billType`, `companyId`, `includeDeleted`, `view` | - |
| `/api/payments/workspace` | - | `companyId`, `includePaymentModes` | - |
| `/api/products/import` | - | - | - |
| `/api/products` | - | `all`, `id` | - |
| `/api/profile` | - | - | - |
| `/api/purchase-bills/cancel` | - | - | - |
| `/api/purchase-bills/import` | - | `companyId` | - |
| `/api/purchase-bills` | - | `billId`, `companyId`, `dateFrom`, `dateTo`, `includeCancelled`, `last`, `view` | - |
| `/api/purchase-bills/template` | - | `companyId` | - |
| `/api/reports/dashboard` | - | `companyId`, `reportType` | - |
| `/api/reports/operations` | - | `companyId`, `dateFrom`, `dateTo`, `partyId`, `view` | - |
| `/api/sales-bills/cancel` | - | - | - |
| `/api/sales-bills/risk` | - | `companyId`, `excludeBillId`, `partyId`, `pendingSaleAmount`, `referenceDate` | - |
| `/api/sales-bills` | - | `billId`, `companyId`, `includeCancelled`, `last`, `splitView`, `view` | - |
| `/api/sales-bills/splits/preview` | - | - | - |
| `/api/sales-bills/splits` | - | `billId`, `companyId`, `parentBillId` | - |
| `/api/sales-invoices` | - | `companyId`, `firmId` | - |
| `/api/sales-item-masters/import` | - | - | - |
| `/api/sales-item-masters` | - | `companyId`, `id` | - |
| `/api/sales-items` | - | `companyId`, `id` | - |
| `/api/security/csrf` | - | - | - |
| `/api/special-purchase-bills/cancel` | - | - | - |
| `/api/special-purchase-bills` | - | `billId`, `companyId`, `includeCancelled` | - |
| `/api/stock-ledger` | - | `companyId`, `includeMeta`, `includeRecent`, `mode`, `productId`, `recentLimit`, `type` | - |
| `/api/stock/adjustment` | - | - | - |
| `/api/subscription/actions` | - | - | - |
| `/api/subscription/backups/[backupId]/download` | `backupId` | - | - |
| `/api/subscription/current` | - | - | - |
| `/api/subscription/history` | - | - | - |
| `/api/super-admin/activity` | - | - | - |
| `/api/super-admin/auth` | - | - | `password`, `secondSecret`, `token`, `userId` |
| `/api/super-admin/companies/[id]/lock` | `id` | - | - |
| `/api/super-admin/companies/[id]` | `id` | `includeDeleted` | - |
| `/api/super-admin/companies` | - | `includeDeleted`, `traderId` | - |
| `/api/super-admin/live-updates` | - | - | - |
| `/api/super-admin/logout` | - | - | - |
| `/api/super-admin/me` | - | - | - |
| `/api/super-admin/onboard-trader` | - | - | - |
| `/api/super-admin/overview` | - | `companyId`, `includeDeleted`, `sections`, `traderId`, `userId` | - |
| `/api/super-admin/profile` | - | - | - |
| `/api/super-admin/refresh` | - | - | - |
| `/api/super-admin` | - | - | - |
| `/api/super-admin/stats` | - | - | - |
| `/api/super-admin/subscription-plans/[id]` | `id` | - | - |
| `/api/super-admin/subscription-plans` | - | `includeInactive` | - |
| `/api/super-admin/trader-subscriptions/[traderId]/actions` | `traderId` | - | - |
| `/api/super-admin/trader-subscriptions/[traderId]` | `traderId` | - | - |
| `/api/super-admin/trader-subscriptions` | - | `expiringWithinDays`, `includeLocked`, `query`, `state` | - |
| `/api/super-admin/traders/[id]/lock` | `id` | - | - |
| `/api/super-admin/traders/[id]` | `id` | `includeDeleted` | - |
| `/api/super-admin/traders` | - | `includeDeleted` | - |
| `/api/super-admin/users/[id]/companies` | `id` | `companyId` | - |
| `/api/super-admin/users/[id]/lock` | `id` | - | - |
| `/api/super-admin/users/[id]/permissions` | `id` | `companyId` | - |
| `/api/super-admin/users/[id]` | `id` | `includeDeleted` | - |
| `/api/super-admin/users/permissions/bulk` | - | - | - |
| `/api/super-admin/users` | - | `companyId`, `includeDeleted`, `traderId` | - |
| `/api/suppliers/import` | - | - | - |
| `/api/suppliers` | - | `all`, `companyId`, `id` | - |
| `/api/traders` | - | - | - |
| `/api/transports/import` | - | - | - |
| `/api/transports` | - | `all`, `companyId`, `id` | - |
| `/api/units/import` | - | - | - |
| `/api/units` | - | `all`, `companyId`, `id` | - |
| `/api/users` | - | - | - |
<!-- API_PARAMETER_INDEX_END -->

## Auth Payload Contracts (Important)

Use these request bodies for integration clients (Flutter/Postman/etc.):

### `POST /api/auth/login` (also mapped from `POST /api/auth`)

- Required body fields:
  - `userId` (string)
  - `password` (string)
- Optional body fields:
  - `traderId` (string; recommended when user IDs may overlap across traders)
  - `captchaToken` (string; required only when API returns `requiresCaptcha: true`)

Example:

```json
{
  "userId": "operator01",
  "password": "your-password",
  "traderId": "TRADER_001"
}
```

### `POST /api/super-admin/auth`

- Common required field:
  - `userId` (string)
- Optional compatibility field:
  - `secondSecret` (string; only validated when configured server-side)

Action-specific body:

1. `action: "setup_2fa"`
   - Required: `userId`, `password`
   - Response includes `qrCode`, `otpauthUrl`, `requiresTwoFactorSetup: true`
2. `action: "verify_2fa"`
   - Required: `userId`, `token`
   - Enables 2FA after OTP verification
3. `action: "login"` (default when action omitted)
   - Required: `userId`, `password`
   - Also requires `token` when 2FA is enabled

Examples:

```json
{
  "action": "setup_2fa",
  "userId": "SUPERADMIN",
  "password": "your-password"
}
```

```json
{
  "action": "verify_2fa",
  "userId": "SUPERADMIN",
  "token": "123456"
}
```

```json
{
  "action": "login",
  "userId": "SUPERADMIN",
  "password": "your-password",
  "token": "123456"
}
```

## Notes

- Endpoints with dynamic params (example: `[id]`, `[batchId]`) can still be consumed by template-string URLs.
- "no direct client fetch found" usually means route is called by server-side loaders, middleware workflows, or admin-only tooling.
