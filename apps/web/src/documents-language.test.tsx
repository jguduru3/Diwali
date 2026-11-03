import { afterEach, describe, expect, it } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import type { AdminDocument, ShopDocumentSlot } from '@pataka/shared';
import { MERCHANT_DOC_TYPES } from '@pataka/shared';
import { setLanguage } from './i18n';
import { account, mockApi, SHOP_ID } from './test/mockApi';
import { renderAt } from './test/render';

const ctx = {
  shopCode: 'SLC01',
  name: 'Sri Lakshmi Crackers',
  area: 'Gachibowli',
  isLive: true,
  visible: true,
  openFrom: '10:00',
  openTo: '22:00',
  priceVersion: 3,
  canEdit: true,
  role: 'shop_owner' as const,
  cluster: null,
};

const doc = {
  id: '00000000-0000-4000-8000-000000000901',
  docType: 'fire_licence' as const,
  docNumber: 'TSFS/HYD/2026/0441',
  issuedBy: 'Telangana State Fire Services',
  validFrom: '2026-10-01',
  validTo: '2026-11-30',
  status: 'rejected' as const,
  notes: 'Photo is blurred.',
  contentType: 'application/pdf' as const,
  sizeBytes: 120_000,
  uploadedAt: '2026-11-02T10:00:00.000Z',
  verifiedAt: '2026-11-02T12:00:00.000Z',
  isExpired: false,
};

const slots: ShopDocumentSlot[] = MERCHANT_DOC_TYPES.map((docType) => ({
  docType,
  current: docType === 'fire_licence' ? doc : null,
  replacedCount: 0,
}));

afterEach(() => setLanguage('en'));

describe('merchant documents (Licence tab)', () => {
  it('keeps the licence section and lists the five document categories with their status', async () => {
    mockApi(account('shop_owner'), {
      extra: { '/shop/context': ctx, '/shop/licence': [], '/shop/documents': slots },
    });
    renderAt('/shop/licence');
    expect(await screen.findByRole('heading', { name: 'Business documents' })).toBeInTheDocument();
    // the existing licence upload is still there
    expect(screen.getByText('Upload a licence')).toBeInTheDocument();
    for (const name of [
      'Fire Department Licence',
      'Police Licence / Clearance',
      'Government Authority Licence',
      'GST Certificate',
      'Business Registration Certificate',
    ]) {
      expect(screen.getByRole('heading', { name })).toBeInTheDocument();
    }
    expect(screen.getByText('Rejected')).toBeInTheDocument();
    expect(screen.getAllByText('Not uploaded')).toHaveLength(4);
    expect(screen.getByText(/Not accepted: Photo is blurred\./)).toBeInTheDocument();
    expect(screen.getByText('0 of 5 verified')).toBeInTheDocument();
  });

  it('checks the GSTIN on the phone before anything is uploaded', async () => {
    const calls = mockApi(account('shop_owner'), {
      extra: { '/shop/context': ctx, '/shop/licence': [], '/shop/documents': slots },
    });
    renderAt('/shop/licence');
    const gst = (await screen.findByRole('heading', { name: 'GST Certificate' })).closest('li')!;
    fireEvent.change(within(gst).getByLabelText(/^GSTIN/), {
      target: { value: '27AAPFU0939F1ZX' },
    });
    fireEvent.click(within(gst).getByRole('button', { name: 'Send for checking' }));
    expect(await within(gst).findByText(/That GSTIN is not valid/)).toBeInTheDocument();
    expect(calls.some((c) => c.url.includes('/shop/documents/new'))).toBe(false);
  });
});

describe('admin document review', () => {
  const pending: AdminDocument = {
    ...doc,
    status: 'pending',
    notes: null,
    verifiedAt: null,
    shopId: SHOP_ID,
    shopCode: 'SLC01',
    shopName: 'Sri Lakshmi Crackers',
  };

  it('verifies a document; rejecting needs a reason first', async () => {
    const calls = mockApi(account('admin'), {
      extra: {
        '/console/documents': [pending],
        [`/console/documents/${pending.id}/verify`]: { ...pending, status: 'verified' },
      },
    });
    renderAt('/admin/documents');
    const card = (await screen.findByRole('heading', { name: 'Fire Department Licence' })).closest(
      'li',
    )!;
    fireEvent.click(within(card).getByRole('button', { name: 'Reject' }));
    expect(within(card).getByText(/Write the reason/)).toBeInTheDocument();
    expect(calls.some((c) => c.url.includes('/reject'))).toBe(false);

    fireEvent.click(within(card).getByRole('button', { name: /Verify/ }));
    await waitFor(() =>
      expect(
        calls.some(
          (c) => c.method === 'POST' && c.url.endsWith(`/console/documents/${pending.id}/verify`),
        ),
      ).toBe(true),
    );
  });
});

describe('language', () => {
  it('Hindi replaces the English text and is saved on the account', async () => {
    const calls = mockApi(account('customer'));
    renderAt('/');
    fireEvent.click(await screen.findByRole('button', { name: 'Change language' }));
    fireEvent.click(screen.getByRole('option', { name: /हिन्दी/ }));
    // navigation now in Hindi, and the English words are gone, not shown beside it
    expect(await screen.findByRole('link', { name: 'दुकानें' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Shops' })).not.toBeInTheDocument();
    expect(document.documentElement.lang).toBe('hi');
    await waitFor(() =>
      expect(calls.find((c) => c.method === 'PATCH' && c.url.endsWith('/me'))?.body).toBe(
        JSON.stringify({ lang: 'hi' }),
      ),
    );
  });

  it("the account's language wins after signing in on another device", async () => {
    mockApi({ ...account('customer'), lang: 'te' });
    renderAt('/');
    expect(await screen.findByRole('link', { name: 'దుకాణాలు' })).toBeInTheDocument();
  });
});
