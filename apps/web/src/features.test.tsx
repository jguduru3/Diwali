import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { decodePlan, encodePlan, type Visit } from '@pataka/shared';
import { getPlan } from './lib/planList';
import { Ticket } from './routes/customer/TicketPage';
import { account, itemsResponse, mockApi } from './test/mockApi';
import { renderAt } from './test/render';

vi.mock('./components/ShopMap', () => ({ default: () => null }));

beforeEach(() => localStorage.clear());
afterEach(() => vi.unstubAllGlobals());

const visit: Visit = {
  code: 'K7Q2M9',
  status: 'booked',
  vehicle: 'car',
  bayNo: null,
  slot: { startsAt: '2026-11-07T13:30:00.000Z', endsAt: '2026-11-07T14:00:00.000Z' },
  shop: { shortCode: 'SLC01', name: 'Sri Lakshmi Crackers', address: null, lat: null, lng: null },
  cluster: null,
  arrivedAt: null,
  servedAt: null,
  createdAt: '2026-11-01T00:00:00.000Z',
};

describe('G8 — ticket safety notice', () => {
  it('every ticket shows the exact safety notice', async () => {
    mockApi(account('customer'), { extra: { '/shops/SLC01/items': itemsResponse } });
    render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter>
          <Ticket visit={visit} />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    const notice = await screen.findByTestId('safety-notice');
    expect(notice.textContent).toMatchInlineSnapshot(
      `"🪔Green crackers only. Burst only between 8 pm and 10 pm on Diwali, as per Supreme Court orders. Keep children supervised."`,
    );
    expect(screen.getByText('K7Q2M9')).toBeInTheDocument();
  });
});

describe('plan list (G1 — stays on the phone)', () => {
  it('adding items writes to localStorage only; no request carries the list', async () => {
    const calls = mockApi(null, {
      extra: {
        '/shops/SLC01': {
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
          nextFreeSlot: null,
          phone: null,
          priceVersion: 3,
          slotMinutes: 30,
        },
        '/shops/SLC01/items': itemsResponse,
      },
    });
    renderAt('/s/SLC01');
    fireEvent.click(await screen.findByRole('button', { name: 'Add Sparkler 1 to plan list' }));
    fireEvent.click(screen.getByRole('button', { name: 'One more Sparkler 1' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add Sparkler 2 to plan list' }));

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
      extra: {
        '/shops/SLC01': {
          ...{
            shortCode: 'SLC01',
            name: 'S',
            area: 'A',
            address: null,
            lat: null,
            lng: null,
            photoUrl: null,
            openFrom: null,
            openTo: null,
            openNow: false,
            distanceKm: null,
            licence: { licenceNo: 'x', licenceType: 'LE-5', validTo: '2026-11-30' },
            cluster: null,
            nextFreeSlot: null,
            phone: null,
            priceVersion: 3,
            slotMinutes: 30,
          },
        },
        '/shops/SLC01/items': itemsResponse,
      },
    });
    renderAt('/s/SLC01');
    expect(
      await screen.findByRole('button', { name: 'Add Sparkler 3 to plan list' }),
    ).toBeDisabled();
  });
});

describe('counter (G1/G2 — list decoded on the device)', () => {
  const ctx = {
    shopCode: 'SLC01',
    name: 'Sri Lakshmi Crackers',
    area: 'Gachibowli',
    isLive: true,
    visible: true,
    openFrom: '10:00',
    openTo: '22:00',
    slotMinutes: 30,
    defaultCapacityPerSlot: 10,
    priceVersion: 3,
    canEdit: false,
    cluster: null,
  };

  it('builds a pick list and bill locally, flags sold-out and changed prices, and sends only the code', async () => {
    const calls = mockApi(account('shop_staff'), {
      extra: {
        '/shop/context': ctx,
        '/shop/items': itemsResponse,
        '/shop/visits/K7Q2M9/serve': {
          code: 'K7Q2M9',
          status: 'served',
          vehicle: null,
          bayNo: null,
          shopCode: 'SLC01',
          shopName: 'S',
          slotStartsAt: visit.slot.startsAt,
          slotEndsAt: visit.slot.endsAt,
          arrivedAt: null,
          servedAt: null,
        },
      },
    });
    renderAt('/shop/counter');
    const qr = encodePlan({
      visitCode: 'K7Q2M9',
      shopCode: 'SLC01',
      priceVersion: 1,
      lines: [
        { itemNo: 1, qty: 2 },
        { itemNo: 2, qty: 1 },
        { itemNo: 3, qty: 4 },
      ],
    });
    expect(decodePlan(qr).ok).toBe(true);
    const box = await screen.findByPlaceholderText('Type the 6-letter code or paste QR text');
    fireEvent.change(box, { target: { value: qr } });
    fireEvent.click(screen.getByRole('button', { name: 'Go' }));

    expect(await screen.findByText('Pick list')).toBeInTheDocument();
    // 2 × ₹100 + 1 × ₹200; item 3 is sold out and excluded
    expect(screen.getByText('₹400')).toBeInTheDocument();
    expect(screen.getAllByText('Not available').length).toBe(1);
    expect(screen.getAllByText('Price changed').length).toBe(1);
    expect(screen.getByText('Rack A1')).toBeInTheDocument();

    await act(async () => fireEvent.click(screen.getByRole('button', { name: /Mark served/ })));
    await waitFor(() => expect(screen.getByText(/Marked served/)).toBeInTheDocument());

    const posts = calls.filter((c) => c.method !== 'GET');
    expect(posts).toEqual([{ url: '/api/shop/visits/K7Q2M9/serve', method: 'POST', body: null }]);
    // No request anywhere carried item numbers or quantities.
    for (const c of calls) expect(`${c.url} ${c.body ?? ''}`).not.toMatch(/\*|itemNo|qty/);
  });

  it('rejects a list for another shop', async () => {
    mockApi(account('shop_staff'), {
      extra: { '/shop/context': ctx, '/shop/items': itemsResponse },
    });
    renderAt('/shop/counter');
    const box = await screen.findByPlaceholderText('Type the 6-letter code or paste QR text');
    fireEvent.change(box, { target: { value: 'PP1.-.BAL01.1.1*1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Go' }));
    expect(await screen.findByText('This list is for another shop (BAL01).')).toBeInTheDocument();
  });
});
