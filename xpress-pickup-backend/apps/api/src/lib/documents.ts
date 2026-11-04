// Merchant documents: the owner uploads one current file per category (a newer upload
// replaces it and the old one is kept for the record); a platform admin verifies or rejects.
import { randomUUID } from 'node:crypto';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import {
  DOC_NEEDS_EXPIRY,
  istDate,
  MERCHANT_DOC_TYPES,
  type AdminDocument,
  type DocumentSubmit,
  type MerchantDocType,
  type ShopDocument,
  type ShopDocumentSlot,
} from '@pataka/shared';
import type { Db } from '../db/client';
import { shopDocuments, shops } from '../db/schema';
import { audit } from './audit';
import { HttpError } from './errors';
import { fileStore, sniffImage } from './storage';

type DocRow = typeof shopDocuments.$inferSelect;
type ShopRow = typeof shops.$inferSelect;

/** Documents live in the PRIVATE licences store, beside the licence photos. */
export const documentPath = (shopId: string, id: string, ext: string) =>
  `docs/${shopId}/${id}.${ext}`;

const EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
};

/** Magic bytes decide the type: a JPEG/PNG/WebP photo or a PDF scan. */
export function sniffDocument(data: Buffer): keyof typeof EXT | null {
  if (data.subarray(0, 5).toString('ascii') === '%PDF-') return 'application/pdf';
  return sniffImage(data);
}

export function documentView(row: DocRow, today = istDate()): ShopDocument {
  return {
    id: row.id,
    docType: row.docType,
    docNumber: row.docNumber,
    issuedBy: row.issuedBy,
    validFrom: row.validFrom,
    validTo: row.validTo,
    status: row.status,
    notes: row.notes,
    contentType: row.contentType as ShopDocument['contentType'],
    sizeBytes: row.sizeBytes,
    uploadedAt: row.createdAt.toISOString(),
    verifiedAt: row.verifiedAt?.toISOString() ?? null,
    isExpired: DOC_NEEDS_EXPIRY[row.docType] && !!row.validTo && row.validTo < today,
  };
}

export const adminDocumentView = (row: DocRow, shop: ShopRow): AdminDocument => ({
  ...documentView(row),
  shopId: shop.id,
  shopCode: shop.shortCode,
  shopName: shop.name,
});

/** One slot per category, in the fixed order, with the current upload if there is one. */
export async function documentSlots(db: Db, shopId: string): Promise<ShopDocumentSlot[]> {
  const rows = await db
    .select()
    .from(shopDocuments)
    .where(eq(shopDocuments.shopId, shopId))
    .orderBy(desc(shopDocuments.createdAt));
  return MERCHANT_DOC_TYPES.map((docType) => {
    const mine = rows.filter((r) => r.docType === docType);
    const current = mine.find((r) => !r.supersededAt);
    return {
      docType,
      current: current ? documentView(current) : null,
      replacedCount: mine.filter((r) => r.supersededAt).length,
    };
  });
}

/** Stores the file, supersedes the current upload of that category and starts a new pending one. */
export async function submitDocument(
  db: Db,
  shop: ShopRow,
  actorId: string,
  input: DocumentSubmit & { docType: MerchantDocType },
): Promise<ShopDocument> {
  const data = Buffer.from(input.file.base64, 'base64');
  const type = sniffDocument(data);
  if (!type) throw new HttpError(400, 'bad_document', 'Upload a PDF or a JPEG, PNG or WebP photo');
  const id = randomUUID();
  const path = documentPath(shop.id, id, EXT[type]!);
  await fileStore('licences').put(path, data, type);
  const row = await db.transaction(async (tx) => {
    // Serialise uploads for this shop so two at once cannot both become "current".
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`docs:${shop.id}`}))`);
    const [previous] = await tx
      .update(shopDocuments)
      .set({ supersededAt: new Date() })
      .where(
        and(
          eq(shopDocuments.shopId, shop.id),
          eq(shopDocuments.docType, input.docType),
          isNull(shopDocuments.supersededAt),
        ),
      )
      .returning({ id: shopDocuments.id, status: shopDocuments.status });
    const [created] = await tx
      .insert(shopDocuments)
      .values({
        id,
        shopId: shop.id,
        docType: input.docType,
        docNumber: input.docNumber,
        issuedBy: input.issuedBy || null,
        validFrom: input.validFrom ?? null,
        validTo: input.validTo ?? null,
        filePath: path,
        contentType: type,
        sizeBytes: data.length,
        uploadedBy: actorId,
      })
      .returning();
    await audit(tx, {
      actorUserId: actorId,
      action: previous ? 'document.replace' : 'document.submit',
      entity: 'shop_document',
      entityId: id,
      meta: {
        shopId: shop.id,
        docType: input.docType,
        ...(previous ? { replaces: previous.id, replacedStatus: previous.status } : {}),
      },
    });
    return created!;
  });
  return documentView(row);
}

/** Admin decision on the current upload: verify a pending one, or reject a pending or verified one. */
export async function decideDocument(
  db: Db,
  actorId: string,
  id: string,
  decision: 'verified' | 'rejected',
  notes: string | null,
): Promise<AdminDocument> {
  return db.transaction(async (tx) => {
    const allowed = decision === 'verified' ? ['pending'] : ['pending', 'verified'];
    const [row] = await tx
      .update(shopDocuments)
      .set({ status: decision, notes, verifiedBy: actorId, verifiedAt: new Date() })
      .where(
        and(
          eq(shopDocuments.id, id),
          isNull(shopDocuments.supersededAt),
          sql`${shopDocuments.status}::text = any(${`{${allowed.join(',')}}`}::text[])`,
        ),
      )
      .returning();
    if (!row) {
      const [exists] = await tx
        .select({ id: shopDocuments.id })
        .from(shopDocuments)
        .where(eq(shopDocuments.id, id));
      if (!exists) throw new HttpError(404, 'document_not_found', 'No such document');
      throw new HttpError(
        409,
        'document_not_reviewable',
        'This document was replaced or already decided; reload the list',
      );
    }
    await audit(tx, {
      actorUserId: actorId,
      action: `document.${decision}`,
      entity: 'shop_document',
      entityId: id,
      meta: { shopId: row.shopId, docType: row.docType, notes },
    });
    const [shop] = await tx.select().from(shops).where(eq(shops.id, row.shopId));
    return adminDocumentView(row, shop!);
  });
}

/** Private file response: never cached, never sniffed, PDFs shown sandboxed. */
export async function documentFile(row: DocRow) {
  const file = await fileStore('licences').get(row.filePath);
  if (!file) throw new HttpError(404, 'file_missing', 'Document file not found');
  return {
    status: 200,
    body: file.data,
    headers: {
      'Content-Type': row.contentType,
      'Content-Disposition': `inline; filename="${row.docType}-${row.id.slice(0, 8)}.${EXT[row.contentType] ?? 'bin'}"`,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
      // Photos open sandboxed. Chromium's built-in PDF viewer refuses sandboxed documents, so a
      // PDF relies on the browser's own PDF sandbox; its type comes from the file's bytes, never
      // from the client, and only the shop owner and admins can open it.
      ...(row.contentType === 'application/pdf'
        ? {}
        : {
            'Content-Security-Policy':
              "sandbox; default-src 'none'; img-src 'self'; style-src 'unsafe-inline'",
          }),
    },
  };
}
