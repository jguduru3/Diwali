// Merchant documents: owners upload and replace them on the Licence tab; admins verify or reject.
import type { HttpRequest, HttpResponseInit } from '@azure/functions';
import { and, desc, eq, isNull } from 'drizzle-orm';
import {
  DOC_STATUSES,
  documentDecisionSchema,
  documentRejectSchema,
  documentSubmitSchema,
} from '@pataka/shared';
import { z } from 'zod';
import { getDb } from '../db/client';
import { shopDocuments, shops } from '../db/schema';
import { requireShop, requireUuidParam } from '../lib/access';
import { requireRole } from '../lib/auth';
import {
  adminDocumentView,
  decideDocument,
  documentFile,
  documentSlots,
  submitDocument,
} from '../lib/documents';
import { HttpError } from '../lib/errors';
import { http, json, parseBody } from '../lib/http';
import { rateLimit } from '../lib/rateLimit';

/** GET /api/shop/documents — the five categories with the current upload of each (owner). */
export async function shopDocumentsHandler(req: HttpRequest): Promise<HttpResponseInit> {
  const db = getDb();
  const { shop } = await requireShop(db, req, { setup: true, ownerOnly: true });
  return json(await documentSlots(db, shop.id));
}

/** POST /api/shop/documents/new — upload or replace one category; starts as pending. */
export async function shopDocumentSubmitHandler(req: HttpRequest): Promise<HttpResponseInit> {
  const db = getDb();
  const { user, shop } = await requireShop(db, req, { setup: true, ownerOnly: true });
  await rateLimit(db, `doc-upload:${shop.id}`, 40, 3600);
  const input = await parseBody(req, documentSubmitSchema);
  return json(await submitDocument(db, shop, user.id, input), 201);
}

/** GET /api/shop/documents/{id}/file — the owner's own uploaded file. */
export async function shopDocumentFileHandler(req: HttpRequest): Promise<HttpResponseInit> {
  const db = getDb();
  const { shop } = await requireShop(db, req, { setup: true, ownerOnly: true });
  const [row] = await db
    .select()
    .from(shopDocuments)
    .where(
      and(eq(shopDocuments.id, requireUuidParam(req, 'id')), eq(shopDocuments.shopId, shop.id)),
    );
  if (!row) throw new HttpError(404, 'document_not_found', 'No such document');
  return documentFile(row);
}

const admin = (req: HttpRequest) => requireRole(getDb(), req, ['admin']);
const statusFilter = z.enum(DOC_STATUSES).optional();

/** GET /api/console/documents?status=&shop= — current uploads, oldest pending first. */
export async function consoleDocumentsHandler(req: HttpRequest): Promise<HttpResponseInit> {
  await admin(req);
  const db = getDb();
  const status = statusFilter.parse(req.query.get('status') || undefined);
  const code = req.query.get('shop')?.trim().toUpperCase() || null;
  const rows = await db
    .select({ d: shopDocuments, shop: shops })
    .from(shopDocuments)
    .innerJoin(shops, eq(shops.id, shopDocuments.shopId))
    .where(
      and(
        isNull(shopDocuments.supersededAt),
        status ? eq(shopDocuments.status, status) : undefined,
        code ? eq(shops.shortCode, code) : undefined,
      ),
    )
    .orderBy(status === 'pending' ? shopDocuments.createdAt : desc(shopDocuments.createdAt))
    .limit(500);
  return json(rows.map((r) => adminDocumentView(r.d, r.shop)));
}

/** GET /api/console/documents/{id}/file — any upload (current or replaced), admins only. */
export async function consoleDocumentFileHandler(req: HttpRequest): Promise<HttpResponseInit> {
  await admin(req);
  const [row] = await getDb()
    .select()
    .from(shopDocuments)
    .where(eq(shopDocuments.id, requireUuidParam(req, 'id')));
  if (!row) throw new HttpError(404, 'document_not_found', 'No such document');
  return documentFile(row);
}

export async function consoleDocumentVerifyHandler(req: HttpRequest): Promise<HttpResponseInit> {
  const user = await admin(req);
  const { notes } = await parseBody(req, documentDecisionSchema);
  return json(
    await decideDocument(getDb(), user.id, requireUuidParam(req, 'id'), 'verified', notes || null),
  );
}

export async function consoleDocumentRejectHandler(req: HttpRequest): Promise<HttpResponseInit> {
  const user = await admin(req);
  const { notes } = await parseBody(req, documentRejectSchema);
  return json(
    await decideDocument(getDb(), user.id, requireUuidParam(req, 'id'), 'rejected', notes),
  );
}

http('shopDocuments', ['GET'], 'shop/documents', shopDocumentsHandler);
http('shopDocumentSubmit', ['POST'], 'shop/documents/new', shopDocumentSubmitHandler);
http('shopDocumentFile', ['GET'], 'shop/documents/{id}/file', shopDocumentFileHandler);
http('consoleDocuments', ['GET'], 'console/documents', consoleDocumentsHandler);
http('consoleDocumentFile', ['GET'], 'console/documents/{id}/file', consoleDocumentFileHandler);
http(
  'consoleDocumentVerify',
  ['POST'],
  'console/documents/{id}/verify',
  consoleDocumentVerifyHandler,
);
http(
  'consoleDocumentReject',
  ['POST'],
  'console/documents/{id}/reject',
  consoleDocumentRejectHandler,
);
