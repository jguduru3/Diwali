-- Every product gets two photos: the box closed (image_path) and the box open (image_open_path).
ALTER TABLE "items" ADD COLUMN IF NOT EXISTS "image_open_path" text;
