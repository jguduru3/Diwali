-- Customer-facing packs: family, kids, economy and VIP join the existing kit types (bundles).
-- Additive only, so every kit a merchant already listed keeps its type.
ALTER TABLE "items" DROP CONSTRAINT IF EXISTS "items_kit_fields";--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "items_kit_fields" CHECK (
  ("kind" = 'product' AND "kit_type" IS NULL AND "contents" IS NULL)
  OR ("kind" = 'kit' AND "kit_type" IN ('family', 'kids', 'economy', 'vip', 'budget_1000', 'kit_2000', 'gift', 'special') AND "contents" IS NOT NULL)
);
