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

## Notes

- Endpoints with dynamic params (example: `[id]`, `[batchId]`) can still be consumed by template-string URLs.
- "no direct client fetch found" usually means route is called by server-side loaders, middleware workflows, or admin-only tooling.
