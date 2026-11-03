import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import {
  agentMeSchema,
  billSchema,
  creditViewSchema,
  walletViewSchema,
  type MerchantDraft,
  type ReviewPage,
} from '@pataka/shared';
import { getDb } from '../src/db/client';
import {
  agentPayouts,
  agents,
  categories,
  creditLedger,
  items,
  merchantSubscriptions,
  notifications,
  shopMembers,
  shops,
  users,
  wallets,
} from '../src/db/schema';
import { licenceVerifyHandler } from '../src/functions/console';
import {
  adminSettlementPaidHandler,
  adminWithdrawalFailedHandler,
  agentMeHandler,
  agentRegisterHandler,
  claimHandler,
  creditHandler,
  influencerMeHandler,
  influencerRegisterHandler,
  linkVisitHandler,
  kitsHandler,
  kitOffersHandler,
  merchantConsentHandler,
  merchantFeedbackHandler,
  merchantNewHandler,
  merchantSetupHandler,
  merchantSubmitHandler,
  orderCreditHandler,
  ownerReviewApproveHandler,
  ownerReviewHandler,
  ownerDecision,
  panHandler,
  shopSettlementRequestHandler,
  shopSettlementsHandler,
  walletHandler,
  withdrawHandler,
} from '../src/functions/growth';
import { mockCompleteHandler } from '../src/functions/payments';
import { counterCashHandler, counterOpenHandler, counterPackHandler } from '../src/functions/shop';
import { shopItemCreateHandler, shopLicenceSubmitHandler } from '../src/functions/shop';
import { getMeHandler } from '../src/functions/me';
import { refundFee } from '../src/lib/orders';
import { onboardingReminders, payoutCheck } from '../src/lib/growth/merchants';
import { walletEntry } from '../src/lib/growth/common';
import { body, call, errorCode, makeListedShop, makeUser, signIn } from './helpers';
import { packedOrder } from './orderHelpers';

const db = () => getDb();
const png =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg=='.repeat(
    2,
  );

async function activeAgent(extra: Record<string, unknown> = {}) {
  const person = await makeUser();
  const reg = await call(agentRegisterHandler, {
    method: 'POST',
    session: person.session,
    body: {
      name: 'Ramesh K',
      upiId: `ramesh${Math.random().toString(36).slice(2, 7)}@okhdfc`,
      acceptTerms: true,
      ...extra,
    },
  });
  if (reg.status !== 201) throw new Error(JSON.stringify(reg.jsonBody));
  await db().update(agents).set({ status: 'active' }).where(eq(agents.userId, person.user.id));
  return person;
}

const ownerPhone = () => `+9177${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`;

/** An agent's merchant all the way to "review", returning the review link token. */
async function merchantInReview(agent: { session: string }) {
  const created = await call(merchantNewHandler, {
    method: 'POST',
    session: agent.session,
    body: {
      shopName: 'Sri Ganesh Stores',
      area: 'Kukatpally',
      ownerName: 'Ganesh',
      ownerPhone: ownerPhone(),
    },
  });
  expect(created.status).toBe(201);
  const draft = body<MerchantDraft>(created);
  expect(draft.ownerLink).toMatch(/\/m\/approve\//);
  const id = { params: { id: draft.id } };
  const consent = await call(merchantConsentHandler, {
    method: 'POST',
    session: agent.session,
    ...id,
    body: { code: '123456' },
  });
  expect(body<MerchantDraft>(consent).status).toBe('setup');

  // Not ready: submit lists what is missing.
  const early = await call(merchantSubmitHandler, {
    method: 'POST',
    session: agent.session,
    ...id,
  });
  expect(errorCode(early)).toBe('setup_incomplete');

  // The agent captures the shop through the normal shop screens (?shop=CODE).
  const shop = { query: { shop: draft.shopCode } };
  const lic = await call(shopLicenceSubmitHandler, {
    method: 'POST',
    session: agent.session,
    ...shop,
    body: {
      licenceNo: 'TL/2026/77',
      licenceType: 'Trade',
      validFrom: '2026-01-01',
      validTo: '2099-12-31',
      image: { contentType: 'image/png', base64: png },
    },
  });
  expect(lic.status).toBe(201);
  const [cat] = await db()
    .insert(categories)
    .values({ slug: `grocery-${draft.shopCode.toLowerCase()}`, nameEn: 'Grocery' })
    .returning();
  for (let n = 1; n <= 10; n++) {
    const it = await call(shopItemCreateHandler, {
      method: 'POST',
      session: agent.session,
      ...shop,
      body: { categoryId: cat!.id, nameEn: `Rice ${n} kg`, saleMode: 'mrp', pricePaise: 5000 + n },
    });
    expect(it.status).toBe(201); // no green certificate needed (G7 amended)
    await db()
      .update(items)
      .set({ imagePath: `items/x/${n}.jpg` })
      .where(eq(items.id, body<{ id: string }>(it).id));
  }
  await call(merchantSetupHandler, {
    method: 'PUT',
    session: agent.session,
    ...id,
    body: {
      gstin: '27AAPFU0939F1ZV',
      openFrom: '09:00',
      openTo: '21:00',
      lat: 17.49,
      lng: 78.4,
      address: 'KPHB',
    },
  });
  const sub = await call(merchantSubmitHandler, { method: 'POST', session: agent.session, ...id });
  expect(sub.status).toBe(200);
  const reviewLink = body<MerchantDraft>(sub).ownerLink!;
  expect(reviewLink).toMatch(/\/m\/review\//);
  return { draft, token: reviewLink.split('/m/review/')[1]! };
}

async function payOnline(token: string) {
  const approved = await call(ownerReviewApproveHandler, {
    method: 'POST',
    params: { token },
    body: { acceptTerms: true, method: 'online' },
  });
  const page = body<ReviewPage>(approved);
  expect(page.subscription).toMatchObject({ status: 'pending', method: 'online' });
  const checkoutId = page.subscription!.checkoutUrl!.split('/').pop()!;
  const paid = await call(mockCompleteHandler, {
    method: 'POST',
    params: { checkoutId },
    body: { outcome: 'success' },
  });
  expect(paid.status).toBe(200);
}

describe('agent onboarding → subscription → live → one ₹1,000 payout', () => {
  it('runs end to end and pays the agent exactly once', async () => {
    const agent = await activeAgent();
    const { draft, token } = await merchantInReview(agent);

    // The shop is not listed while it is set up, even with its licence verified later.
    const page = body<ReviewPage>(await call(ownerReviewHandler, { params: { token } }));
    expect(page).toMatchObject({
      shopName: 'Sri Ganesh Stores',
      amountPaise: 199900,
      gstPaise: 36000,
    });
    expect(page.items).toHaveLength(10);

    await payOnline(token);
    const [shop] = await db().select().from(shops).where(eq(shops.id, draft.id));
    expect(shop!.onboardingStatus).toBe('approved');
    const [sub] = await db()
      .select()
      .from(merchantSubscriptions)
      .where(eq(merchantSubscriptions.shopId, draft.id));
    expect(sub).toMatchObject({ status: 'paid' });
    expect(sub!.invoiceNo).toMatch(/^DXE\/\d{4}\/\d{6}$/);
    // The owner has the shop now; the agent's setup access ended.
    const [owner] = await db()
      .select()
      .from(users)
      .where(eq(users.phoneE164, shop!.ownerPhoneE164!));
    const [member] = await db().select().from(shopMembers).where(eq(shopMembers.userId, owner!.id));
    expect(member).toMatchObject({ shopId: draft.id, role: 'shop_owner' });
    const blocked = await call(shopItemCreateHandler, {
      method: 'POST',
      session: agent.session,
      query: { shop: draft.shopCode },
      body: {
        categoryId: '00000000-0000-4000-8000-000000000000',
        nameEn: 'Late',
        saleMode: 'mrp',
        pricePaise: 100,
      },
    });
    expect(blocked.status).toBe(403);

    // No payout before the licence is verified.
    expect(await db().select().from(agentPayouts)).toHaveLength(0);
    const adminUser = await makeUser('admin');
    const [lic] = await db()
      .execute<{ id: string }>(
        `select id from shop_licences where shop_id = '${draft.id}'` as never,
      )
      .then((r) => r.rows);
    await call(licenceVerifyHandler, {
      method: 'POST',
      session: adminUser.session,
      params: { id: lic!.id },
      body: {},
    });
    const [live] = await db().select().from(shops).where(eq(shops.id, draft.id));
    expect(live).toMatchObject({ onboardingStatus: 'live', isLive: true });

    const wallet = walletViewSchema.parse(
      (await call(walletHandler, { session: agent.session })).jsonBody,
    );
    expect(wallet.balancePaise).toBe(100000);
    await payoutCheck(db());
    await payoutCheck(db());
    expect(await db().select().from(agentPayouts)).toHaveLength(1);

    // feedback once the shop is live
    const fb = await call(merchantFeedbackHandler, {
      method: 'POST',
      session: agent.session,
      params: { id: draft.id },
      body: { helped: true },
    });
    expect(body<MerchantDraft>(fb)).toMatchObject({ feedbackGiven: true, payout: 'credited' });
    const me = agentMeSchema.parse(
      (await call(agentMeHandler, { session: agent.session })).jsonBody,
    );
    expect(me.merchants[0]).toMatchObject({ status: 'live', payout: 'credited' });
  });

  it('reminds the agent once at 24 hours and once at 48 hours while the owner has not answered', async () => {
    const agent = await activeAgent();
    await merchantInReview(agent);
    const at = (h: number) => new Date(Date.now() + h * 3_600_000);
    expect(await onboardingReminders(db(), at(2))).toBe(0);
    expect(await onboardingReminders(db(), at(25))).toBe(1);
    expect(await onboardingReminders(db(), at(26))).toBe(0);
    expect(await onboardingReminders(db(), at(49))).toBe(1);
    expect(await onboardingReminders(db(), at(50))).toBe(0);
    const notes = await db()
      .select()
      .from(notifications)
      .where(eq(notifications.userId, agent.user.id));
    expect(
      notes
        .filter((n) => n.type === 'merchant.reminder')
        .map((n) => (n.params as { hours: number }).hours),
    ).toEqual([24, 48]);
  });

  it('three wrong consent codes lock the draft; a second agent cannot take the same owner', async () => {
    const agent = await activeAgent();
    const phone = ownerPhone();
    const created = await call(merchantNewHandler, {
      method: 'POST',
      session: agent.session,
      body: { shopName: 'Shop A', area: 'Uppal', ownerName: 'Ravi', ownerPhone: phone },
    });
    const id = { params: { id: body<MerchantDraft>(created).id } };
    for (let i = 0; i < 3; i++) {
      expect(
        errorCode(
          await call(merchantConsentHandler, {
            method: 'POST',
            session: agent.session,
            ...id,
            body: { code: '000000' },
          }),
        ),
      ).toBe('otp_wrong');
    }
    expect(
      errorCode(
        await call(merchantConsentHandler, {
          method: 'POST',
          session: agent.session,
          ...id,
          body: { code: '123456' },
        }),
      ),
    ).toBe('otp_locked');
    const other = await activeAgent();
    const dup = await call(merchantNewHandler, {
      method: 'POST',
      session: other.session,
      body: { shopName: 'Shop B', area: 'Uppal', ownerName: 'Ravi', ownerPhone: phone },
    });
    expect(errorCode(dup)).toBe('owner_exists');
  });

  it('pending agents cannot onboard; the owner can report an agent, who is suspended', async () => {
    const person = await makeUser();
    await call(agentRegisterHandler, {
      method: 'POST',
      session: person.session,
      body: { name: 'New', upiId: 'newagent@okaxis', acceptTerms: true },
    });
    const refused = await call(merchantNewHandler, {
      method: 'POST',
      session: person.session,
      body: { shopName: 'X', area: 'Y', ownerName: 'Z', ownerPhone: ownerPhone() },
    });
    expect(errorCode(refused)).toBe('agent_not_active');

    const agent = await activeAgent();
    const { token } = await merchantInReview(agent);
    const reported = await call(ownerDecision('report'), {
      method: 'POST',
      params: { token },
      body: { note: 'I never agreed' },
    });
    expect(body<{ status: string }>(reported).status).toBe('closed');
    const [a] = await db().select().from(agents).where(eq(agents.userId, agent.user.id));
    expect(a).toMatchObject({ status: 'suspended' });
  });

  it('an agent signing in again signs out their other device', async () => {
    const phone = '+919812300001';
    const first = await signIn(phone);
    const u = (await db().select().from(users).where(eq(users.phoneE164, phone)))[0]!;
    await db()
      .insert(wallets)
      .values({ userId: u.id, upiEnc: 'x', upiHash: `h-${u.id}`, upiHint: 'h' });
    await db().insert(agents).values({
      userId: u.id,
      code: 'DXA-ABCDEF',
      name: 'Dev',
      agreementVersion: 'v',
      agreementAcceptedAt: new Date(),
    });
    const second = await signIn(phone);
    expect((await call(getMeHandler, { session: second })).status).toBe(200);
    expect((await call(getMeHandler, { session: first })).status).toBe(401);
  });

  it('counts visits to an active influencer link only', async () => {
    const inf = await makeUser();
    const reg = await call(influencerRegisterHandler, {
      method: 'POST',
      session: inf.session,
      body: { handle: '@visits', platform: 'instagram', upiId: 'visits@ybl', acceptTerms: true },
    });
    const code = body<{ code: string }>(reg).code;
    const visit = (c: string) =>
      call(linkVisitHandler, { method: 'POST', params: { code: c }, ip: '10.9.9.9' });
    expect((await visit(code)).status).toBe(204); // pending: not counted
    await db().execute(`update influencers set status = 'active' where code = '${code}'` as never);
    await visit(code);
    await visit(code);
    expect((await visit('not-a-code')).status).toBe(204);
    const me = body<{ visits: number }>(await call(influencerMeHandler, { session: inf.session }));
    expect(me.visits).toBe(2);
  });

  it('an influencer who brought the agent gets ₹10 once, on the first live merchant', async () => {
    const inf = await makeUser();
    const reg = await call(influencerRegisterHandler, {
      method: 'POST',
      session: inf.session,
      body: { handle: '@hydfoodie', platform: 'instagram', upiId: 'foodie@ybl', acceptTerms: true },
    });
    const code = body<{ code: string }>(reg).code;
    await db().execute(`update influencers set status = 'active' where code = '${code}'` as never);
    const agent = await activeAgent({ recruitCode: code });
    const { draft, token } = await merchantInReview(agent);
    await payOnline(token);
    const adminUser = await makeUser('admin');
    const [lic] = (
      await db().execute<{ id: string }>(
        `select id from shop_licences where shop_id = '${draft.id}'` as never,
      )
    ).rows;
    await call(licenceVerifyHandler, {
      method: 'POST',
      session: adminUser.session,
      params: { id: lic!.id },
      body: {},
    });
    const w = walletViewSchema.parse(
      (await call(walletHandler, { session: inf.session })).jsonBody,
    );
    expect(w.balancePaise).toBe(1000);
    expect(w.ledger.map((l) => l.reason)).toEqual(['recruit_reward']);
  });
});

describe('referrals and credit (G11, G12)', () => {
  it('₹10 credit when the referred person’s first order is packed; a fee refund reverses it', async () => {
    const shop = await makeListedShop();
    const referrer = await makeUser();
    const code = creditViewSchema.parse(
      (await call(creditHandler, { session: referrer.session })).jsonBody,
    ).referralCode;
    expect(code).toMatch(/^DXR-/);
    const friend = await makeUser();
    expect(
      errorCode(
        await call(claimHandler, { method: 'POST', session: referrer.session, body: { code } }),
      ),
    ).toBe('own_code');
    expect(
      (await call(claimHandler, { method: 'POST', session: friend.session, body: { code } }))
        .status,
    ).toBe(200);
    expect(
      errorCode(
        await call(claimHandler, { method: 'POST', session: friend.session, body: { code } }),
      ),
    ).toBe('already_referred');

    const p = await packedOrder(shop, [[0, 1]], friend);
    const credit = creditViewSchema.parse(
      (await call(creditHandler, { session: referrer.session })).jsonBody,
    );
    expect(credit).toMatchObject({ balancePaise: 1000, invited: 1, rewarded: 1 });

    // a second packed order by the friend earns nothing more
    await packedOrder(shop, [[1, 1]], friend);
    expect(
      creditViewSchema.parse((await call(creditHandler, { session: referrer.session })).jsonBody)
        .balancePaise,
    ).toBe(1000);

    await refundFee(db(), p.order.id, null, 'test refund');
    expect(
      creditViewSchema.parse((await call(creditHandler, { session: referrer.session })).jsonBody)
        .balancePaise,
    ).toBe(0);
    const rows = await db()
      .select()
      .from(creditLedger)
      .where(eq(creditLedger.userId, referrer.user.id));
    expect(rows.map((r) => r.reason).sort()).toEqual(['referral', 'reversal']);
  });

  it('credit comes off the bill at the counter, is owed to the merchant and settled once a day', async () => {
    const shop = await makeListedShop();
    const customer = await makeUser();
    await db().insert(creditLedger).values({
      userId: customer.user.id,
      deltaPaise: 1500,
      reason: 'referral',
      refId: 'seed-credit',
    });
    const p = await packedOrder(shop, [[0, 1]], customer); // ₹100 bill
    const asked = await call(orderCreditHandler, {
      method: 'POST',
      session: customer.session,
      params: { id: p.order.id },
      body: { amountPaise: 999999 },
    });
    expect(body<{ creditRequestedPaise: number }>(asked).creditRequestedPaise).toBe(1500); // capped at balance

    const open = await call(counterOpenHandler, {
      method: 'POST',
      session: shop.cashier.session,
      body: { qr: p.pickupQr },
    });
    const id = { params: { id: body<{ id: string }>(open).id } };
    await call(counterPackHandler, {
      method: 'POST',
      session: shop.cashier.session,
      ...id,
      body: { qr: p.sticker.qr },
    });
    const short = await call(counterCashHandler, {
      method: 'POST',
      session: shop.cashier.session,
      ...id,
      body: { receivedPaise: 8400 },
    });
    expect(errorCode(short)).toBe('cash_short'); // due is ₹100 − ₹15 = ₹85
    const paid = await call(counterCashHandler, {
      method: 'POST',
      session: shop.cashier.session,
      ...id,
      body: { receivedPaise: 8500 },
    });
    expect(paid.status).toBe(200);
    const view = await call((await import('../src/functions/orders')).orderHandler, {
      session: customer.session,
      params: { id: p.order.id },
    });
    const bill = billSchema.parse((view.jsonBody as { bill: unknown }).bill);
    expect(bill).toMatchObject({ totalPaise: 10000, creditPaise: 1500, paidPaise: 8500 });
    expect(
      creditViewSchema.parse((await call(creditHandler, { session: customer.session })).jsonBody)
        .balancePaise,
    ).toBe(0);

    // the platform owes the shop the ₹15; the owner asks for it once a day
    const before = await call(shopSettlementsHandler, { session: shop.owner.session });
    expect(before.jsonBody).toMatchObject({ owedPaise: 1500, canRequestToday: true });
    const req = await call(shopSettlementRequestHandler, {
      method: 'POST',
      session: shop.owner.session,
    });
    expect(req.jsonBody).toMatchObject({ owedPaise: 0, canRequestToday: false });
    const again = await call(shopSettlementRequestHandler, {
      method: 'POST',
      session: shop.owner.session,
    });
    expect(errorCode(again)).toBe('settlement_today');
    const s = (
      req.jsonBody as { settlements: { id: string; amountPaise: number; bills: number }[] }
    ).settlements[0]!;
    expect(s).toMatchObject({ amountPaise: 1500, bills: 1 });
    const adminUser = await makeUser('admin');
    const done = await call(adminSettlementPaidHandler, {
      method: 'POST',
      session: adminUser.session,
      params: { id: s.id },
      body: { utr: 'UTR123456789' },
    });
    expect(done.status).toBe(204);
  });
});

describe('wallet withdrawals (G13)', () => {
  async function walletWith(paise: number) {
    const person = await makeUser();
    await call(influencerRegisterHandler, {
      method: 'POST',
      session: person.session,
      body: {
        handle: '@x',
        platform: 'youtube',
        upiId: `w${Math.random().toString(36).slice(2, 8)}@ybl`,
        acceptTerms: true,
      },
    });
    const [w] = await db().select().from(wallets).where(eq(wallets.userId, person.user.id));
    await db().transaction((tx) => walletEntry(tx, w!.id, 'onboarding', `seed-${w!.id}`, paise));
    return { person, walletId: w!.id };
  }
  const out = (session: string, amountPaise: number, key = `${Math.random()}`) =>
    call(withdrawHandler, {
      method: 'POST',
      session,
      body: { amountPaise },
      headers: { 'idempotency-key': `withdraw-${key}` },
    });

  it('any number a day up to ₹2,000 in total; retries with the same key count once', async () => {
    const { person } = await walletWith(500000);
    expect((await out(person.session, 150000, 'a')).status).toBe(200);
    expect((await out(person.session, 150000, 'a')).status).toBe(200); // same key: no second withdrawal
    expect(errorCode(await out(person.session, 50001))).toBe('withdraw_daily_cap');
    expect((await out(person.session, 50000)).status).toBe(200);
    const w = walletViewSchema.parse(
      (await call(walletHandler, { session: person.session })).jsonBody,
    );
    expect(w).toMatchObject({ balancePaise: 300000, todayRemainingPaise: 0 });
  });

  it('two withdrawals at once cannot pass the cap together', async () => {
    const { person } = await walletWith(500000);
    const [a, b] = await Promise.all([out(person.session, 150000), out(person.session, 150000)]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
  });

  it('a failed transfer returns the money once; three failures freeze the wallet', async () => {
    const { person, walletId } = await walletWith(500000);
    const adminUser = await makeUser('admin');
    for (let i = 0; i < 3; i++) {
      await out(person.session, 10000);
      const [row] = await db()
        .execute<{ id: string }>(
          `select id from withdrawals where wallet_id = '${walletId}' and status = 'requested'` as never,
        )
        .then((r) => r.rows);
      const res = await call(adminWithdrawalFailedHandler, {
        method: 'POST',
        session: adminUser.session,
        params: { id: row!.id },
        body: { reason: 'Invalid VPA' },
      });
      expect(res.status).toBe(204);
      const again = await call(adminWithdrawalFailedHandler, {
        method: 'POST',
        session: adminUser.session,
        params: { id: row!.id },
        body: { reason: 'Invalid VPA' },
      });
      expect(again.status).toBe(409);
    }
    const w = walletViewSchema.parse(
      (await call(walletHandler, { session: person.session })).jsonBody,
    );
    expect(w).toMatchObject({ balancePaise: 500000, frozen: true });
    expect(errorCode(await out(person.session, 100))).toBe('withdraw_frozen');
  });

  it('pauses at ₹20,000 earned until a PAN is given, then deducts 2% on the excess only', async () => {
    const { person } = await walletWith(2050000);
    expect(errorCode(await out(person.session, 100000))).toBe('withdraw_pan_required');
    const pan = await call(panHandler, {
      method: 'POST',
      session: person.session,
      body: { pan: 'abcde1234f' },
    });
    expect(walletViewSchema.parse(pan.jsonBody).panOnFile).toBe(true);
    expect((await out(person.session, 100000)).status).toBe(200);
    const w = walletViewSchema.parse(
      (await call(walletHandler, { session: person.session })).jsonBody,
    );
    expect(w.withdrawals[0]).toMatchObject({ amountPaise: 100000, tdsPaise: 1000 }); // 2% of ₹500
    // the PAN is stored encrypted, only its last 4 in clear
    const [row] = await db().select().from(wallets).where(eq(wallets.userId, person.user.id));
    expect(row!.panEnc).not.toContain('ABCDE1234F');
    expect(row!.panLast4).toBe('234F');
  });
});

describe('kits', () => {
  it('a kit is one product with contents; customers compare it across listed shops', async () => {
    const shop = await makeListedShop();
    const kit = await call(shopItemCreateHandler, {
      method: 'POST',
      session: shop.owner.session,
      body: {
        categoryId: shop.allowedCategory.id,
        nameEn: 'Family kit',
        saleMode: 'mrp',
        pricePaise: 150000,
        kind: 'kit',
        kitType: 'family',
        contents: [
          { name: 'Rice 5 kg', qty: 1 },
          { name: 'Dal 1 kg', qty: 2 },
        ],
      },
    });
    expect(kit.status).toBe(201);
    const bad = await call(shopItemCreateHandler, {
      method: 'POST',
      session: shop.owner.session,
      body: {
        categoryId: shop.allowedCategory.id,
        nameEn: 'Broken kit',
        saleMode: 'mrp',
        pricePaise: 100,
        kind: 'kit',
      },
    });
    expect(bad.status).toBe(400);
    const types = body<{ type: string; shops: number; fromPaise: number | null }[]>(
      await call(kitsHandler),
    );
    expect(types.find((t) => t.type === 'family')).toMatchObject({ shops: 1, fromPaise: 150000 });
    const offers = body<{ shopCode: string; contents: unknown[] }[]>(
      await call(kitOffersHandler, { params: { type: 'family' } }),
    );
    expect(offers).toHaveLength(1);
    expect(offers[0]).toMatchObject({ shopCode: 'SLC01' });
    expect(offers[0]!.contents).toHaveLength(2);
  });
});
