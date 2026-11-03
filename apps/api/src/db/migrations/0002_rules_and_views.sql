-- G7: items can never be created in, or moved into, a banned category.
CREATE OR REPLACE FUNCTION reject_banned_category() RETURNS trigger AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM categories c WHERE c.id = NEW.category_id AND c.is_banned) THEN
    RAISE EXCEPTION 'category % is banned', NEW.category_id USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER items_reject_banned_category
  BEFORE INSERT OR UPDATE OF category_id ON items
  FOR EACH ROW EXECUTE FUNCTION reject_banned_category();
--> statement-breakpoint
-- G6: the only source for public shop queries. A shop is visible only while it
-- is live AND has a verified licence valid today (Asia/Kolkata).
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
