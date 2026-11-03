import { describe, expect, it } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import type { CreditView, ReviewPage, WalletView } from '@pataka/shared';
import { account, mockApi } from './test/mockApi';
import { renderAt } from './test/render';

const wallet: WalletView = {
  balancePaise: 300000,
  todayRemainingPaise: 200000,
  fyEarnedPaise: 300000,
  fy: '2026-27',
  panOnFile: false,
  panRequired: false,
  panPrompt: false,
  frozen: false,
  upiHint: 'ra•••@okhdfc',
  ledger: [{ id: 'l1', deltaPaise: 100000, reason: 'onboarding', at: '2026-11-03T10:00:00.000Z' }],
  withdrawals: [],
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
  amountPaise: 199900,
  gstPaise: 36000,
  subscription: null,
};

describe('agent portal', () => {
  it('asks a new agent to register; the button needs the terms accepted', async () => {
    const calls = mockApi(account('customer'), {
      extra: {
        '/agent/me': { __status: 404, body: { error: { code: 'not_agent', message: '' } } },
        '/me/profiles': { agent: null, influencer: null, wallet: false },
      },
    });
    // no agent yet: the API answers 404 not_agent
    calls.length = 0;
    renderAt('/agent');
    expect(
      await screen.findByRole('heading', { name: 'Register as an agent' }),
    ).toBeInTheDocument();
    const register = screen.getByRole('button', { name: 'Register' });
    expect(register).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Your name'), { target: { value: 'Ramesh K' } });
    fireEvent.change(screen.getByLabelText(/^UPI ID/), { target: { value: 'ramesh@okhdfc' } });
    fireEvent.click(screen.getByRole('checkbox'));
    expect(register).toBeEnabled();
    fireEvent.click(register);
    await waitFor(() => {
      const sent = calls.find((c) => c.url.endsWith('/agent/register'));
      expect(JSON.parse(sent!.body!)).toEqual({
        name: 'Ramesh K',
        upiId: 'ramesh@okhdfc',
        acceptTerms: true,
      });
    });
  });
});

describe('money wallet', () => {
  it('withdraws with an idempotency key, so a retry cannot pay twice', async () => {
    const calls = mockApi(account('customer'), {
      extra: { '/wallet': wallet, '/wallet/withdraw': wallet },
    });
    renderAt('/wallet');
    expect((await screen.findAllByText('₹3,000')).length).toBe(2); // balance and earned
    expect(screen.getByText(/ra•••@okhdfc/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Amount'), { target: { value: '500' } });
    fireEvent.click(screen.getByRole('button', { name: 'Withdraw' }));
    await waitFor(() => expect(calls.some((c) => c.url.endsWith('/wallet/withdraw'))).toBe(true));
    const sent = calls.find((c) => c.url.endsWith('/wallet/withdraw'))!;
    expect(JSON.parse(sent.body!)).toEqual({ amountPaise: 50000 });
    expect(sent.headers?.['Idempotency-Key']).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('asks for the PAN when it is required', async () => {
    mockApi(account('customer'), {
      extra: { '/wallet': { ...wallet, panRequired: true, panPrompt: true } },
    });
    renderAt('/wallet');
    expect(await screen.findByText(/Add your PAN to keep withdrawing/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save PAN' })).toBeDisabled();
  });
});

describe('owner review link', () => {
  it('shows the shop, the price and needs the terms before approving', async () => {
    const calls = mockApi(null, { extra: { '/m/review/tok_aaaaaaaaaaaaaaaaaaaaaaaa': review } });
    renderAt('/m/review/tok_aaaaaaaaaaaaaaaaaaaaaaaa');
    expect(await screen.findByRole('heading', { name: 'Sri Ganesh Kirana' })).toBeInTheDocument();
    expect(screen.getByText(/₹1,999 \+ GST ₹360 = ₹2,359/)).toBeInTheDocument();
    const approve = screen.getByRole('button', { name: 'Approve and pay ₹2,359' });
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

describe('my credit', () => {
  it('shows the balance and the code to share', async () => {
    const credit: CreditView = {
      balancePaise: 2000,
      expiresOn: '2026-11-20',
      referralCode: 'DXR-ABC123',
      invited: 3,
      rewarded: 2,
      history: [],
    };
    mockApi(account('customer'), { extra: { '/me/credit': credit } });
    renderAt('/credit');
    expect(await screen.findByText('DXR-ABC123')).toBeInTheDocument();
    expect(screen.getByText('₹20')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Send on WhatsApp' })).toHaveAttribute(
      'href',
      expect.stringContaining(encodeURIComponent('/r/DXR-ABC123')),
    );
  });
});
