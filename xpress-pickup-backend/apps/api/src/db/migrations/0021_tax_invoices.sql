-- GST tax invoices: the customer's platform fee gets a number (XPF/<FY>/<serial>) when it is
-- paid. Subscriptions keep merchant_invoice_seq, now formatted XPS/<FY>/<serial>.
CREATE SEQUENCE IF NOT EXISTS "fee_invoice_seq";--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "fee_invoice_no" text;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "orders_fee_invoice_no" ON "orders" USING btree ("fee_invoice_no");
