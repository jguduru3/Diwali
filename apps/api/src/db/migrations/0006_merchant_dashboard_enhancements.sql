ALTER TABLE "merchant_payment_settings" ADD COLUMN IF NOT EXISTS "qr_image_path" text;--> statement-breakpoint
ALTER TABLE "merchant_payment_settings" ADD COLUMN IF NOT EXISTS "qr_uploaded_by" uuid;--> statement-breakpoint
ALTER TABLE "merchant_payment_settings" ADD COLUMN IF NOT EXISTS "qr_uploaded_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "merchant_payment_settings" ADD COLUMN IF NOT EXISTS "qr_active" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "counter_payments" ADD COLUMN IF NOT EXISTS "verification_source" text DEFAULT 'manual';--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "merchant_payment_settings" ADD CONSTRAINT "merchant_payment_settings_qr_uploaded_by_users_id_fk" FOREIGN KEY ("qr_uploaded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

