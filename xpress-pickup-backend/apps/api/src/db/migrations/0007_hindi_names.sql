ALTER TABLE "categories" ADD COLUMN IF NOT EXISTS "name_hi" text;--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN IF NOT EXISTS "name_hi" text;--> statement-breakpoint
ALTER TABLE "order_lines" ADD COLUMN IF NOT EXISTS "name_hi" text;
