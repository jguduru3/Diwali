import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, within } from '@testing-library/react';
import { account, mockApi } from './test/mockApi';
import { renderAt } from './test/render';

vi.mock('./components/ShopMap', () => ({ default: () => null }));

afterEach(() => vi.unstubAllGlobals());

const areasNav = () => screen.getByRole('navigation', { name: 'App areas' });

const shopContext = {
  shopCode: 'SLC01',
  name: 'Sri Lakshmi Crackers',
  area: 'Gachibowli',
  isLive: true,
  visible: true,
  openFrom: '10:00',
  openTo: '22:00',
  slotMinutes: 30,
  defaultCapacityPerSlot: 10,
  priceVersion: 1,
  canEdit: true,
  cluster: null,
};

describe('public routes', () => {
  it('home shows the brand and listed shops', async () => {
    mockApi(null);
    renderAt('/');
    expect(await screen.findByRole('link', { name: 'Sri Lakshmi Crackers' })).toBeInTheDocument();
    expect(screen.getAllByText('Diwali Express Pickup').length).toBeGreaterThan(0);
    expect(screen.getByRole('link', { name: 'Sign in' })).toBeInTheDocument();
  });

  it('footer always carries the safety notice', async () => {
    mockApi(null);
    renderAt('/about');
    expect(await screen.findByText(/Burst only between 8 pm and 10 pm/)).toBeInTheDocument();
  });

  it('switches to Telugu', async () => {
    mockApi(null);
    renderAt('/about');
    fireEvent.click(await screen.findByRole('button', { name: 'Change language' }));
    expect(await screen.findByText('దీపావళి ఎక్స్‌ప్రెస్ పికప్ ఎలా పనిచేస్తుంది')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'భాష మార్చండి' }));
  });

  it('unknown paths show not found', () => {
    mockApi(null);
    renderAt('/nope');
    expect(screen.getByText('Page not found')).toBeInTheDocument();
  });
});

describe('role-based access (demo mode off)', () => {
  it.each(['/shop', '/gate', '/admin', '/account', '/ticket'])(
    'signed-out visitors to %s are sent to sign in, keeping the return path',
    async (path) => {
      mockApi(null);
      const { state } = renderAt(path);
      expect(await screen.findByText('With your mobile number — no password.')).toBeInTheDocument();
      expect(state.location.pathname).toBe('/login');
      expect(state.location.search).toBe(`?next=${encodeURIComponent(path)}`);
    },
  );

  it('customers cannot open the shop, gate or admin areas', async () => {
    mockApi(account('customer'));
    renderAt('/admin');
    expect(await screen.findByText('No access')).toBeInTheDocument();
    expect(within(areasNav()).queryByText('Admin')).not.toBeInTheDocument();
    expect(within(areasNav()).queryByText('Shop counter')).not.toBeInTheDocument();
  });

  it('vendors see their shop counter but not admin', async () => {
    mockApi(account('shop_owner'), {
      extra: {
        '/shop/context': shopContext,
        '/shop/visits/today': { date: '2026-11-07', slots: [] },
      },
    });
    renderAt('/shop');
    expect(
      await screen.findByRole('heading', { name: 'Sri Lakshmi Crackers' }),
    ).toBeInTheDocument();
    expect(within(areasNav()).getByText('Shop counter')).toBeInTheDocument();
    expect(within(areasNav()).queryByText('Admin')).not.toBeInTheDocument();
  });

  it('counter staff do not see owner-only tabs', async () => {
    mockApi(account('shop_staff'), {
      extra: {
        '/shop/context': { ...shopContext, canEdit: false },
        '/shop/visits/today': { date: '2026-11-07', slots: [] },
      },
    });
    renderAt('/shop');
    const tabs = await screen.findByRole('navigation', { name: 'Shop sections' });
    expect(within(tabs).getByText('Scan list')).toBeInTheDocument();
    expect(within(tabs).queryByText('Licence')).not.toBeInTheDocument();
    expect(within(tabs).queryByText('Slots')).not.toBeInTheDocument();
  });

  it('vendors are refused the admin area', async () => {
    mockApi(account('shop_staff'));
    renderAt('/admin');
    expect(await screen.findByText('No access')).toBeInTheDocument();
  });

  it('admins open the console and see every area', async () => {
    mockApi(account('admin'));
    renderAt('/admin');
    expect(await screen.findByText('Admin console')).toBeInTheDocument();
    for (const label of ['Shop counter', 'Gate', 'Admin']) {
      expect(within(areasNav()).getByText(label)).toBeInTheDocument();
    }
  });

  it('signed-in users visiting /login go to their own area', async () => {
    mockApi(account('admin'));
    const { state } = renderAt('/login');
    expect(await screen.findByText('Admin console')).toBeInTheDocument();
    expect(state.location.pathname).toBe('/admin');
  });
});

describe('demo mode', () => {
  it('protected areas offer one-tap demo accounts instead of an SMS code', async () => {
    mockApi(null, { demo: true });
    renderAt('/admin');
    expect(await screen.findByText('Open Admin as…')).toBeInTheDocument();
    // only accounts that can open the admin area are offered
    const main = screen.getByRole('main');
    expect(within(main).getByRole('button', { name: /Admin/ })).toBeInTheDocument();
    expect(within(main).queryByRole('button', { name: /Customer/ })).not.toBeInTheDocument();
    expect(screen.getByText(/Demo mode — sign-in is switched off/)).toBeInTheDocument();
  });

  it('demo login calls only the demo endpoint with a phone number', async () => {
    const calls = mockApi(null, { demo: true });
    renderAt('/admin');
    const main = await screen.findByRole('main');
    fireEvent.click(await within(main).findByRole('button', { name: /Admin/ }));
    await vi.waitFor(() => expect(calls.some((c) => c.url === '/api/auth/demo/login')).toBe(true));
    const login = calls.find((c) => c.url === '/api/auth/demo/login')!;
    expect(JSON.parse(login.body!)).toEqual({ phone: '+919000000001' });
  });
});
