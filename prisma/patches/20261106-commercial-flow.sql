-- Additive: historical requests retain NULL and the existing workflow.
ALTER TABLE "PurchaseRequest" ADD COLUMN IF NOT EXISTS "commercialFlow" JSONB;
