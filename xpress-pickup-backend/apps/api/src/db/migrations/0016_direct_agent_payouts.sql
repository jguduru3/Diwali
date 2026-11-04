-- Owner's decision (3 November 2026): no referral network, influencers, customer credit or
-- wallets. Agents (gig workers) are paid each ₹1,000 directly to their own UPI ID; an admin
-- sends the transfer and records its UTR. TDS as approved by the CA: PAN from ₹18,000 earned in
-- a financial year, required from ₹20,000, 2% on the part above ₹20,000.

-- The agent keeps their UPI ID and PAN on the agent row (encrypted, G9).
ALTER TABLE "agents" ADD COLUMN IF NOT EXISTS "upi_enc" text;--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN IF NOT EXISTS "upi_hash" text;--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN IF NOT EXISTS "upi_hint" text;--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN IF NOT EXISTS "pan_enc" text;--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN IF NOT EXISTS "pan_last4" text;--> statement-breakpoint
UPDATE "agents" a SET "upi_enc" = w."upi_enc", "upi_hash" = w."upi_hash", "upi_hint" = w."upi_hint",
  "pan_enc" = w."pan_enc", "pan_last4" = w."pan_last4"
  FROM "wallets" w WHERE w."user_id" = a."user_id";--> statement-breakpoint
UPDATE "agents" SET "upi_enc" = 'removed', "upi_hash" = 'removed:' || "id", "upi_hint" = '—'
  WHERE "upi_enc" IS NULL;--> statement-breakpoint
ALTER TABLE "agents" ALTER COLUMN "upi_enc" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "agents" ALTER COLUMN "upi_hash" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "agents" ALTER COLUMN "upi_hint" SET NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "agents_upi_hash" ON "agents" ("upi_hash");--> statement-breakpoint
ALTER TABLE "agents" DROP COLUMN IF EXISTS "recruited_by_influencer_id";--> statement-breakpoint

-- Payouts are transfers now: pending → sent (UTR) or failed (back to pending on retry);
-- reversed when the shop's subscription is refunded or the licence fails.
ALTER TABLE "agent_payouts" DROP CONSTRAINT IF EXISTS "agent_payouts_status";--> statement-breakpoint
ALTER TABLE "agent_payouts" ADD COLUMN IF NOT EXISTS "fy" text;--> statement-breakpoint
ALTER TABLE "agent_payouts" ADD COLUMN IF NOT EXISTS "tds_paise" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_payouts" ADD COLUMN IF NOT EXISTS "tds_base_paise" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_payouts" ADD COLUMN IF NOT EXISTS "utr" text;--> statement-breakpoint
ALTER TABLE "agent_payouts" ADD COLUMN IF NOT EXISTS "sent_at" timestamptz;--> statement-breakpoint
ALTER TABLE "agent_payouts" ADD COLUMN IF NOT EXISTS "decided_by" uuid REFERENCES "users"("id");--> statement-breakpoint
ALTER TABLE "agent_payouts" ADD COLUMN IF NOT EXISTS "failure_reason" text;--> statement-breakpoint
ALTER TABLE "agent_payouts" ADD COLUMN IF NOT EXISTS "failed_attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_payouts" ADD COLUMN IF NOT EXISTS "reversal_reason" text;--> statement-breakpoint
UPDATE "agent_payouts" SET "status" = 'pending' WHERE "status" = 'credited';--> statement-breakpoint
UPDATE "agent_payouts" SET "fy" = CASE
    WHEN to_char("earned_at" AT TIME ZONE 'Asia/Kolkata', 'MM') >= '04'
      THEN to_char("earned_at" AT TIME ZONE 'Asia/Kolkata', 'YYYY') || '-' ||
           lpad(((to_char("earned_at" AT TIME ZONE 'Asia/Kolkata', 'YYYY')::int + 1) % 100)::text, 2, '0')
    ELSE (to_char("earned_at" AT TIME ZONE 'Asia/Kolkata', 'YYYY')::int - 1)::text || '-' ||
           to_char("earned_at" AT TIME ZONE 'Asia/Kolkata', 'YY')
  END
  WHERE "fy" IS NULL;--> statement-breakpoint
ALTER TABLE "agent_payouts" ALTER COLUMN "fy" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_payouts" ALTER COLUMN "status" SET DEFAULT 'pending';--> statement-breakpoint
ALTER TABLE "agent_payouts" ADD CONSTRAINT "agent_payouts_status"
  CHECK ("status" IN ('pending', 'sent', 'failed', 'reversed'));--> statement-breakpoint
ALTER TABLE "agent_payouts" ADD CONSTRAINT "agent_payouts_tds"
  CHECK ("tds_paise" >= 0 AND "tds_paise" <= "amount_paise");--> statement-breakpoint
ALTER TABLE "agent_payouts" ADD CONSTRAINT "agent_payouts_sent_has_utr"
  CHECK ("status" <> 'sent' OR "utr" IS NOT NULL);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_payouts_agent_fy" ON "agent_payouts" ("agent_id", "fy");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_payouts_status_idx" ON "agent_payouts" ("status", "earned_at");--> statement-breakpoint

-- The referral network, customer credit, credit settlements, influencers and wallets go.
DROP TABLE IF EXISTS "credit_redemptions";--> statement-breakpoint
DROP TABLE IF EXISTS "merchant_settlements";--> statement-breakpoint
DROP TABLE IF EXISTS "credit_ledger";--> statement-breakpoint
DROP TABLE IF EXISTS "referrals";--> statement-breakpoint
DROP TABLE IF EXISTS "withdrawals";--> statement-breakpoint
DROP TABLE IF EXISTS "wallet_ledger";--> statement-breakpoint
DROP TABLE IF EXISTS "wallets";--> statement-breakpoint
DROP TABLE IF EXISTS "influencers";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN IF EXISTS "referral_code";--> statement-breakpoint
ALTER TABLE "orders" DROP COLUMN IF EXISTS "credit_requested_paise";--> statement-breakpoint
DELETE FROM "terms_acceptances" WHERE "party" IN ('influencer', 'referral');--> statement-breakpoint
DELETE FROM "notifications" WHERE "type" LIKE 'wallet.%' OR "type" LIKE 'referral.%'
  OR "type" LIKE 'settlement.%' OR "type" LIKE 'credit.%';
