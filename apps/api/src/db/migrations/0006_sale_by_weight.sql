CREATE TYPE "public"."sale_unit" AS ENUM('pack', 'kg', 'mix_kg');--> statement-breakpoint
ALTER TYPE "public"."line_status" ADD VALUE 'weight_proposed';--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "sale_unit" "sale_unit" DEFAULT 'pack' NOT NULL;--> statement-breakpoint
ALTER TABLE "order_lines" ADD COLUMN "sale_unit" "sale_unit" DEFAULT 'pack' NOT NULL;--> statement-breakpoint
ALTER TABLE "order_lines" ADD COLUMN "ordered_grams" integer;--> statement-breakpoint
ALTER TABLE "order_lines" ADD COLUMN "packed_grams" integer;--> statement-breakpoint
ALTER TABLE "order_lines" ADD COLUMN "proposed_grams" integer;--> statement-breakpoint
ALTER TABLE "order_lines" ADD COLUMN "mix_item_ids" uuid[];--> statement-breakpoint
ALTER TABLE "order_lines" ADD CONSTRAINT "order_lines_weight" CHECK (("order_lines"."sale_unit" = 'pack') = ("order_lines"."ordered_grams" is null));