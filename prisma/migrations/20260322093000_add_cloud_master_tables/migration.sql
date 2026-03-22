CREATE TABLE "Bank" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "branch" TEXT,
  "ifscCode" TEXT NOT NULL,
  "accountNumber" TEXT,
  "address" TEXT,
  "phone" TEXT,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "Bank_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Marka" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "markaNumber" TEXT NOT NULL,
  "description" TEXT,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "Marka_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PaymentMode" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "description" TEXT,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "PaymentMode_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Bank_companyId_name_ifscCode_key" ON "Bank"("companyId", "name", "ifscCode");
CREATE INDEX "idx_banks_company_name" ON "Bank"("companyId", "name");

CREATE UNIQUE INDEX "Marka_companyId_markaNumber_key" ON "Marka"("companyId", "markaNumber");
CREATE INDEX "idx_markas_company_number" ON "Marka"("companyId", "markaNumber");

CREATE UNIQUE INDEX "PaymentMode_companyId_code_key" ON "PaymentMode"("companyId", "code");
CREATE INDEX "idx_payment_modes_company_name" ON "PaymentMode"("companyId", "name");

ALTER TABLE "Bank" ADD CONSTRAINT "Bank_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Marka" ADD CONSTRAINT "Marka_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PaymentMode" ADD CONSTRAINT "PaymentMode_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
