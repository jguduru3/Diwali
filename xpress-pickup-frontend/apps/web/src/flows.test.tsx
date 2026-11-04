import { beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import type { StaffOrder, StaffOrderLine } from '@pataka/shared';
import { account, itemsResponse, mockApi } from './test/mockApi';
import { renderAt } from './test/render';

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

const ORDER_ID = '00000000-0000-4000-8000-0000000000bb';

const shop = (code: string, name: string) => ({
  shortCode: code,
  name,
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
});

const savePlan = (code: string, itemNo: number, qty: number) =>
  localStorage.setItem(
    `pp.plan.${code}`,
    JSON.stringify({ priceVersion: 3, lines: [{ itemNo, qty }], updatedAt: '' }),
  );

describe('cart across shops — one ₹30 fee per shop', () => {
  it('two shops: pay 2 × ₹30 = ₹60 now, the goods at each shop', async () => {
    savePlan('SLC01', 1, 1);
    savePlan('ANA01', 2, 2);
    mockApi(account('customer'), {
      extra: {
        '/shops/SLC01': shop('SLC01', 'Sri Lakshmi Crackers'),
        '/shops/SLC01/items': itemsResponse,
        '/shops/ANA01': shop('ANA01', 'Anand Crackers'),
        '/shops/ANA01/items': { ...itemsResponse, shopCode: 'ANA01' },
      },
    });
    renderAt('/cart');
    expect(await screen.findByText('Anand Crackers')).toBeInTheDocument();
    expect(screen.getByText('Pay now · 2 shops × ₹30')).toBeInTheDocument();
    expect(screen.getByText('₹60')).toBeInTheDocument();
    // ₹100 at SLC01 + 2 × ₹200 at ANA01
    expect(screen.getByText('₹500')).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Place 2 orders · pay ₹60' })).toBeEnabled();
  });

  it('everything from one shop: a single ₹30 fee', async () => {
    savePlan('SLC01', 1, 3);
    mockApi(account('customer'), {
      extra: {
        '/shops/SLC01': shop('SLC01', 'Sri Lakshmi Crackers'),
        '/shops/SLC01/items': itemsResponse,
      },
    });
    renderAt('/cart');
    expect(await screen.findByText('Pay now · 1 shop × ₹30')).toBeInTheDocument();
    expect(
      await screen.findByRole('button', { name: 'Place order · pay ₹30 fee' }),
    ).toBeInTheDocument();
    expect(screen.queryByText('₹60')).not.toBeInTheDocument();
  });
});

describe('packing — each item must match its barcode', () => {
  const line = (n: number, qty: number): StaffOrderLine => ({
    id: `00000000-0000-4000-8000-00000000020${n}`,
    lineNo: n,
    itemId: `00000000-0000-4000-8000-00000000010${n}`,
    itemNo: n,
    nameEn: `Sparkler ${n}`,
    nameTe: null,
    nameHi: null,
    packDesc: '10 pcs',
    imageUrl: null,
    qty,
    unitPricePaise: 10000,
    status: 'pending',
    pickedQty: 0,
    replacesLineId: null,
    alternate: null,
    barcode: `89100${n}`,
    canPickByHand: false,
    rackCode: 'A1',
    stockQty: null,
  });
  const order: StaffOrder = {
    id: ORDER_ID,
    code: 'P4K-7QX',
    status: 'packing',
    customer: '••••••0099',
    lines: [line(1, 2), line(2, 1)],
    estimatedTotalPaise: 30000,
    finalTotalPaise: null,
    packNo: null,
    placedAt: null,
    confirmBy: null,
    confirmedAt: null,
    packedAt: null,
    completedAt: null,
    packMatched: false,
    arrivalStatus: 'not_arrived',
    assistanceStatus: 'none',
    gateNotificationStatus: 'none',
    counterPayment: null,
    bill: null,
    packPhotoAt: null,
    canCall: true,
  };
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
    role: 'shop_packer' as const,
    cluster: null,
  };

  it('a different item’s barcode is refused on the phone and never sent', async () => {
    const calls = mockApi(account('shop_packer'), {
      extra: {
        '/shop/context': ctx,
        '/shop/items': itemsResponse,
        '/shop/orders': [
          {
            id: ORDER_ID,
            code: order.code,
            status: 'packing',
            customer: order.customer,
            estimatedTotalPaise: 30000,
            packNo: null,
            placedAt: null,
            confirmBy: null,
            lineCount: 2,
            openDecisions: 0,
          },
        ],
        [`/shop/orders/${ORDER_ID}`]: order,
        [`/shop/orders/${ORDER_ID}/scan`]: order,
      },
    });
    renderAt('/shop/packing');
    fireEvent.click(await screen.findByRole('button', { name: 'Open' }));
    expect(await screen.findByText('Item 1 of 2')).toBeInTheDocument();
    const box = screen.getByPlaceholderText(/barcode/i);

    // Sparkler 2's barcode while Sparkler 1 is the current step
    fireEvent.change(box, { target: { value: '891002' } });
    fireEvent.submit(box.closest('form')!);
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Wrong item: that barcode is Sparkler 2. Scan Sparkler 1.',
    );
    expect(calls.some((c) => c.url.endsWith('/scan'))).toBe(false);

    // The right barcode goes to the server, which checks it again
    fireEvent.change(box, { target: { value: '891001' } });
    fireEvent.submit(box.closest('form')!);
    await waitFor(() => expect(calls.some((c) => c.url.endsWith('/scan'))).toBe(true));
    const scan = calls.find((c) => c.url.endsWith('/scan'))!;
    expect(JSON.parse(scan.body!)).toEqual({
      barcode: '891001',
      lineId: '00000000-0000-4000-8000-000000000201',
    });
  });

  it('Call customer asks the server to ring the packer, and never sees the number', async () => {
    const calls = mockApi(account('shop_packer'), {
      extra: {
        '/shop/context': ctx,
        '/shop/items': itemsResponse,
        '/shop/orders': [
          {
            id: ORDER_ID,
            code: order.code,
            status: 'packing',
            customer: order.customer,
            estimatedTotalPaise: 30000,
            packNo: null,
            placedAt: null,
            confirmBy: null,
            lineCount: 2,
            openDecisions: 0,
          },
        ],
        [`/shop/orders/${ORDER_ID}`]: order,
        [`/shop/orders/${ORDER_ID}/call`]: { status: 'ringing' },
      },
    });
    renderAt('/shop/packing');
    fireEvent.click(await screen.findByRole('button', { name: 'Open' }));
    fireEvent.click(await screen.findByRole('button', { name: /Call customer/ }));
    expect(await screen.findByRole('status')).toHaveTextContent('Your phone will ring now');
    const sent = calls.find((c) => c.url.includes('/call'))!;
    expect(sent.method).toBe('POST');
    expect(sent.body ?? '').not.toMatch(/\d{10}/);
  });
});

describe('sign in', () => {
  it('sends the name typed at sign-in with the code', async () => {
    const calls = mockApi(null, {
      extra: {
        '/auth/otp/request': { sent: true, expiresInSeconds: 300 },
        '/auth/otp/verify': account('customer'),
      },
    });
    renderAt('/login');
    fireEvent.change(await screen.findByLabelText(/Your name/), {
      target: { value: 'Priya Reddy' },
    });
    fireEvent.change(screen.getByLabelText(/Mobile number/), {
      target: { value: '98765 43210' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send code' }));
    expect(await screen.findByText(/Hi Priya Reddy/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('6-digit code'), { target: { value: '123456' } });
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Verify and continue' }));
    await waitFor(() => expect(calls.some((c) => c.url === '/api/auth/otp/verify')).toBe(true));
    const verify = calls.find((c) => c.url === '/api/auth/otp/verify')!;
    expect(JSON.parse(verify.body!)).toMatchObject({
      phone: '+919876543210',
      code: '123456',
      displayName: 'Priya Reddy',
    });
  });
});

describe('two photos per product', () => {
  const withPhotos = {
    ...itemsResponse,
    items: itemsResponse.items.map((i, n) =>
      n === 0 ? { ...i, imageUrl: '/api/media/a.jpg', imageOpenUrl: '/api/media/a-open.jpg' } : i,
    ),
  };

  it('customers see the box-closed and box-open photos of a product', async () => {
    mockApi(account('customer'), {
      extra: {
        '/shops/SLC01': shop('SLC01', 'Sri Lakshmi Crackers'),
        '/shops/SLC01/items': withPhotos,
      },
    });
    renderAt('/s/SLC01');
    const first = withPhotos.items[0]!;
    fireEvent.click((await screen.findAllByRole('button', { name: new RegExp(first.nameEn) }))[0]!);
    expect(
      await screen.findByRole('img', { name: `${first.nameEn} · Box closed` }),
    ).toHaveAttribute('src', '/api/media/a.jpg');
    expect(screen.getByRole('img', { name: `${first.nameEn} · Box open` })).toHaveAttribute(
      'src',
      '/api/media/a-open.jpg',
    );
  });
});

describe('merchant products — both photos asked for', () => {
  it('counts products still missing a photo and marks each one', async () => {
    const items = {
      ...itemsResponse,
      items: itemsResponse.items.map((i, n) =>
        n === 0
          ? { ...i, imageUrl: '/api/media/a.jpg', imageOpenUrl: '/api/media/a-open.jpg' }
          : n === 1
            ? { ...i, imageUrl: '/api/media/b.jpg', imageOpenUrl: null }
            : i,
      ),
    };
    const active = items.items.filter((i) => i.isActive).length;
    mockApi(account('shop_owner'), {
      extra: {
        '/shop/context': {
          shopCode: 'SLC01',
          name: 'Sri Lakshmi Crackers',
          area: 'Gachibowli',
          isLive: true,
          visible: true,
          openFrom: '10:00',
          openTo: '22:00',
          priceVersion: 3,
          canEdit: true,
          role: 'shop_owner',
          cluster: null,
        },
        '/shop/items': items,
      },
    });
    renderAt('/shop/prices');
    const missing = active - 1;
    expect(
      await screen.findByText(
        `${missing} ${missing === 1 ? 'product needs' : 'products need'} both photos: one with the box closed and one with the box open.`,
      ),
    ).toBeInTheDocument();
    expect(screen.getByText('Needs box-open photo')).toBeInTheDocument();
    expect(screen.getAllByLabelText(/Box open/).length).toBeGreaterThan(0);
  });
});
