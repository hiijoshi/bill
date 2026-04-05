-- Trader-level subscription plans
CREATE TABLE "SubscriptionPlan" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "billingCycle" TEXT NOT NULL DEFAULT 'yearly',
    "amount" REAL NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "maxCompanies" INTEGER,
    "maxUsers" INTEGER,
    "defaultTrialDays" INTEGER,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isTrialCapable" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

CREATE TABLE "SubscriptionPlanFeature" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "planId" TEXT NOT NULL,
    "featureKey" TEXT NOT NULL,
    "featureLabel" TEXT NOT NULL,
    "description" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "SubscriptionPlanFeature_planId_fkey" FOREIGN KEY ("planId") REFERENCES "SubscriptionPlan" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- Trader subscription lifecycle records
CREATE TABLE "TraderSubscription" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "traderId" TEXT NOT NULL,
    "planId" TEXT,
    "subscriptionType" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "billingCycle" TEXT,
    "amount" REAL NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "planNameSnapshot" TEXT,
    "startDate" DATETIME NOT NULL,
    "endDate" DATETIME NOT NULL,
    "activatedAt" DATETIME,
    "expiredAt" DATETIME,
    "cancelledAt" DATETIME,
    "suspendedAt" DATETIME,
    "trialDays" INTEGER,
    "maxCompaniesOverride" INTEGER,
    "maxUsersOverride" INTEGER,
    "notes" TEXT,
    "assignedByUserId" TEXT,
    "updatedByUserId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "TraderSubscription_traderId_fkey" FOREIGN KEY ("traderId") REFERENCES "Trader" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TraderSubscription_planId_fkey" FOREIGN KEY ("planId") REFERENCES "SubscriptionPlan" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE "TraderSubscriptionFeature" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "subscriptionId" TEXT NOT NULL,
    "featureKey" TEXT NOT NULL,
    "featureLabel" TEXT NOT NULL,
    "description" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "TraderSubscriptionFeature_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "TraderSubscription" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- Manual payment history / gateway-ready ledger
CREATE TABLE "SubscriptionPayment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "traderId" TEXT NOT NULL,
    "traderSubscriptionId" TEXT,
    "planId" TEXT,
    "amount" REAL NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "status" TEXT NOT NULL DEFAULT 'confirmed',
    "paymentMode" TEXT NOT NULL DEFAULT 'manual',
    "referenceNo" TEXT,
    "paidAt" DATETIME,
    "confirmedAt" DATETIME,
    "confirmedByUserId" TEXT,
    "planNameSnapshot" TEXT,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "SubscriptionPayment_traderId_fkey" FOREIGN KEY ("traderId") REFERENCES "Trader" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SubscriptionPayment_traderSubscriptionId_fkey" FOREIGN KEY ("traderSubscriptionId") REFERENCES "TraderSubscription" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "SubscriptionPayment_planId_fkey" FOREIGN KEY ("planId") REFERENCES "SubscriptionPlan" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX "idx_subscription_plans_active_sort" ON "SubscriptionPlan"("isActive", "sortOrder");
CREATE INDEX "idx_subscription_plans_billing_cycle" ON "SubscriptionPlan"("billingCycle");

CREATE UNIQUE INDEX "uniq_subscription_plan_feature" ON "SubscriptionPlanFeature"("planId", "featureKey");
CREATE INDEX "idx_subscription_plan_features_key_enabled" ON "SubscriptionPlanFeature"("featureKey", "enabled");

CREATE INDEX "idx_trader_subscriptions_trader_status" ON "TraderSubscription"("traderId", "status");
CREATE INDEX "idx_trader_subscriptions_date_window" ON "TraderSubscription"("traderId", "startDate", "endDate");
CREATE INDEX "idx_trader_subscriptions_plan_id" ON "TraderSubscription"("planId");
CREATE INDEX "idx_trader_subscriptions_end_date" ON "TraderSubscription"("status", "endDate");
CREATE UNIQUE INDEX "uniq_active_trader_subscription" ON "TraderSubscription"("traderId") WHERE "status" IN ('pending', 'active', 'suspended');

CREATE UNIQUE INDEX "uniq_trader_subscription_feature" ON "TraderSubscriptionFeature"("subscriptionId", "featureKey");
CREATE INDEX "idx_trader_subscription_features_key_enabled" ON "TraderSubscriptionFeature"("featureKey", "enabled");

CREATE INDEX "idx_subscription_payments_trader_created_at" ON "SubscriptionPayment"("traderId", "createdAt");
CREATE INDEX "idx_subscription_payments_subscription_id" ON "SubscriptionPayment"("traderSubscriptionId");
CREATE INDEX "idx_subscription_payments_status_mode" ON "SubscriptionPayment"("status", "paymentMode");
