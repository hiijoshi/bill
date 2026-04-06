CREATE TABLE "FinancialYear" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "traderId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "startDate" DATETIME NOT NULL,
    "endDate" DATETIME NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'open',
    "activatedAt" DATETIME,
    "closedAt" DATETIME,
    "lockedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "FinancialYear_traderId_fkey" FOREIGN KEY ("traderId") REFERENCES "Trader" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "uniq_financial_years_trader_label" ON "FinancialYear"("traderId", "label");
CREATE UNIQUE INDEX "uniq_financial_years_trader_window" ON "FinancialYear"("traderId", "startDate", "endDate");
CREATE INDEX "idx_financial_years_trader_active_status" ON "FinancialYear"("traderId", "isActive", "status");
CREATE INDEX "idx_financial_years_trader_window" ON "FinancialYear"("traderId", "startDate", "endDate");
CREATE INDEX "idx_financial_years_trader_created" ON "FinancialYear"("traderId", "createdAt");
CREATE UNIQUE INDEX "uniq_financial_years_trader_active" ON "FinancialYear"("traderId") WHERE "isActive" = 1;

CREATE TRIGGER "trg_financial_year_validate_insert"
BEFORE INSERT ON "FinancialYear"
FOR EACH ROW
BEGIN
    SELECT
        CASE
            WHEN NEW."startDate" > NEW."endDate"
                THEN RAISE(ABORT, 'Financial year start date cannot be after end date')
            WHEN strftime('%m-%d', NEW."startDate") <> '04-01'
                THEN RAISE(ABORT, 'Financial year must start on 1 April')
            WHEN strftime('%m-%d', NEW."endDate") <> '03-31'
                THEN RAISE(ABORT, 'Financial year must end on 31 March')
            WHEN CAST(strftime('%Y', NEW."endDate") AS INTEGER) <> CAST(strftime('%Y', NEW."startDate") AS INTEGER) + 1
                THEN RAISE(ABORT, 'Financial year end date must be in the next calendar year')
            WHEN LOWER(NEW."status") NOT IN ('open', 'closed', 'locked')
                THEN RAISE(ABORT, 'Invalid financial year status')
        END;

    SELECT
        CASE
            WHEN EXISTS (
                SELECT 1
                FROM "FinancialYear" fy
                WHERE fy."traderId" = NEW."traderId"
                  AND NEW."startDate" <= fy."endDate"
                  AND NEW."endDate" >= fy."startDate"
            )
                THEN RAISE(ABORT, 'Financial year range overlaps an existing financial year')
        END;
END;

CREATE TRIGGER "trg_financial_year_validate_update"
BEFORE UPDATE ON "FinancialYear"
FOR EACH ROW
BEGIN
    SELECT
        CASE
            WHEN NEW."startDate" > NEW."endDate"
                THEN RAISE(ABORT, 'Financial year start date cannot be after end date')
            WHEN strftime('%m-%d', NEW."startDate") <> '04-01'
                THEN RAISE(ABORT, 'Financial year must start on 1 April')
            WHEN strftime('%m-%d', NEW."endDate") <> '03-31'
                THEN RAISE(ABORT, 'Financial year must end on 31 March')
            WHEN CAST(strftime('%Y', NEW."endDate") AS INTEGER) <> CAST(strftime('%Y', NEW."startDate") AS INTEGER) + 1
                THEN RAISE(ABORT, 'Financial year end date must be in the next calendar year')
            WHEN LOWER(NEW."status") NOT IN ('open', 'closed', 'locked')
                THEN RAISE(ABORT, 'Invalid financial year status')
        END;

    SELECT
        CASE
            WHEN EXISTS (
                SELECT 1
                FROM "FinancialYear" fy
                WHERE fy."traderId" = NEW."traderId"
                  AND fy."id" <> NEW."id"
                  AND NEW."startDate" <= fy."endDate"
                  AND NEW."endDate" >= fy."startDate"
            )
                THEN RAISE(ABORT, 'Financial year range overlaps an existing financial year')
        END;
END;
