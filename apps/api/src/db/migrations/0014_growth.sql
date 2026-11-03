-- Growth program (agents, influencers, wallets, referrals, credits, merchant subscription, kits)
-- and G7 amended: a green certificate is optional (the platform sells all kinds of goods).

-- ---- Items: optional green certificate, kits ----
ALTER TABLE "items" ALTER COLUMN "green_cert" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "items" ALTER COLUMN "green_ref" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "items" DROP CONSTRAINT IF EXISTS "items_green_ref_present";--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "items_green_ref_present" CHECK ("green_ref" IS NULL OR length(trim("green_ref")) >= 2);--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN IF NOT EXISTS "kind" text DEFAULT 'product' NOT NULL;--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN IF NOT EXISTS "kit_type" text;--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN IF NOT EXISTS "contents" jsonb;--> statement-breakpoint
ALTER TABLE "items" DROP CONSTRAINT IF EXISTS "items_kit_fields";--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "items_kit_fields" CHECK (
  ("kind" = 'product' AND "kit_type" IS NULL AND "contents" IS NULL)
  OR ("kind" = 'kit' AND "kit_type" IN ('budget_1000', 'kit_2000', 'family', 'gift', 'special') AND "contents" IS NOT NULL)
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "items_kit_type" ON "items" ("kit_type") WHERE "kind" = 'kit' AND "removed_at" IS NULL;--> statement-breakpoint

-- ---- Users, orders ----
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "referral_code" text;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "users_referral_code_unique" ON "users" ("referral_code");--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "credit_requested_paise" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" DROP CONSTRAINT IF EXISTS "orders_credit_requested_nonneg";--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_credit_requested_nonneg" CHECK ("credit_requested_paise" >= 0);--> statement-breakpoint

-- ---- Agents and influencers ----
CREATE TABLE IF NOT EXISTS "agents" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL UNIQUE REFERENCES "users"("id"),
  "code" text NOT NULL UNIQUE,
  "name" text NOT NULL,
  "status" text DEFAULT 'pending' NOT NULL,
  "recruited_by_influencer_id" uuid,
  "agreement_version" text NOT NULL,
  "agreement_accepted_at" timestamp with time zone NOT NULL,
  "approved_by" uuid REFERENCES "users"("id"),
  "approved_at" timestamp with time zone,
  "suspended_reason" text,
  "lang" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "agents_code_format" CHECK ("code" ~ '^DXA-[0-9A-HJKMNP-TV-Z]{6}$'),
  CONSTRAINT "agents_status" CHECK ("status" IN ('pending', 'active', 'suspended'))
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "influencers" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL UNIQUE REFERENCES "users"("id"),
  "code" text NOT NULL UNIQUE,
  "handle" text NOT NULL,
  "platform" text NOT NULL,
  "status" text DEFAULT 'pending' NOT NULL,
  "agreement_version" text NOT NULL,
  "agreement_accepted_at" timestamp with time zone NOT NULL,
  "approved_by" uuid REFERENCES "users"("id"),
  "approved_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "influencers_code_format" CHECK ("code" ~ '^DXI-[0-9A-HJKMNP-TV-Z]{6}$'),
  CONSTRAINT "influencers_status" CHECK ("status" IN ('pending', 'active', 'suspended'))
);--> statement-breakpoint
ALTER TABLE "agents" DROP CONSTRAINT IF EXISTS "agents_recruiter_fk";--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_recruiter_fk" FOREIGN KEY ("recruited_by_influencer_id") REFERENCES "influencers"("id");--> statement-breakpoint

-- ---- Shops: agent onboarding ----
ALTER TABLE "shops" ADD COLUMN IF NOT EXISTS "onboarding_status" text DEFAULT 'live' NOT NULL;--> statement-breakpoint
ALTER TABLE "shops" ADD COLUMN IF NOT EXISTS "onboarded_by_agent_id" uuid REFERENCES "agents"("id");--> statement-breakpoint
ALTER TABLE "shops" ADD COLUMN IF NOT EXISTS "owner_name" text;--> statement-breakpoint
ALTER TABLE "shops" ADD COLUMN IF NOT EXISTS "owner_phone_e164" text;--> statement-breakpoint
ALTER TABLE "shops" ADD COLUMN IF NOT EXISTS "gstin" text;--> statement-breakpoint
ALTER TABLE "shops" DROP CONSTRAINT IF EXISTS "shops_onboarding_status";--> statement-breakpoint
ALTER TABLE "shops" ADD CONSTRAINT "shops_onboarding_status" CHECK ("onboarding_status" IN ('draft', 'consented', 'setup', 'review', 'approved', 'live', 'closed'));--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "shops_owner_phone_open" ON "shops" ("owner_phone_e164") WHERE "onboarding_status" <> 'closed';--> statement-breakpoint
-- G6: a shop an agent is still setting up is never listed, even with a verified licence.
DROP VIEW IF EXISTS "visible_shops";--> statement-breakpoint
CREATE VIEW visible_shops AS
SELECT s.*
FROM shops s
WHERE s.is_live
  AND s.onboarding_status = 'live'
  AND EXISTS (
    SELECT 1 FROM shop_licences l
    WHERE l.shop_id = s.id
      AND l.status = 'verified'
      AND (now() AT TIME ZONE 'Asia/Kolkata')::date BETWEEN coalesce(l.valid_from, l.valid_to) AND l.valid_to
  );--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "shop_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "shop_id" uuid NOT NULL REFERENCES "shops"("id"),
  "actor_user_id" uuid REFERENCES "users"("id"),
  "type" text NOT NULL,
  "meta" jsonb,
  "at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "shop_events_shop" ON "shop_events" ("shop_id", "at");--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "owner_links" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "shop_id" uuid NOT NULL REFERENCES "shops"("id"),
  "purpose" text NOT NULL,
  "token_hash" text NOT NULL UNIQUE,
  "code_hash" text,
  "attempts" integer DEFAULT 0 NOT NULL,
  "locked_until" timestamp with time zone,
  "expires_at" timestamp with time zone NOT NULL,
  "used_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "owner_links_purpose" CHECK ("purpose" IN ('consent', 'review'))
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "owner_links_shop" ON "owner_links" ("shop_id", "purpose");--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "shop_consents" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "shop_id" uuid NOT NULL UNIQUE REFERENCES "shops"("id"),
  "agent_id" uuid REFERENCES "agents"("id"),
  "method" text NOT NULL,
  "device" text,
  "at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "shop_consents_method" CHECK ("method" IN ('otp', 'link'))
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "merchant_subscriptions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "shop_id" uuid NOT NULL REFERENCES "shops"("id"),
  "season" text NOT NULL,
  "amount_paise" integer NOT NULL,
  "gst_paise" integer NOT NULL,
  "status" text DEFAULT 'pending' NOT NULL,
  "method" text NOT NULL,
  "provider" text,
  "checkout_id" text,
  "checkout_url" text,
  "provider_payment_id" text,
  "offline_reference" text,
  "marked_by" uuid REFERENCES "users"("id"),
  "invoice_no" text UNIQUE,
  "paid_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "merchant_subscriptions_status" CHECK ("status" IN ('pending', 'paid', 'refunded', 'cancelled')),
  CONSTRAINT "merchant_subscriptions_method" CHECK ("method" IN ('online', 'offline'))
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "merchant_subscriptions_checkout" ON "merchant_subscriptions" ("provider", "checkout_id");--> statement-breakpoint
CREATE SEQUENCE IF NOT EXISTS "merchant_invoice_seq";--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "merchant_subscriptions_one_paid" ON "merchant_subscriptions" ("shop_id", "season") WHERE "status" = 'paid';--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "agent_payouts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "agent_id" uuid NOT NULL REFERENCES "agents"("id"),
  "shop_id" uuid NOT NULL UNIQUE REFERENCES "shops"("id"),
  "amount_paise" integer NOT NULL,
  "status" text DEFAULT 'credited' NOT NULL,
  "earned_at" timestamp with time zone DEFAULT now() NOT NULL,
  "reversed_at" timestamp with time zone,
  CONSTRAINT "agent_payouts_status" CHECK ("status" IN ('credited', 'reversed'))
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "agent_payouts_once" ON "agent_payouts" ("agent_id", "shop_id");--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "agent_feedback" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "agent_id" uuid NOT NULL REFERENCES "agents"("id"),
  "shop_id" uuid NOT NULL REFERENCES "shops"("id"),
  "helped" boolean NOT NULL,
  "note" text,
  "at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "agent_feedback_once" ON "agent_feedback" ("agent_id", "shop_id");--> statement-breakpoint

-- ---- Wallets (agents and influencers) ----
CREATE TABLE IF NOT EXISTS "wallets" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL UNIQUE REFERENCES "users"("id"),
  "upi_enc" text NOT NULL,
  "upi_hash" text NOT NULL UNIQUE,
  "upi_hint" text NOT NULL,
  "pan_enc" text,
  "pan_last4" text,
  "frozen" boolean DEFAULT false NOT NULL,
  "frozen_reason" text,
  "failed_transfers" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "wallet_ledger" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "wallet_id" uuid NOT NULL REFERENCES "wallets"("id"),
  "delta_paise" integer NOT NULL,
  "reason" text NOT NULL,
  "ref_id" text NOT NULL,
  "fy" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "wallet_ledger_nonzero" CHECK ("delta_paise" <> 0),
  CONSTRAINT "wallet_ledger_reason" CHECK ("reason" IN ('onboarding', 'referral_reward', 'recruit_reward', 'withdrawal', 'return', 'reversal'))
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "wallet_ledger_once" ON "wallet_ledger" ("reason", "ref_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "wallet_ledger_wallet" ON "wallet_ledger" ("wallet_id", "created_at");--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "withdrawals" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "wallet_id" uuid NOT NULL REFERENCES "wallets"("id"),
  "amount_paise" integer NOT NULL,
  "tds_paise" integer DEFAULT 0 NOT NULL,
  "tds_base_paise" integer DEFAULT 0 NOT NULL,
  "fy" text NOT NULL,
  "status" text DEFAULT 'requested' NOT NULL,
  "provider" text NOT NULL,
  "provider_ref" text,
  "utr" text,
  "day_ist" date NOT NULL,
  "idempotency_key" text NOT NULL UNIQUE,
  "failure_reason" text,
  "decided_by" uuid REFERENCES "users"("id"),
  "sent_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "withdrawals_amount_positive" CHECK ("amount_paise" > 0),
  CONSTRAINT "withdrawals_status" CHECK ("status" IN ('requested', 'sent', 'failed'))
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "withdrawals_wallet_day" ON "withdrawals" ("wallet_id", "day_ist");--> statement-breakpoint

-- ---- Referrals and customer credit ----
CREATE TABLE IF NOT EXISTS "referrals" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "referrer_user_id" uuid NOT NULL REFERENCES "users"("id"),
  "referee_user_id" uuid NOT NULL UNIQUE REFERENCES "users"("id"),
  "source" text NOT NULL,
  "code" text NOT NULL,
  "status" text DEFAULT 'pending' NOT NULL,
  "qualifying_order_id" uuid REFERENCES "orders"("id"),
  "rewarded_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "referrals_not_self" CHECK ("referrer_user_id" <> "referee_user_id"),
  CONSTRAINT "referrals_source" CHECK ("source" IN ('customer', 'influencer')),
  CONSTRAINT "referrals_status" CHECK ("status" IN ('pending', 'rewarded', 'reversed', 'rejected'))
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "referrals_referrer" ON "referrals" ("referrer_user_id");--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "credit_ledger" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id"),
  "delta_paise" integer NOT NULL,
  "reason" text NOT NULL,
  "ref_id" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "credit_ledger_nonzero" CHECK ("delta_paise" <> 0),
  CONSTRAINT "credit_ledger_reason" CHECK ("reason" IN ('referral', 'reversal', 'hold', 'release', 'expiry'))
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "credit_ledger_once" ON "credit_ledger" ("reason", "ref_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "credit_ledger_user" ON "credit_ledger" ("user_id", "created_at");--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "credit_redemptions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "order_id" uuid NOT NULL UNIQUE REFERENCES "orders"("id"),
  "shop_id" uuid NOT NULL REFERENCES "shops"("id"),
  "user_id" uuid NOT NULL REFERENCES "users"("id"),
  "amount_paise" integer NOT NULL,
  "status" text DEFAULT 'held' NOT NULL,
  "settlement_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "credit_redemptions_positive" CHECK ("amount_paise" > 0),
  CONSTRAINT "credit_redemptions_status" CHECK ("status" IN ('held', 'redeemed', 'released'))
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "credit_redemptions_shop" ON "credit_redemptions" ("shop_id", "status");--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "merchant_settlements" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "shop_id" uuid NOT NULL REFERENCES "shops"("id"),
  "mode" text NOT NULL,
  "period_start" date,
  "period_end" date,
  "amount_paise" integer NOT NULL,
  "status" text DEFAULT 'pending' NOT NULL,
  "upi_hint" text,
  "utr" text,
  "paid_by" uuid REFERENCES "users"("id"),
  "paid_at" timestamp with time zone,
  "requested_day" date,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "merchant_settlements_positive" CHECK ("amount_paise" > 0),
  CONSTRAINT "merchant_settlements_mode" CHECK ("mode" IN ('weekly', 'requested')),
  CONSTRAINT "merchant_settlements_status" CHECK ("status" IN ('pending', 'paid'))
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "merchant_settlements_one_request_a_day" ON "merchant_settlements" ("shop_id", "requested_day") WHERE "mode" = 'requested';--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "merchant_settlements_one_week" ON "merchant_settlements" ("shop_id", "period_start") WHERE "mode" = 'weekly';--> statement-breakpoint
ALTER TABLE "credit_redemptions" DROP CONSTRAINT IF EXISTS "credit_redemptions_settlement_fk";--> statement-breakpoint
ALTER TABLE "credit_redemptions" ADD CONSTRAINT "credit_redemptions_settlement_fk" FOREIGN KEY ("settlement_id") REFERENCES "merchant_settlements"("id");--> statement-breakpoint

-- ---- Terms and notifications ----
CREATE TABLE IF NOT EXISTS "terms_acceptances" (
  "user_id" uuid NOT NULL REFERENCES "users"("id"),
  "party" text NOT NULL,
  "version" text NOT NULL,
  "accepted_at" timestamp with time zone DEFAULT now() NOT NULL,
  PRIMARY KEY ("user_id", "party", "version")
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "notifications" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id"),
  "type" text NOT NULL,
  "params" jsonb,
  "read_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "notifications_user" ON "notifications" ("user_id", "created_at");
