-- Create Merchant table matching Prisma schema (merchant status enum stored as TEXT)
CREATE TABLE "Merchant" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "ownerUserId" text NOT NULL,
  "name" text NOT NULL,
  "description" text NULL,
  "commissionRate" double precision NOT NULL,
  "customerDiscountRate" double precision NOT NULL,
  "status" text NOT NULL DEFAULT 'DRAFT',
  "createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Merchant_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Merchant_ownerUserId_index" ON "Merchant" ("ownerUserId");
