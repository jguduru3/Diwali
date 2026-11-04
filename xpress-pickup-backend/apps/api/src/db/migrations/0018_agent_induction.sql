-- Agents finish a short induction before registering; record which version and when.
ALTER TABLE "agents" ADD COLUMN IF NOT EXISTS "induction_version" text;--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN IF NOT EXISTS "induction_completed_at" timestamp with time zone;
