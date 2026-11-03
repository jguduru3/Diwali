CREATE TYPE "public"."green_cert_type" AS ENUM('CSIR_NEERI_SWAS', 'CSIR_NEERI_STAR', 'CSIR_NEERI_SAFAL', 'CSIR_NEERI_OTHER');--> statement-breakpoint
CREATE TYPE "public"."licence_status" AS ENUM('pending', 'verified', 'rejected', 'expired');--> statement-breakpoint
CREATE TYPE "public"."visit_status" AS ENUM('booked', 'arrived', 'served', 'no_show', 'cancelled');--> statement-breakpoint
CREATE TABLE "categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name_en" text NOT NULL,
	"name_te" text,
	"sort" integer DEFAULT 0 NOT NULL,
	"is_banned" boolean DEFAULT false NOT NULL,
	"banned_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "categories_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "daily_shop_stats" (
	"shop_id" uuid NOT NULL,
	"day" date NOT NULL,
	"booked" integer DEFAULT 0 NOT NULL,
	"arrived" integer DEFAULT 0 NOT NULL,
	"served" integer DEFAULT 0 NOT NULL,
	"no_show" integer DEFAULT 0 NOT NULL,
	"cancelled" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "daily_shop_stats_shop_id_day_pk" PRIMARY KEY("shop_id","day")
);
--> statement-breakpoint
CREATE TABLE "items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shop_id" uuid NOT NULL,
	"item_no" integer NOT NULL,
	"category_id" uuid NOT NULL,
	"name_en" text NOT NULL,
	"name_te" text,
	"pack_desc" text,
	"price_paise" integer NOT NULL,
	"green_cert" "green_cert_type" NOT NULL,
	"green_ref" text NOT NULL,
	"rack_code" text,
	"image_url" text,
	"is_sold_out" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "items_price_positive" CHECK ("items"."price_paise" > 0),
	CONSTRAINT "items_item_no_positive" CHECK ("items"."item_no" > 0),
	CONSTRAINT "items_green_ref_present" CHECK (length(trim("items"."green_ref")) >= 2)
);
--> statement-breakpoint
CREATE TABLE "shop_licences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shop_id" uuid NOT NULL,
	"licence_no" text NOT NULL,
	"licence_type" text NOT NULL,
	"issued_by" text,
	"valid_from" date,
	"valid_to" date NOT NULL,
	"image_blob_path" text NOT NULL,
	"status" "licence_status" DEFAULT 'pending' NOT NULL,
	"verified_by" uuid,
	"verified_at" timestamp with time zone,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shop_price_versions" (
	"shop_id" uuid PRIMARY KEY NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "slots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shop_id" uuid NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"capacity" integer NOT NULL,
	"booked" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "slots_booked_le_capacity" CHECK ("slots"."booked" <= "slots"."capacity"),
	CONSTRAINT "slots_booked_nonneg" CHECK ("slots"."booked" >= 0)
);
--> statement-breakpoint
CREATE TABLE "visits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" char(6) NOT NULL,
	"user_id" uuid NOT NULL,
	"shop_id" uuid NOT NULL,
	"slot_id" uuid NOT NULL,
	"status" "visit_status" DEFAULT 'booked' NOT NULL,
	"party_vehicle" text,
	"bay_no" integer,
	"arrived_at" timestamp with time zone,
	"served_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"no_show_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "visits_code_unique" UNIQUE("code")
);
--> statement-breakpoint
ALTER TABLE "daily_shop_stats" ADD CONSTRAINT "daily_shop_stats_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "items_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "items_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shop_licences" ADD CONSTRAINT "shop_licences_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shop_licences" ADD CONSTRAINT "shop_licences_verified_by_users_id_fk" FOREIGN KEY ("verified_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shop_price_versions" ADD CONSTRAINT "shop_price_versions_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slots" ADD CONSTRAINT "slots_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visits" ADD CONSTRAINT "visits_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visits" ADD CONSTRAINT "visits_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visits" ADD CONSTRAINT "visits_slot_id_slots_id_fk" FOREIGN KEY ("slot_id") REFERENCES "public"."slots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "items_shop_item_no" ON "items" USING btree ("shop_id","item_no");--> statement-breakpoint
CREATE INDEX "shop_licences_shop_idx" ON "shop_licences" USING btree ("shop_id");--> statement-breakpoint
CREATE UNIQUE INDEX "slots_shop_starts" ON "slots" USING btree ("shop_id","starts_at");--> statement-breakpoint
CREATE UNIQUE INDEX "one_active_visit" ON "visits" USING btree ("user_id") WHERE status in ('booked','arrived');--> statement-breakpoint
CREATE INDEX "visits_slot_idx" ON "visits" USING btree ("slot_id");--> statement-breakpoint
CREATE INDEX "visits_shop_idx" ON "visits" USING btree ("shop_id");--> statement-breakpoint
CREATE INDEX "otp_requests_phone_idx" ON "otp_requests" USING btree ("phone_e164","created_at");