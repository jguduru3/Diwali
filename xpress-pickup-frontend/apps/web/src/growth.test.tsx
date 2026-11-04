import { describe, expect, it } from 'vitest';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { INDUCTION_VERSION, type AgentMe, type ReviewPage } from '@pataka/shared';
import { account, mockApi } from './test/mockApi';
import { renderAt } from './test/render';

const agentMe: AgentMe = {
  code: 'DXA-KC55RR',
  name: 'Ramesh K',
  status: 'active',
  merchants: [],
  upiHint: 'ra•••@okhdfc',
  fy: '2026-27',
  fyEarnedPaise: 300000,
  paidPaise: 200000,
  pendingPaise: 100000,
  panOnFile: false,
  panPrompt: false,
  panRequired: false,
  payouts: [
    {
      id: '00000000-0000-4000-8000-000000000001',
      shopName: 'Sri Ganesh Kirana',
      amountPaise: 100000,
      tdsPaise: 0,
      netPaise: 100000,
      status: 'pending',
      utr: null,
      blocked: null,
      failureReason: null,
      earnedAt: '2026-11-03T10:00:00.000Z',
      sentAt: null,
    },
    {
      id: '00000000-0000-4000-8000-000000000002',
      shopName: 'Lakshmi Stores',
      amountPaise: 100000,
      tdsPaise: 0,
      netPaise: 100000,
      status: 'sent',
      utr: 'UTR612345678901',
      blocked: null,
      failureReason: null,
      earnedAt: '2026-11-02T10:00:00.000Z',
      sentAt: '2026-11-02T12:00:00.000Z',
    },
  ],
};

const review: ReviewPage = {
  shopName: 'Sri Ganesh Kirana',
  area: 'Kukatpally',
  ownerName: 'Ganesh',
  agentCode: 'DXA-KC55RR',
  status: 'review',
  gstin: '27AAPFU0939F1ZV',
  openFrom: '08:00',
  openTo: '22:00',
  items: [{ name: 'Rice 5 kg', packDesc: null, pricePaise: 4500, imageUrl: null }],
  amountPaise: 211780,
  gstPaise: 38120,
  subscription: null,
};

describe('agent portal', () => {
  it('customers and visitors find "Become an agent" in the menu; agents find their portal', async () => {
    // the link appears before the account loads, so wait for where it settles
    const linksGoTo = (href: string) =>
      waitFor(() => {
        const links = screen.getAllByRole('link', { name: 'Become an agent' });
        for (const a of links) expect(a).toHaveAttribute('href', href);
      });
    mockApi(null);
    renderAt('/');
    await screen.findByRole('link', { name: 'Sign in' });
    await linksGoTo('/agent');
    cleanup();

    mockApi(account('customer'), { extra: { '/me/profiles': { agent: null } } });
    renderAt('/');
    await linksGoTo('/agent');
    cleanup();

    mockApi(account('customer'), { extra: { '/me/profiles': { agent: 'active' } } });
    renderAt('/');
    const portal = await screen.findAllByRole('link', { name: 'Agent portal' });
    for (const a of portal) expect(a).toHaveAttribute('href', '/agent');
  });

  it('explains the role to a new agent first; Apply now opens the induction', async () => {
    localStorage.removeItem('pp.induction');
    mockApi(account('customer'), {
      extra: {
        '/agent/me': { __status: 404, body: { error: { code: 'not_agent', message: '' } } },
        '/me/profiles': { agent: null },
      },
    });
    renderAt('/agent');
    expect(
      await screen.findByRole('heading', { name: 'Set up local shops on Xpress Pickup' }),
    ).toBeInTheDocument();
    for (const point of ['What you do', 'How you are paid', 'What you need'])
      expect(screen.getByText(point)).toBeInTheDocument();
    for (const a of screen.getAllByRole('link', { name: 'Apply now' }))
      expect(a).toHaveAttribute('href', '/induction');
    expect(screen.queryByRole('button', { name: 'Register' })).not.toBeInTheDocument();
  });

  it('a signed-out visitor sees the intro without signing in', async () => {
    localStorage.removeItem('pp.induction');
    mockApi(null);
    renderAt('/agent');
    expect(
      await screen.findByRole('heading', { name: 'Set up local shops on Xpress Pickup' }),
    ).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: 'Apply now' })[0]).toHaveAttribute(
      'href',
      '/induction',
    );
  });

  it('after the induction a signed-out visitor is sent to sign in, then back here', async () => {
    localStorage.setItem('pp.induction', INDUCTION_VERSION);
    mockApi(null);
    renderAt('/agent');
    const apply = await screen.findAllByRole('link', { name: 'Apply now' });
    expect(apply[0]).toHaveAttribute('href', `/login?next=${encodeURIComponent('/agent')}`);
  });

  it('asks a new agent to register with the UPI ID their payouts go to', async () => {
    localStorage.setItem('pp.induction', INDUCTION_VERSION);
    const calls = mockApi(account('customer'), {
      extra: {
        '/agent/me': { __status: 404, body: { error: { code: 'not_agent', message: '' } } },
        '/me/profiles': { agent: null },
      },
    });
    calls.length = 0;
    renderAt('/agent');
    expect(
      await screen.findByRole('heading', { name: 'Register as an agent' }),
    ).toBeInTheDocument();
    const register = screen.getByRole('button', { name: 'Register' });
    expect(register).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Your name'), { target: { value: 'Ramesh K' } });
    fireEvent.change(screen.getByLabelText(/^UPI ID for payouts/), {
      target: { value: 'ramesh@okhdfc' },
    });
    fireEvent.click(screen.getByRole('checkbox'));
    expect(register).toBeEnabled();
    fireEvent.click(register);
    await waitFor(() => {
      const sent = calls.find((c) => c.url.endsWith('/agent/register'));
      expect(JSON.parse(sent!.body!)).toEqual({
        name: 'Ramesh K',
        upiId: 'ramesh@okhdfc',
        acceptTerms: true,
        inductionVersion: INDUCTION_VERSION,
      });
    });
  });

  it('shows the payouts: where they go, what was paid, what is on its way', async () => {
    mockApi(account('customer'), {
      extra: { '/agent/me': agentMe, '/me/profiles': { agent: 'active' }, '/notifications': [] },
    });
    renderAt('/agent');
    expect(await screen.findByRole('heading', { name: 'Your payouts' })).toBeInTheDocument();
    expect(screen.getByText(/Payouts go to ra•••@okhdfc/)).toBeInTheDocument();
    expect(screen.getByText('₹2,000')).toBeInTheDocument(); // paid
    expect(screen.getByText('₹3,000')).toBeInTheDocument(); // earned this year
    expect(screen.getByText(/UTR UTR612345678901/)).toBeInTheDocument();
    expect(screen.getByText('Being sent', { selector: 'span' })).toBeInTheDocument();
    expect(screen.queryByText(/Add your PAN/)).not.toBeInTheDocument();
  });

  it('asks for the PAN when payouts are held for it, and sends it', async () => {
    const calls = mockApi(account('customer'), {
      extra: {
        '/agent/me': {
          ...agentMe,
          fyEarnedPaise: 2000000,
          panRequired: true,
          panPrompt: true,
          payouts: [{ ...agentMe.payouts[0]!, blocked: 'pan_required' }],
        },
        '/agent/pan': agentMe,
        '/me/profiles': { agent: 'active' },
        '/notifications': [],
      },
    });
    renderAt('/agent');
    expect(await screen.findByText(/Payouts wait until you add your PAN/)).toBeInTheDocument();
    expect(screen.getByText('Waiting for your PAN')).toBeInTheDocument();
    const save = screen.getByRole('button', { name: 'Save PAN' });
    expect(save).toBeDisabled();
    fireEvent.change(screen.getByLabelText('PAN'), { target: { value: 'abcde1234f' } });
    expect(save).toBeEnabled();
    fireEvent.click(save);
    await waitFor(() => {
      const sent = calls.find((c) => c.url.endsWith('/agent/pan'));
      expect(JSON.parse(sent!.body!)).toEqual({ pan: 'ABCDE1234F' });
    });
  });
});

describe('owner review link', () => {
  it('shows the shop, the price and needs the terms before approving', async () => {
    const calls = mockApi(null, { extra: { '/m/review/tok_aaaaaaaaaaaaaaaaaaaaaaaa': review } });
    renderAt('/m/review/tok_aaaaaaaaaaaaaaaaaaaaaaaa');
    expect(await screen.findByRole('heading', { name: 'Sri Ganesh Kirana' })).toBeInTheDocument();
    expect(
      screen.getByText(/Season subscription ₹2,499, including GST ₹381\.20/),
    ).toBeInTheDocument();
    const approve = screen.getByRole('button', { name: 'Approve and pay ₹2,499' });
    expect(approve).toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(approve);
    await waitFor(() => {
      const sent = calls.find((c) => c.url.endsWith('/approve'));
      expect(JSON.parse(sent!.body!)).toEqual({ acceptTerms: true, method: 'online' });
    });
    // never pay an agent in cash
    expect(screen.getAllByText(/Never pay an agent in cash/).length).toBeGreaterThan(0);
  });
});

describe('GST tax invoices', () => {
  const invoice = {
    kind: 'platform_fee',
    invoiceNo: 'XPF/2627/000042',
    issuedAt: '2026-11-04T06:30:00.000Z',
    supplier: {
      name: 'Better Analytics Private Limited',
      address: 'Hyderabad',
      gstin: '36AAPFU0939F1ZW',
      phone: null,
      stateCode: '36',
      state: 'Telangana',
    },
    recipient: { name: 'Priya', address: null, gstin: null, phone: '+919000000099' },
    placeOfSupply: 'Telangana (36)',
    lines: [
      { description: 'Platform fee: order K7Q-2M9', sac: '996211', qty: 1, taxablePaise: 2542 },
    ],
    ratePercent: 18,
    taxablePaise: 2542,
    cgstPaise: 229,
    sgstPaise: 229,
    totalPaise: 3000,
    reference: 'K7Q-2M9',
    refunded: false,
  };

  it('the customer sees SAC 996211 and the GST inside the ₹30 fee', async () => {
    const id = '00000000-0000-4000-8000-000000000099';
    mockApi(account('customer'), { extra: { [`/orders/${id}/invoice`]: invoice } });
    renderAt(`/orders/${id}/invoice`);
    expect(await screen.findByRole('heading', { name: 'Tax invoice' })).toBeInTheDocument();
    expect(screen.getByText(/XPF\/2627\/000042/)).toBeInTheDocument();
    expect(screen.getByText('996211')).toBeInTheDocument();
    expect(screen.getByText('CGST 9%')).toBeInTheDocument();
    expect(screen.getByText('SGST 9%')).toBeInTheDocument();
    expect(screen.getByText('₹30')).toBeInTheDocument();
  });
});
