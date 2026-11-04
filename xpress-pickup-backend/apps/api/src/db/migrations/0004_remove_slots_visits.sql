-- SPEC_V2: slot booking removed. visible_shops (s.*) depends on the dropped shop
-- columns, so it is dropped first and recreated unchanged at the end.
DROP VIEW "visible_shops";--> statement-breakpoint
DROP TABLE "daily_shop_stats" CASCADE;--> statement-breakpoint
DROP TABLE "slots" CASCADE;--> statement-breakpoint
DROP TABLE "visits" CASCADE;--> statement-breakpoint
ALTER TABLE "clusters" DROP COLUMN "bay_count";--> statement-breakpoint
ALTER TABLE "shops" DROP COLUMN "slot_minutes";--> statement-breakpoint
ALTER TABLE "shops" DROP COLUMN "default_capacity_per_slot";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "no_show_strikes";--> statement-breakpoint
DROP TYPE "public"."visit_status";;--> statement-breakpoint
-- G6: the only source for public shop queries (same rule as migration 0002).
CREATE VIEW visible_shops AS
SELECT s.*
FROM shops s
WHERE s.is_live
  AND EXISTS (
    SELECT 1 FROM shop_licences l
    WHERE l.shop_id = s.id
      AND l.status = 'verified'
      AND (now() AT TIME ZONE 'Asia/Kolkata')::date BETWEEN coalesce(l.valid_from, l.valid_to) AND l.valid_to
  );