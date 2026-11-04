ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "pack_photo_path" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "pack_photo_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "pack_photo_by" uuid REFERENCES "users"("id");
