ALTER TABLE "User" ADD COLUMN "twoFactorEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "User" ADD COLUMN "twoFactorSecret" TEXT;

CREATE INDEX "idx_users_two_factor_enabled" ON "User"("twoFactorEnabled");
