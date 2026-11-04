CREATE TYPE "public"."counter_method" AS ENUM('upi', 'card', 'cash');--> statement-breakpoint
CREATE TYPE "public"."counter_payment_status" AS ENUM('pending', 'received', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."fee_payment_status" AS ENUM('created', 'captured', 'failed');--> statement-breakpoint
CREATE TYPE "public"."fee_refund_status" AS ENUM('pending', 'processed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."line_status" AS ENUM('pending', 'picked', 'out_of_stock', 'alternate_proposed', 'replaced', 'removed');--> statement-breakpoint
CREATE TYPE "public"."order_status" AS ENUM('fee_pending', 'placed', 'confirmed', 'packing', 'awaiting_customer', 'packed', 'completed', 'cancelled', 'rejected', 'expired');--> statement-breakpoint
ALTER TYPE "public"."user_role" ADD VALUE 'shop_packer';--> statement-breakpoint
ALTER TYPE "public"."user_role" ADD VALUE 'shop_cashier';--> statement-breakpoint
CREATE TABLE "counter_payment_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shop_id" uuid NOT NULL,
	"event_key" text NOT NULL,
	"payload_sha256" text NOT NULL,
	"outcome" text NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "counter_payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"method" "counter_method" NOT NULL,
	"status" "counter_payment_status" DEFAULT 'pending' NOT NULL,
	"amount_paise" integer NOT NULL,
	"reference" text,
	"utr" text,
	"pay_url" text,
	"received_paise" integer,
	"taken_by" uuid NOT NULL,
	"received_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "counter_payments_amount" CHECK ("counter_payments"."amount_paise" > 0)
);
--> statement-breakpoint
CREATE TABLE "daily_shop_stats" (
	"shop_id" uuid NOT NULL,
	"day" date NOT NULL,
	"orders" integer DEFAULT 0 NOT NULL,
	"completed" integer DEFAULT 0 NOT NULL,
	"cancelled" integer DEFAULT 0 NOT NULL,
	"sales_paise" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "daily_shop_stats_shop_id_day_pk" PRIMARY KEY("shop_id","day")
);
--> statement-breakpoint
CREATE TABLE "fee_payment_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" text NOT NULL,
	"event_id" text NOT NULL,
	"type" text NOT NULL,
	"payload_sha256" text NOT NULL,
	"outcome" text NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fee_payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"checkout_id" text NOT NULL,
	"checkout_url" text NOT NULL,
	"provider_payment_id" text,
	"status" "fee_payment_status" DEFAULT 'created' NOT NULL,
	"amount_paise" integer NOT NULL,
	"idempotency_key" text NOT NULL,
	"captured_at" timestamp with time zone,
	"failed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fee_payments_idempotency_key_unique" UNIQUE("idempotency_key"),
	CONSTRAINT "fee_payments_amount" CHECK ("fee_payments"."amount_paise" > 0)
);
--> statement-breakpoint
CREATE TABLE "fee_refunds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"fee_payment_id" uuid NOT NULL,
	"amount_paise" integer NOT NULL,
	"status" "fee_refund_status" DEFAULT 'pending' NOT NULL,
	"provider_refund_id" text,
	"idempotency_key" text NOT NULL,
	"reason" text NOT NULL,
	"requested_by" uuid,
	"processed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fee_refunds_idempotency_key_unique" UNIQUE("idempotency_key"),
	CONSTRAINT "fee_refunds_amount" CHECK ("fee_refunds"."amount_paise" > 0)
);
--> statement-breakpoint
CREATE TABLE "merchant_payment_settings" (
	"shop_id" uuid PRIMARY KEY NOT NULL,
	"youpi_base_url" text,
	"youpi_merchant_id" text,
	"youpi_webhook_secret_enc" text,
	"upi_vpa" text,
	"accepts_card" boolean DEFAULT true NOT NULL,
	"accepts_cash" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "order_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"actor_user_id" uuid,
	"type" text NOT NULL,
	"meta" jsonb,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "order_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"line_no" integer NOT NULL,
	"item_id" uuid NOT NULL,
	"item_no" integer NOT NULL,
	"name_en" text NOT NULL,
	"name_te" text,
	"pack_desc" text,
	"unit_price_paise" integer NOT NULL,
	"qty" integer NOT NULL,
	"status" "line_status" DEFAULT 'pending' NOT NULL,
	"picked_qty" integer DEFAULT 0 NOT NULL,
	"replaces_line_id" uuid,
	"alternate_item_id" uuid,
	"alternate_qty" integer,
	"alternate_price_paise" integer,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "order_lines_qty" CHECK ("order_lines"."qty" between 1 and 99),
	CONSTRAINT "order_lines_picked" CHECK ("order_lines"."picked_qty" between 0 and "order_lines"."qty"),
	CONSTRAINT "order_lines_price" CHECK ("order_lines"."unit_price_paise" > 0)
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"user_id" uuid NOT NULL,
	"shop_id" uuid NOT NULL,
	"status" "order_status" DEFAULT 'fee_pending' NOT NULL,
	"fee_paise" integer NOT NULL,
	"estimated_total_paise" integer NOT NULL,
	"final_total_paise" integer,
	"pack_no" integer,
	"pack_day" date,
	"customer_qr_hash" text,
	"pack_qr_hash" text,
	"pack_matched_at" timestamp with time zone,
	"fee_paid_at" timestamp with time zone,
	"confirm_by" timestamp with time zone,
	"confirmed_at" timestamp with time zone,
	"confirmed_by" uuid,
	"packing_started_at" timestamp with time zone,
	"packed_at" timestamp with time zone,
	"packed_by" uuid,
	"completed_at" timestamp with time zone,
	"completed_by" uuid,
	"cancelled_at" timestamp with time zone,
	"cancel_reason" text,
	"bill_no" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "orders_code_unique" UNIQUE("code"),
	CONSTRAINT "orders_customer_qr_hash_unique" UNIQUE("customer_qr_hash"),
	CONSTRAINT "orders_pack_qr_hash_unique" UNIQUE("pack_qr_hash"),
	CONSTRAINT "orders_fee_positive" CHECK ("orders"."fee_paise" > 0),
	CONSTRAINT "orders_totals_nonneg" CHECK ("orders"."estimated_total_paise" >= 0)
);
--> statement-breakpoint
CREATE TABLE "shop_counters" (
	"shop_id" uuid PRIMARY KEY NOT NULL,
	"last_bill_no" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "shop_members" DROP CONSTRAINT "shop_members_role";--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "image_path" text;--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "barcode" text;--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "stock_qty" integer;--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "offer_price_paise" integer;--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "offer_ends_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "counter_payment_events" ADD CONSTRAINT "counter_payment_events_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "counter_payments" ADD CONSTRAINT "counter_payments_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "counter_payments" ADD CONSTRAINT "counter_payments_taken_by_users_id_fk" FOREIGN KEY ("taken_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_shop_stats" ADD CONSTRAINT "daily_shop_stats_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_payments" ADD CONSTRAINT "fee_payments_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_refunds" ADD CONSTRAINT "fee_refunds_fee_payment_id_fee_payments_id_fk" FOREIGN KEY ("fee_payment_id") REFERENCES "public"."fee_payments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_refunds" ADD CONSTRAINT "fee_refunds_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merchant_payment_settings" ADD CONSTRAINT "merchant_payment_settings_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_events" ADD CONSTRAINT "order_events_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_lines" ADD CONSTRAINT "order_lines_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_lines" ADD CONSTRAINT "order_lines_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_lines" ADD CONSTRAINT "order_lines_alternate_item_id_items_id_fk" FOREIGN KEY ("alternate_item_id") REFERENCES "public"."items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_confirmed_by_users_id_fk" FOREIGN KEY ("confirmed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_packed_by_users_id_fk" FOREIGN KEY ("packed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_completed_by_users_id_fk" FOREIGN KEY ("completed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shop_counters" ADD CONSTRAINT "shop_counters_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "counter_payment_events_key" ON "counter_payment_events" USING btree ("shop_id","event_key");--> statement-breakpoint
CREATE INDEX "counter_payments_order" ON "counter_payments" USING btree ("order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "counter_payments_one_received" ON "counter_payments" USING btree ("order_id") WHERE status = 'received';--> statement-breakpoint
CREATE UNIQUE INDEX "fee_payment_events_provider_event" ON "fee_payment_events" USING btree ("provider","event_id");--> statement-breakpoint
CREATE UNIQUE INDEX "fee_payments_provider_checkout" ON "fee_payments" USING btree ("provider","checkout_id");--> statement-breakpoint
CREATE INDEX "fee_payments_order" ON "fee_payments" USING btree ("order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "fee_refunds_one_live" ON "fee_refunds" USING btree ("fee_payment_id") WHERE status in ('pending','processed');--> statement-breakpoint
CREATE INDEX "order_events_order" ON "order_events" USING btree ("order_id","at");--> statement-breakpoint
CREATE UNIQUE INDEX "order_lines_order_line_no" ON "order_lines" USING btree ("order_id","line_no");--> statement-breakpoint
CREATE INDEX "orders_shop_status" ON "orders" USING btree ("shop_id","status");--> statement-breakpoint
CREATE INDEX "orders_user" ON "orders" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "orders_pack_no" ON "orders" USING btree ("shop_id","pack_day","pack_no");--> statement-breakpoint
CREATE UNIQUE INDEX "orders_bill_no" ON "orders" USING btree ("shop_id","bill_no");--> statement-breakpoint
CREATE UNIQUE INDEX "items_shop_barcode" ON "items" USING btree ("shop_id","barcode");--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "items_stock_nonneg" CHECK ("items"."stock_qty" is null or "items"."stock_qty" >= 0);--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "items_offer_lower" CHECK ("items"."offer_price_paise" is null or ("items"."offer_price_paise" > 0 and "items"."offer_price_paise" < "items"."price_paise"));--> statement-breakpoint
ALTER TABLE "shop_members" ADD CONSTRAINT "shop_members_role" CHECK ("shop_members"."role"::text in ('shop_owner','shop_staff','shop_packer','shop_cashier'));