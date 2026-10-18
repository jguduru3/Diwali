import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { decodePlan, encodePlan, type CustomerOrder, type StaffOrder } from '@pataka/shared';
import { getPlan } from './lib/planList';
import { account, itemsResponse, mockApi } from './test/mockApi';
import { renderAt } from './test/render';

vi.mock('./components/ShopMap', () => ({ default: () => null }));

beforeEach(() => localStorage.clear());
afterEach(() => vi.unstubAllGlobals());

const ORDER_ID = '00000000-0000-4000-8000-0000000000aa';

const shopDetail = {
  shortCode: 'SLC01',
  name: 'Sri Lakshmi Crackers',
  area: 'Gachibowli',
  address: null,
  lat: null,
  lng: null,
  photoUrl: null,
  openFrom: '10:00',
  openTo: '22:00',
  openNow: true,
  distanceKm: null,
  licence: { licenceNo: 'LE5/1', licenceType: 'LE-5', validTo: '2026-11-30' },
  cluster: null,
  phone: null,
  priceVersion: 3,
};

const packedOrder: CustomerOrder = {
  id: ORDER_ID,
  code: 'K7Q-2M9',
  status: 'packed',
  shop: {
    shortCode: 'SLC01',
    name: 'Sri Lakshmi Crackers',
    address: null,
    lat: null,
    lng: null,
    pickupNotes: null,
  },
  lines: [],
  estimatedTotalPaise: 30000,
  finalTotalPaise: 30000,
  packNo: 7,
  fee: { amountPaise: 3000, status: 'kept', checkout: null },
  placedAt: '2026-11-01T05:00:00.000Z',
  confirmBy: '2026-11-04T05:00:00.000Z',
  confirmedAt: '2026-11-01T06:00:00.000Z',
  packedAt: '2026-11-01T07:00:00.000Z',
  completedAt: null,
  cancelReason: null,
  bill: null,
};

describe('G8 — safety notice on the pickup QR', () => {
  it('a packed order shows the pack number, the pickup QR and the exact safety notice', async () => {
    localStorage.setItem(`pp.pickup.${ORDER_ID}`, 'DXO1.0123456789ABCDEFGHJKMNPQRS');
    mockApi(account('customer'), { extra: { [`/orders/${ORDER_ID}`]: packedOrder } });
    renderAt(`/orders/${ORDER_ID}`);
    expect(await screen.findByText('Pack #7')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Pickup QR for order K7Q-2M9' })).toBeInTheDocument();
    const notice = screen.getByTestId('safety-notice');
    expect(notice.textContent).toMatchInlineSnapshot(
      `"🪔Green crackers only. Burst only between 8 pm and 10 pm on Diwali, as per Supreme Court orders. Keep children supervised."`,
    );
  });
});

describe('building an order', () => {
  it('adding items stays on the phone until the order is placed', async () => {
    const calls = mockApi(null, {
      extra: { '/shops/SLC01': shopDetail, '/shops/SLC01/items': itemsResponse },
    });
    renderAt('/s/SLC01');
    fireEvent.click(await screen.findByRole('button', { name: 'Add Sparkler 1' }));
    fireEvent.click(screen.getByRole('button', { name: 'One more Sparkler 1' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add Sparkler 2' }));

    expect(getPlan('SLC01')).toMatchObject({
      priceVersion: 3,
      lines: [
        { itemNo: 1, qty: 2 },
        { itemNo: 2, qty: 1 },
      ],
    });
    expect(await screen.findByText('3 items · est. ₹400')).toBeInTheDocument();
    expect(calls.every((c) => c.method === 'GET' && c.body === null)).toBe(true);
  });

  it('sold-out items cannot be added', async () => {
    mockApi(null, {
      extra: { '/shops/SLC01': shopDetail, '/shops/SLC01/items': itemsResponse },
    });
    renderAt('/s/SLC01');
    expect(await screen.findByRole('button', { name: 'Add Sparkler 3' })).toBeDisabled();
  });

  it('placing an order sends item ids and quantities only — never prices or totals (G11)', async () => {
    localStorage.setItem(
      'pp.plan.SLC01',
      JSON.stringify({
        priceVersion: 3,
        lines: [
          { itemNo: 1, qty: 2 },
          { itemNo: 2, qty: 1 },
        ],
        updatedAt: '',
      }),
    );
    const calls = mockApi(account('customer'), {
      extra: { '/shops/SLC01': shopDetail, '/shops/SLC01/items': itemsResponse },
    });
    renderAt('/s/SLC01/plan');
    fireEvent.click(await screen.findByRole('button', { name: 'Place order · pay ₹30 fee' }));
    await waitFor(() => expect(calls.some((c) => c.url === '/api/orders')).toBe(true));
    const post = calls.find((c) => c.url === '/api/orders')!;
    expect(JSON.parse(post.body!)).toEqual({
      shopCode: 'SLC01',
      lines: [
        { itemId: itemsResponse.items[0]!.id, qty: 2 },
        { itemId: itemsResponse.items[1]!.id, qty: 1 },
      ],
    });
  });

  it('when ordering is off, the list QR is offered instead', async () => {
    localStorage.setItem(
      'pp.plan.SLC01',
      JSON.stringify({ priceVersion: 3, lines: [{ itemNo: 1, qty: 1 }], updatedAt: '' }),
    );
    mockApi(account('customer'), {
      extra: {
        '/shops/SLC01': shopDetail,
        '/shops/SLC01/items': itemsResponse,
        '/ordering': { enabled: false, feePaise: 3000, confirmWindowHours: 72 },
      },
    });
    renderAt('/s/SLC01/plan');
    expect(await screen.findByText(/Online ordering isn't open yet/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Place order/ })).not.toBeInTheDocument();
  });
});

describe('Express Pickup counter', () => {
  const ctx = {
    shopCode: 'SLC01',
    name: 'Sri Lakshmi Crackers',
    area: 'Gachibowli',
    isLive: true,
    visible: true,
    openFrom: '10:00',
    openTo: '22:00',
    priceVersion: 3,
    canEdit: false,
    role: 'shop_cashier' as const,
    cluster: null,
  };

  it('a walk-in list is billed on the device; nothing is sent', async () => {
    const calls = mockApi(account('shop_cashier'), {
      extra: { '/shop/context': ctx, '/shop/items': itemsResponse },
    });
    renderAt('/shop/counter');
    const qr = encodePlan({
      visitCode: null,
      shopCode: 'SLC01',
      priceVersion: 1,
      lines: [
        { itemNo: 1, qty: 2 },
        { itemNo: 2, qty: 1 },
        { itemNo: 3, qty: 4 },
      ],
    });
    expect(decodePlan(qr).ok).toBe(true);
    const box = await screen.findByPlaceholderText('Paste or type the QR text');
    fireEvent.change(box, { target: { value: qr } });
    fireEvent.click(screen.getByRole('button', { name: 'Go' }));

    expect(await screen.findByText('Pick list')).toBeInTheDocument();
    // 2 × ₹100 + 1 × ₹200; item 3 is sold out and excluded
    expect(screen.getByText('₹400')).toBeInTheDocument();
    expect(screen.getAllByText('Not available').length).toBe(1);
    expect(screen.getAllByText('Price changed').length).toBe(1);
    expect(calls.filter((c) => c.method !== 'GET')).toEqual([]);
  });

  it('a pickup QR opens the order by sending only the QR; the pack number shows', async () => {
    const order: StaffOrder = {
      id: ORDER_ID,
      code: 'K7Q-2M9',
      status: 'packed',
      customer: '••••••0099',
      lines: [],
      estimatedTotalPaise: 30000,
      finalTotalPaise: 30000,
      packNo: 7,
      placedAt: null,
      confirmBy: null,
      confirmedAt: null,
      packedAt: null,
      completedAt: null,
      packMatched: false,
      counterPayment: null,
      bill: null,
    };
    const calls = mockApi(account('shop_cashier'), {
      extra: { '/shop/context': ctx, '/shop/items': itemsResponse, '/shop/counter/open': order },
    });
    renderAt('/shop/counter');
    const qr = 'DXO1.0123456789ABCDEFGHJKMNPQRS';
    const box = await screen.findByPlaceholderText('Paste or type the QR text');
    fireEvent.change(box, { target: { value: qr } });
    fireEvent.click(screen.getByRole('button', { name: 'Go' }));
    expect(await screen.findByText('#7')).toBeInTheDocument();
    expect(screen.getByText('Scan pack sticker')).toBeInTheDocument();
    const post = calls.find((c) => c.method === 'POST')!;
    expect(post.url).toBe('/api/shop/counter/open');
    expect(JSON.parse(post.body!)).toEqual({ qr });
  });

  it('rejects a list for another shop', async () => {
    mockApi(account('shop_cashier'), {
      extra: { '/shop/context': ctx, '/shop/items': itemsResponse },
    });
    renderAt('/shop/counter');
    const box = await screen.findByPlaceholderText('Paste or type the QR text');
    fireEvent.change(box, { target: { value: 'PP1.-.BAL01.1.1*1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Go' }));
    expect(await screen.findByText('This list is for another shop (BAL01).')).toBeInTheDocument();
  });
});
