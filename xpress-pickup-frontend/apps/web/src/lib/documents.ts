import type { DocStatus, ShopDocument } from '@pataka/shared';

/** What the owner and admin see: a verified document past its valid-to date shows as expired. */
export type Shown = DocStatus | 'missing' | 'expired';

export function shownStatus(doc: ShopDocument | null): Shown {
  if (!doc) return 'missing';
  if (doc.status === 'verified' && doc.isExpired) return 'expired';
  return doc.status;
}
