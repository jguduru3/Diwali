import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import type { AdminDocument, ShopDocument, ShopDocumentSlot } from '@pataka/shared';
import { getDb } from '../src/db/client';
import { auditLog, shopDocuments } from '../src/db/schema';
import {
  consoleDocumentFileHandler,
  consoleDocumentRejectHandler,
  consoleDocumentsHandler,
  consoleDocumentVerifyHandler,
  shopDocumentFileHandler,
  shopDocumentsHandler,
  shopDocumentSubmitHandler,
} from '../src/functions/documents';
import { body, call, errorCode, makeListedShop, makeUser } from './helpers';

const pdf = Buffer.from(`%PDF-1.4\n${'0'.repeat(200)}\n%%EOF`).toString('base64');
const png =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg=='.repeat(
    2,
  );

const upload = (session: string, extra: Record<string, unknown>) =>
  call(shopDocumentSubmitHandler, {
    method: 'POST',
    session,
    body: {
      docType: 'fire_licence',
      docNumber: 'TSFS/HYD/2026/0441',
      issuedBy: 'Telangana State Fire Services',
      validFrom: '2026-10-01',
      validTo: '2026-11-30',
      file: { contentType: 'application/pdf', base64: pdf },
      ...extra,
    },
  });

const slots = async (session: string) =>
  body<ShopDocumentSlot[]>(await call(shopDocumentsHandler, { session }));

describe('merchant documents', () => {
  it('lists all five categories, empty at first', async () => {
    const { owner } = await makeListedShop();
    const list = await slots(owner.session);
    expect(list.map((s) => s.docType)).toEqual([
      'fire_licence',
      'police_clearance',
      'govt_authority_licence',
      'gst_certificate',
      'business_registration',
    ]);
    expect(list.every((s) => s.current === null && s.replacedCount === 0)).toBe(true);
  });

  it('owner uploads a PDF or photo per category; it starts pending and is audited', async () => {
    const { owner } = await makeListedShop();
    const fire = await upload(owner.session, {});
    expect(fire.status).toBe(201);
    expect(body<ShopDocument>(fire)).toMatchObject({
      docType: 'fire_licence',
      status: 'pending',
      contentType: 'application/pdf',
      isExpired: false,
    });
    const gst = await upload(owner.session, {
      docType: 'gst_certificate',
      docNumber: '27aapfu0939f1zv',
      validFrom: undefined,
      validTo: undefined,
      file: { contentType: 'image/png', base64: png },
    });
    expect(gst.status).toBe(201);
    expect(body<ShopDocument>(gst)).toMatchObject({
      docNumber: '27AAPFU0939F1ZV',
      contentType: 'image/png',
    });
    const list = await slots(owner.session);
    expect(list.filter((s) => s.current).map((s) => s.docType)).toEqual([
      'fire_licence',
      'gst_certificate',
    ]);
    const [log] = await getDb()
      .select()
      .from(auditLog)
      .where(eq(auditLog.entityId, body<ShopDocument>(fire).id));
    expect(log).toMatchObject({ action: 'document.submit', entity: 'shop_document' });

    // the owner can open their own file; it is private and not cached
    const file = await call(shopDocumentFileHandler, {
      session: owner.session,
      params: { id: body<ShopDocument>(fire).id },
    });
    expect(file.status).toBe(200);
    expect((file.headers as Record<string, string>)['Cache-Control']).toBe('private, no-store');
    expect((file.headers as Record<string, string>)['Content-Type']).toBe('application/pdf');
  });

  it('refuses a bad GSTIN, a missing expiry and a file that is not a PDF or photo', async () => {
    const { owner } = await makeListedShop();
    expect(
      (await upload(owner.session, { docType: 'gst_certificate', docNumber: '27AAPFU0939F1ZX' }))
        .status,
    ).toBe(400);
    expect((await upload(owner.session, { validTo: undefined })).status).toBe(400);
    const html = Buffer.from(`<html>${'x'.repeat(200)}</html>`).toString('base64');
    expect(
      errorCode(
        await upload(owner.session, { file: { contentType: 'application/pdf', base64: html } }),
      ),
    ).toBe('bad_document');
  });

  it('only the owner of this shop uploads and reads; staff and other shops are refused', async () => {
    const { owner, staff } = await makeListedShop();
    const other = await makeListedShop('BAL01');
    const doc = body<ShopDocument>(await upload(owner.session, {}));
    expect((await upload(staff.session, {})).status).toBe(403);
    expect((await call(shopDocumentsHandler, { session: staff.session })).status).toBe(403);
    const foreign = await call(shopDocumentFileHandler, {
      session: other.owner.session,
      params: { id: doc.id },
    });
    expect(foreign.status).toBe(404);
    const customer = await makeUser('customer');
    expect((await call(consoleDocumentsHandler, { session: customer.session })).status).toBe(403);
  });

  it('admin verifies or rejects with a reason; a replacement starts pending again', async () => {
    const { owner } = await makeListedShop();
    const adminUser = await makeUser('admin');
    const first = body<ShopDocument>(await upload(owner.session, {}));

    const queue = body<AdminDocument[]>(
      await call(consoleDocumentsHandler, {
        session: adminUser.session,
        query: { status: 'pending' },
      }),
    );
    expect(queue.map((d) => d.id)).toContain(first.id);
    expect(queue.find((d) => d.id === first.id)).toMatchObject({ shopCode: 'SLC01' });

    const noReason = await call(consoleDocumentRejectHandler, {
      method: 'POST',
      session: adminUser.session,
      params: { id: first.id },
      body: {},
    });
    expect(noReason.status).toBe(400);
    const rejected = await call(consoleDocumentRejectHandler, {
      method: 'POST',
      session: adminUser.session,
      params: { id: first.id },
      body: { notes: 'Photo is blurred; licence number not readable' },
    });
    expect(body<AdminDocument>(rejected)).toMatchObject({
      status: 'rejected',
      notes: 'Photo is blurred; licence number not readable',
    });
    // a decided document cannot be verified without a new upload
    const late = await call(consoleDocumentVerifyHandler, {
      method: 'POST',
      session: adminUser.session,
      params: { id: first.id },
      body: {},
    });
    expect(errorCode(late)).toBe('document_not_reviewable');

    // owner replaces it: the old one is kept, the new one is current and pending
    const second = body<ShopDocument>(
      await upload(owner.session, { docNumber: 'TSFS/HYD/2026/0442' }),
    );
    const fire = (await slots(owner.session))[0]!;
    expect(fire).toMatchObject({ replacedCount: 1, current: { id: second.id, status: 'pending' } });
    const old = await call(consoleDocumentVerifyHandler, {
      method: 'POST',
      session: adminUser.session,
      params: { id: first.id },
      body: {},
    });
    expect(errorCode(old)).toBe('document_not_reviewable');
    const ok = await call(consoleDocumentVerifyHandler, {
      method: 'POST',
      session: adminUser.session,
      params: { id: second.id },
      body: {},
    });
    expect(body<AdminDocument>(ok).status).toBe('verified');
    // admins can still open the replaced file
    const oldFile = await call(consoleDocumentFileHandler, {
      session: adminUser.session,
      params: { id: first.id },
    });
    expect(oldFile.status).toBe(200);
    const rows = await getDb().select().from(shopDocuments).where(eq(shopDocuments.id, first.id));
    expect(rows[0]!.supersededAt).toBeInstanceOf(Date);
  });

  it('two uploads of one category at once leave exactly one current document', async () => {
    const { owner, shop } = await makeListedShop();
    const [a, b] = await Promise.all([upload(owner.session, {}), upload(owner.session, {})]);
    expect([a.status, b.status]).toEqual([201, 201]);
    const current = (
      await getDb().select().from(shopDocuments).where(eq(shopDocuments.shopId, shop.id))
    ).filter((r) => !r.supersededAt);
    expect(current).toHaveLength(1);
  });

  it('marks a licence past its valid-to date as expired', async () => {
    const { owner } = await makeListedShop();
    const doc = body<ShopDocument>(
      await upload(owner.session, { validFrom: '2025-10-01', validTo: '2025-11-30' }),
    );
    expect(doc.isExpired).toBe(true);
  });
});
