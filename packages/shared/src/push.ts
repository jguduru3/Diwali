import { z } from 'zod';
import { SUPPORTED_LANGUAGES } from './constants';

/** The two installable apps. A phone can have both, each with its own subscription. */
export const PUSH_APPS = ['customer', 'merchant'] as const;
export type PushApp = (typeof PUSH_APPS)[number];

/**
 * What a notification is about. The text for each lives in i18n (`push.<kind>`);
 * the service worker picks the language the subscription was made in.
 */
export const PUSH_KINDS = [
  // to the shop (owner, staff, packers)
  'new_order',
  'customer_answered',
  // to the customer
  'order_confirmed',
  'order_needs_answer',
  'order_packed',
  'order_completed',
  'order_rejected',
  'order_expired',
  'test',
] as const;
export type PushKind = (typeof PUSH_KINDS)[number];

const base64url = z.string().regex(/^[A-Za-z0-9_-]+={0,2}$/);

export const pushSubscribeSchema = z
  .object({
    endpoint: z
      .string()
      .url()
      .max(2048)
      .refine((u) => u.startsWith('https://'), 'Push endpoints are https'),
    keys: z.object({ p256dh: base64url.min(40).max(200), auth: base64url.min(8).max(64) }).strict(),
    app: z.enum(PUSH_APPS),
    lang: z.enum(SUPPORTED_LANGUAGES),
  })
  .strict();
export type PushSubscribeInput = z.infer<typeof pushSubscribeSchema>;

export const pushUnsubscribeSchema = z.object({ endpoint: z.string().max(2048) }).strict();

/**
 * What is sent to the phone. No personal data (G9): only the shop's name and
 * order/pack/bill numbers, which the person already sees in the app.
 */
export const pushPayloadSchema = z.object({
  kind: z.enum(PUSH_KINDS),
  lang: z.enum(SUPPORTED_LANGUAGES),
  url: z.string().startsWith('/'),
  tag: z.string().optional(),
  params: z.record(z.union([z.string(), z.number()])).default({}),
});
export type PushPayload = z.infer<typeof pushPayloadSchema>;

export const pushKeyResponseSchema = z.object({ publicKey: z.string().nullable() });

/** Fills `{{name}}` placeholders, as i18next does, for use in the service worker. */
export function fillTemplate(text: string, params: Record<string, string | number>): string {
  return text.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k: string) => String(params[k] ?? ''));
}
