-- Sale mode: every product is sold either at MRP (normal / pack) or by weight (kilo sale). Never null.
DO $$ BEGIN
  CREATE TYPE "public"."sale_mode" AS ENUM('mrp', 'kilo');
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN IF NOT EXISTS "sale_mode" "sale_mode" DEFAULT 'mrp' NOT NULL;--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN IF NOT EXISTS "price_per_kg_paise" integer;--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN IF NOT EXISTS "offer_price_per_kg_paise" integer;--> statement-breakpoint
-- Products saved as kilo packs before this release: the stored pack price stays as it is; the
-- rate per kg is worked out from it so the owner sees it on the form.
UPDATE "items" SET
  "sale_mode" = 'kilo',
  "price_per_kg_paise" = round("price_paise" * 1000.0 / "weight_grams"),
  "offer_price_per_kg_paise" = CASE WHEN "offer_price_paise" IS NULL THEN NULL
    ELSE round("offer_price_paise" * 1000.0 / "weight_grams") END
WHERE "weight_grams" IS NOT NULL AND "sale_mode" = 'mrp';--> statement-breakpoint
UPDATE "items" SET "offer_price_per_kg_paise" = "price_per_kg_paise" - 1
WHERE "sale_mode" = 'kilo' AND "offer_price_per_kg_paise" >= "price_per_kg_paise";--> statement-breakpoint
ALTER TABLE "items" DROP CONSTRAINT IF EXISTS "items_sale_mode_fields";--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "items_sale_mode_fields" CHECK (
  ("sale_mode" = 'mrp' AND "weight_grams" IS NULL AND "price_per_kg_paise" IS NULL AND "offer_price_per_kg_paise" IS NULL)
  OR ("sale_mode" = 'kilo' AND "weight_grams" IS NOT NULL AND "price_per_kg_paise" > 0
      AND ("offer_price_per_kg_paise" IS NULL OR ("offer_price_per_kg_paise" > 0 AND "offer_price_per_kg_paise" < "price_per_kg_paise")))
);--> statement-breakpoint
-- Automatic barcodes: every product that is not removed gets an in-store EAN-13 (prefix 20).
-- barcode_source: 'box' = printed on the box (must be scanned at packing), 'store' = generated
-- by the platform (scanned from the printed label, or confirmed by hand as before).
ALTER TABLE "items" ADD COLUMN IF NOT EXISTS "barcode_source" text DEFAULT 'box' NOT NULL;--> statement-breakpoint
ALTER TABLE "items" DROP CONSTRAINT IF EXISTS "items_barcode_source";--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "items_barcode_source" CHECK ("barcode_source" IN ('store', 'box'));--> statement-breakpoint
CREATE OR REPLACE FUNCTION "pp_store_barcode"() RETURNS text LANGUAGE plpgsql VOLATILE AS $$
DECLARE body text := '20'; s int := 0; i int;
BEGIN
  FOR i IN 1..10 LOOP body := body || floor(random() * 10)::int::text; END LOOP;
  FOR i IN 1..12 LOOP s := s + substr(body, i, 1)::int * CASE WHEN i % 2 = 1 THEN 1 ELSE 3 END; END LOOP;
  RETURN body || ((10 - s % 10) % 10)::text;
END $$;--> statement-breakpoint
DO $$
DECLARE r record; done boolean;
BEGIN
  FOR r IN SELECT "id" FROM "items" WHERE "barcode" IS NULL AND "removed_at" IS NULL LOOP
    done := false;
    WHILE NOT done LOOP
      BEGIN
        UPDATE "items" SET "barcode" = pp_store_barcode(), "barcode_source" = 'store' WHERE "id" = r."id";
        done := true;
      EXCEPTION WHEN unique_violation THEN done := false;
      END;
    END LOOP;
  END LOOP;
END $$;--> statement-breakpoint
ALTER TABLE "items" DROP CONSTRAINT IF EXISTS "items_barcode_present";--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "items_barcode_present" CHECK ("removed_at" IS NOT NULL OR "barcode" IS NOT NULL);--> statement-breakpoint
-- Merchant documents: five categories besides the trading licence, each checked by an admin.
DO $$ BEGIN
  CREATE TYPE "public"."merchant_doc_type" AS ENUM('fire_licence', 'police_clearance', 'govt_authority_licence', 'gst_certificate', 'business_registration');
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE "public"."doc_status" AS ENUM('pending', 'verified', 'rejected');
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "shop_documents" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "shop_id" uuid NOT NULL REFERENCES "shops"("id"),
  "doc_type" "merchant_doc_type" NOT NULL,
  "doc_number" text NOT NULL,
  "issued_by" text,
  "valid_from" date,
  "valid_to" date,
  "file_path" text NOT NULL,
  "content_type" text NOT NULL,
  "size_bytes" integer NOT NULL,
  "status" "doc_status" DEFAULT 'pending' NOT NULL,
  "notes" text,
  "uploaded_by" uuid NOT NULL REFERENCES "users"("id"),
  "verified_by" uuid REFERENCES "users"("id"),
  "verified_at" timestamp with time zone,
  "superseded_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "shop_documents_dates" CHECK ("valid_from" IS NULL OR "valid_to" IS NULL OR "valid_from" <= "valid_to"),
  CONSTRAINT "shop_documents_size" CHECK ("size_bytes" > 0),
  CONSTRAINT "shop_documents_rejected_reason" CHECK ("status" <> 'rejected' OR length(trim(coalesce("notes", ''))) >= 3)
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "shop_documents_one_current" ON "shop_documents" ("shop_id", "doc_type") WHERE "superseded_at" IS NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "shop_documents_status_idx" ON "shop_documents" ("status", "created_at") WHERE "superseded_at" IS NULL;--> statement-breakpoint
-- Each person's language, so the app opens in it on any device.
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "lang" text;--> statement-breakpoint
ALTER TABLE "users" DROP CONSTRAINT IF EXISTS "users_lang_supported";--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_lang_supported" CHECK ("lang" IS NULL OR "lang" IN ('en', 'te', 'hi'));
