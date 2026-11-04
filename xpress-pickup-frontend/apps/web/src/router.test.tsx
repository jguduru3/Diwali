import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, within } from '@testing-library/react';
import { account, mockApi, shopSummary } from './test/mockApi';
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
  priceVersion: 1,
  canEdit: true,
  role: 'shop_owner',
  cluster: null,
};

describe('public routes', () => {
  it('home shows the brand and listed shops', async () => {
    mockApi(null);
    renderAt('/');
    expect(await screen.findByRole('link', { name: 'Sri Lakshmi Crackers' })).toBeInTheDocument();
    expect(screen.getAllByText('Xpress Pickup').length).toBeGreaterThan(0);
    expect(screen.getByRole('link', { name: 'Sign in' })).toBeInTheDocument();
  });

  it('a first-time visitor sees an order step by step, once', async () => {
    localStorage.removeItem('pp.howSeen.customer');
    mockApi(null);
    renderAt('/');
    const sheet = await screen.findByRole('dialog', { name: 'An order, step by step' });
    for (const step of ['Order', 'Shop confirms', 'Packed', 'Express Pickup'])
      expect(within(sheet).getByText(step)).toBeInTheDocument();
    fireEvent.click(within(sheet).getByRole('button', { name: 'Got it' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(localStorage.getItem('pp.howSeen.customer')).toBe('1');
  });

  it('a shop owner first entering the merchant area sees how it works for the shop', async () => {
    localStorage.removeItem('pp.howSeen.merchant');
    mockApi(account('shop_owner'), { extra: { '/shop/context': shopContext } });
    renderAt('/shop');
    const sheet = await screen.findByRole('dialog', {
      name: 'How Xpress Pickup works for your shop',
    });
    for (const fact of [
      'You pay the shop',
      'Pickup only',
      'No commission',
      'Licensed shops only',
      'Phone number only',
    ])
      expect(within(sheet).getByText(fact)).toBeInTheDocument();
  });

  it('"Standard only" in the header lists just the outlets with standard products', async () => {
    const plain = { ...shopSummary, shortCode: 'KIR01', name: 'Kirana Corner', standardCount: 0 };
    mockApi(null, { extra: { '/shops': [shopSummary, plain] } });
    renderAt('/');
    expect(await screen.findByRole('link', { name: 'Kirana Corner' })).toBeInTheDocument();
    const toggle = screen.getByRole('switch', { name: 'Standard products only' });
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-checked', 'true');
    expect(screen.queryByRole('link', { name: 'Kirana Corner' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Sri Lakshmi Crackers' })).toBeInTheDocument();
    fireEvent.click(toggle);
    expect(await screen.findByRole('link', { name: 'Kirana Corner' })).toBeInTheDocument();
  });

  it('"Standard only" keeps outlets whose count is unknown (older or cached shop list)', async () => {
    const older = { ...shopSummary, standardCount: undefined };
    mockApi(null, { extra: { '/shops': [older] } });
    renderAt('/');
    await screen.findByRole('link', { name: 'Sri Lakshmi Crackers' });
    fireEvent.click(screen.getByRole('switch', { name: 'Standard products only' }));
    expect(screen.getByRole('link', { name: 'Sri Lakshmi Crackers' })).toBeInTheDocument();
    expect(screen.queryByText('No standard shops here yet')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('switch', { name: 'Standard products only' }));
  });

  it('the footer no longer repeats the safety notice (G8 keeps it on the QR and the bill)', async () => {
    mockApi(null);
    renderAt('/about');
    await screen.findByRole('heading', { name: 'An order, step by step' });
    expect(screen.queryByText(/Burst only between 8 pm and 10 pm/)).not.toBeInTheDocument();
  });

  it('switches to Telugu', async () => {
    mockApi(null);
    renderAt('/about');
    fireEvent.click(await screen.findByRole('button', { name: 'Change language' }));
    fireEvent.click(screen.getByRole('option', { name: /తెలుగు/ }));
    expect(await screen.findByText('ఎక్స్‌ప్రెస్ పికప్ ఎలా పనిచేస్తుంది')).toBeInTheDocument();
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'భాష మార్చండి' }));
    fireEvent.click(screen.getByRole('option', { name: /English/ }));
  });

  it('switches to Hindi and marks it selected', async () => {
    mockApi(null);
    renderAt('/about');
    fireEvent.click(await screen.findByRole('button', { name: 'Change language' }));
    fireEvent.click(screen.getByRole('option', { name: /हिन्दी/ }));
    expect(await screen.findByText('एक्सप्रेस पिकअप कैसे काम करता है')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'भाषा बदलें' }));
    expect(screen.getByRole('option', { name: /हिन्दी/ })).toHaveAttribute('aria-selected', 'true');
    fireEvent.keyDown(screen.getByRole('listbox'), { key: 'Escape' });
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'भाषा बदलें' }));
    fireEvent.click(screen.getByRole('option', { name: /अंग्रेज़ी/ }));
  });

  it('unknown paths show not found', () => {
    mockApi(null);
    renderAt('/nope');
    expect(screen.getByText('Page not found')).toBeInTheDocument();
  });
});

describe('role-based access (demo mode off)', () => {
  it.each(['/shop', '/gate', '/admin', '/account', '/orders'])(
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
    expect(within(areasNav()).queryByText('Merchant')).not.toBeInTheDocument();
  });

  it('merchants see their shop area but not admin', async () => {
    mockApi(account('shop_owner'), {
      extra: {
        '/shop/context': shopContext,
      },
    });
    renderAt('/shop');
    expect(
      await screen.findByRole('heading', { name: 'Sri Lakshmi Crackers' }),
    ).toBeInTheDocument();
    expect(within(areasNav()).getByText('Merchant')).toBeInTheDocument();
    expect(within(areasNav()).queryByText('Admin')).not.toBeInTheDocument();
  });

  it('shop staff do not see owner-only tabs', async () => {
    mockApi(account('shop_staff'), {
      extra: { '/shop/context': { ...shopContext, canEdit: false, role: 'shop_staff' } },
    });
    renderAt('/shop');
    const tabs = await screen.findByRole('navigation', { name: 'Shop sections' });
    expect(await within(tabs).findByText('Orders')).toBeInTheDocument();
    expect(within(tabs).getByText('Express Pickup')).toBeInTheDocument();
    expect(within(tabs).queryByText('Licence')).not.toBeInTheDocument();
    expect(within(tabs).queryByText('Payments')).not.toBeInTheDocument();
  });

  it('packers see packing and products only, and land on packing', async () => {
    mockApi(account('shop_packer'), {
      extra: { '/shop/context': { ...shopContext, canEdit: false, role: 'shop_packer' } },
    });
    const { state } = renderAt('/shop');
    const tabs = await screen.findByRole('navigation', { name: 'Shop sections' });
    expect(await within(tabs).findByText('Packing')).toBeInTheDocument();
    expect(within(tabs).getByText('Products')).toBeInTheDocument();
    expect(within(tabs).queryByText('Orders')).not.toBeInTheDocument();
    expect(within(tabs).queryByText('Express Pickup')).not.toBeInTheDocument();
    await vi.waitFor(() => expect(state.location.pathname).toBe('/shop/packing'));
  });

  it('cashiers see only the Express Pickup counter', async () => {
    mockApi(account('shop_cashier'), {
      extra: { '/shop/context': { ...shopContext, canEdit: false, role: 'shop_cashier' } },
    });
    const { state } = renderAt('/shop');
    const tabs = await screen.findByRole('navigation', { name: 'Shop sections' });
    await within(tabs).findByRole('link');
    expect(
      within(tabs)
        .getAllByRole('link')
        .map((l) => l.textContent),
    ).toEqual(['Express Pickup']);
    await vi.waitFor(() => expect(state.location.pathname).toBe('/shop/counter'));
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
    for (const label of ['Merchant', 'Gate', 'Admin']) {
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
