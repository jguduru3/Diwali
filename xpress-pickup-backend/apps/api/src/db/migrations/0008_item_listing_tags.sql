ALTER TABLE "items" ADD COLUMN IF NOT EXISTS "is_recommended" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN IF NOT EXISTS "is_popular" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN IF NOT EXISTS "weight_grams" integer;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "items" ADD CONSTRAINT "items_weight_positive" CHECK ("items"."weight_grams" is null or "items"."weight_grams" > 0);
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
