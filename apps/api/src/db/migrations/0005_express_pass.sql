CREATE TYPE "public"."pass_status" AS ENUM('pending_payment', 'active', 'revoked', 'refund_pending', 'refunded');--> statement-breakpoint
CREATE TYPE "public"."payment_status" AS ENUM('created', 'captured', 'failed');--> statement-breakpoint
CREATE TYPE "public"."refund_status" AS ENUM('pending', 'processed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."scan_flag" AS ENUM('many_places', 'rapid_repeat', 'too_many_today');--> statement-breakpoint
CREATE TYPE "public"."scan_result" AS ENUM('valid', 'not_found', 'not_paid', 'expired', 'revoked', 'refunded');--> statement-breakpoint
CREATE TABLE "daily_shop_stats" (
	"shop_id" uuid NOT NULL,
	"day" date NOT NULL,
	"scans" integer DEFAULT 0 NOT NULL,
	"unique_passes" integer DEFAULT 0 NOT NULL,
	"flagged" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "daily_shop_stats_shop_id_day_pk" PRIMARY KEY("shop_id","day")
);
--> statement-breakpoint
CREATE TABLE "pass_scans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pass_id" uuid,
	"shop_id" uuid,
	"cluster_id" uuid,
	"scanned_by" uuid NOT NULL,
	"result" "scan_result" NOT NULL,
	"flag" "scan_flag",
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pass_scans_one_place" CHECK (("pass_scans"."shop_id" is not null) <> ("pass_scans"."cluster_id" is not null))
);
--> statement-breakpoint
CREATE TABLE "passes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"ref" text NOT NULL,
	"status" "pass_status" DEFAULT 'pending_payment' NOT NULL,
	"secret_hash" text,
	"secret_rotated_at" timestamp with time zone,
	"fee_paise" integer NOT NULL,
	"paid_at" timestamp with time zone,
	"valid_from" timestamp with time zone,
	"valid_to" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"revoked_by" uuid,
	"revoke_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "passes_ref_unique" UNIQUE("ref"),
	CONSTRAINT "passes_secret_hash_unique" UNIQUE("secret_hash"),
	CONSTRAINT "passes_fee_positive" CHECK ("passes"."fee_paise" > 0)
);
--> statement-breakpoint
CREATE TABLE "payment_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" text NOT NULL,
	"event_id" text NOT NULL,
	"type" text NOT NULL,
	"payload_sha256" text NOT NULL,
	"outcome" text NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pass_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"checkout_id" text NOT NULL,
	"checkout_url" text NOT NULL,
	"provider_payment_id" text,
	"status" "payment_status" DEFAULT 'created' NOT NULL,
	"amount_paise" integer NOT NULL,
	"idempotency_key" text NOT NULL,
	"captured_at" timestamp with time zone,
	"failed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payments_idempotency_key_unique" UNIQUE("idempotency_key"),
	CONSTRAINT "payments_amount_positive" CHECK ("payments"."amount_paise" > 0)
);
--> statement-breakpoint
CREATE TABLE "refunds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"payment_id" uuid NOT NULL,
	"amount_paise" integer NOT NULL,
	"status" "refund_status" DEFAULT 'pending' NOT NULL,
	"provider_refund_id" text,
	"idempotency_key" text NOT NULL,
	"reason" text NOT NULL,
	"requested_by" uuid,
	"processed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "refunds_idempotency_key_unique" UNIQUE("idempotency_key"),
	CONSTRAINT "refunds_amount_positive" CHECK ("refunds"."amount_paise" > 0)
);
--> statement-breakpoint
ALTER TABLE "daily_shop_stats" ADD CONSTRAINT "daily_shop_stats_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pass_scans" ADD CONSTRAINT "pass_scans_pass_id_passes_id_fk" FOREIGN KEY ("pass_id") REFERENCES "public"."passes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pass_scans" ADD CONSTRAINT "pass_scans_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pass_scans" ADD CONSTRAINT "pass_scans_cluster_id_clusters_id_fk" FOREIGN KEY ("cluster_id") REFERENCES "public"."clusters"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pass_scans" ADD CONSTRAINT "pass_scans_scanned_by_users_id_fk" FOREIGN KEY ("scanned_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "passes" ADD CONSTRAINT "passes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "passes" ADD CONSTRAINT "passes_revoked_by_users_id_fk" FOREIGN KEY ("revoked_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_pass_id_passes_id_fk" FOREIGN KEY ("pass_id") REFERENCES "public"."passes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "pass_scans_pass_at" ON "pass_scans" USING btree ("pass_id","at");--> statement-breakpoint
CREATE INDEX "pass_scans_shop_at" ON "pass_scans" USING btree ("shop_id","at");--> statement-breakpoint
CREATE INDEX "pass_scans_cluster_at" ON "pass_scans" USING btree ("cluster_id","at");--> statement-breakpoint
CREATE UNIQUE INDEX "one_open_pass" ON "passes" USING btree ("user_id") WHERE status in ('pending_payment','active');--> statement-breakpoint
CREATE UNIQUE INDEX "payment_events_provider_event" ON "payment_events" USING btree ("provider","event_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payments_provider_checkout" ON "payments" USING btree ("provider","checkout_id");--> statement-breakpoint
CREATE INDEX "payments_pass_idx" ON "payments" USING btree ("pass_id");--> statement-breakpoint
CREATE UNIQUE INDEX "one_live_refund" ON "refunds" USING btree ("payment_id") WHERE status in ('pending','processed');