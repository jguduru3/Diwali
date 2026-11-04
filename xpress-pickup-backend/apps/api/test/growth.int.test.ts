import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import {
  AGENT_PAYOUT_PAISE,
  agentMeSchema,
  type AgentMe,
  type MerchantDraft,
  type ReviewPage,
  INDUCTION_VERSION,
} from '@pataka/shared';
import { getDb } from '../src/db/client';
import {
  agentPayouts,
  agents,
  categories,
  items,
  merchantSubscriptions,
  notifications,
  shopMembers,
  shops,
  users,
} from '../src/db/schema';
import { licenceVerifyHandler } from '../src/functions/console';
import {
  adminPayoutFailedHandler,
  adminPayoutRetryHandler,
  adminPayoutReverseHandler,
  adminPayoutSentHandler,
  adminPayoutsHandler,
  agentMeHandler,
  agentPanHandler,
  agentRegisterHandler,
  agentUpiHandler,
  kitsHandler,
  kitOffersHandler,
  merchantConsentHandler,
  merchantFeedbackHandler,
  merchantNewHandler,
  merchantSetupHandler,
  merchantSubmitHandler,
  ownerReviewApproveHandler,
  ownerReviewHandler,
  ownerDecision,
} from '../src/functions/growth';
import { mockCompleteHandler } from '../src/functions/payments';
import { shopItemCreateHandler, shopLicenceSubmitHandler } from '../src/functions/shop';
import { getMeHandler } from '../src/functions/me';
import { onboardingReminders, payoutCheck } from '../src/lib/growth/merchants';
import { createPayout } from '../src/lib/growth/payouts';
import { body, call, errorCode, makeListedShop, makeUser, signIn } from './helpers';

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
      inductionVersion: INDUCTION_VERSION,
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
      .set({ imagePath: `items/x/${n}.jpg`, imageOpenPath: `items/x/${n}-open.jpg` })
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

    const me0 = agentMeSchema.parse(
      (await call(agentMeHandler, { session: agent.session })).jsonBody,
    );
    expect(me0.payouts).toHaveLength(1);
    expect(me0.payouts[0]).toMatchObject({
      amountPaise: 100000,
      tdsPaise: 0,
      netPaise: 100000,
      status: 'pending',
      blocked: null,
    });
    expect(me0).toMatchObject({ pendingPaise: 100000, paidPaise: 0, fyEarnedPaise: 100000 });
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
    expect(body<MerchantDraft>(fb)).toMatchObject({ feedbackGiven: true, payout: 'pending' });

    // The admin sends the ₹1,000 to the agent's UPI ID and records the UTR.
    const sent = await call(adminPayoutSentHandler, {
      method: 'POST',
      session: adminUser.session,
      params: { id: me0.payouts[0]!.id },
      body: { utr: 'UTR123456789012' },
    });
    expect(sent.status).toBe(204);
    const me = agentMeSchema.parse(
      (await call(agentMeHandler, { session: agent.session })).jsonBody,
    );
    expect(me.merchants[0]).toMatchObject({ status: 'live', payout: 'sent' });
    expect(me.payouts[0]).toMatchObject({ status: 'sent', utr: 'UTR123456789012' });
    expect(me).toMatchObject({ paidPaise: 100000, pendingPaise: 0 });
    // A sent payout cannot be sent again.
    expect(
      (
        await call(adminPayoutSentHandler, {
          method: 'POST',
          session: adminUser.session,
          params: { id: me0.payouts[0]!.id },
          body: { utr: 'UTR123456789012' },
        })
      ).status,
    ).toBe(409);
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
      body: {
        name: 'New',
        upiId: 'newagent@okaxis',
        acceptTerms: true,
        inductionVersion: INDUCTION_VERSION,
      },
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
      .insert(agents)
      .values({
        userId: u.id,
        code: 'DXA-ABCDEF',
        name: 'Dev',
        upiEnc: 'x',
        upiHash: `h-${u.id}`,
        upiHint: 'h',
        agreementVersion: 'v',
        agreementAcceptedAt: new Date(),
      });
    const second = await signIn(phone);
    expect((await call(getMeHandler, { session: second })).status).toBe(200);
    expect((await call(getMeHandler, { session: first })).status).toBe(401);
  });
});

describe('agent payouts straight to the UPI ID (G9, G13)', () => {
  /** `n` shops that went live for this agent, each with its ₹1,000 payout, made the real way. */
  async function livePayouts(agent: { user: { id: string } }, n: number) {
    const [a] = await db().select().from(agents).where(eq(agents.userId, agent.user.id));
    const ids: string[] = [];
    for (let k = 0; k < n; k++) {
      const [shop] = await db()
        .insert(shops)
        .values({
          shortCode: `P${Math.random().toString(36).slice(2, 7).toUpperCase()}`,
          name: `Payout shop ${k + 1}`,
          area: 'Test',
          onboardingStatus: 'live',
          onboardedByAgentId: a!.id,
          isLive: true,
        })
        .returning();
      const p = await db().transaction((tx) => createPayout(tx, a!, shop!));
      ids.push(p!.id);
    }
    return ids;
  }
  const me = async (session: string) =>
    agentMeSchema.parse((await call(agentMeHandler, { session })).jsonBody) as AgentMe;
  const adminDo = (
    session: string,
    handler: Parameters<typeof call>[0],
    id: string,
    bodyIn: unknown = {},
  ) => call(handler, { method: 'POST', session, params: { id }, body: bodyIn });

  it('a failed transfer is retried once the agent corrects their UPI ID', async () => {
    const agent = await activeAgent();
    const adminUser = await makeUser('admin');
    const [id] = await livePayouts(agent, 1);
    const failed = await adminDo(adminUser.session, adminPayoutFailedHandler, id!, {
      reason: 'Invalid VPA',
    });
    expect(failed.status).toBe(204);
    expect((await me(agent.session)).payouts[0]).toMatchObject({
      status: 'failed',
      failureReason: 'Invalid VPA',
    });
    // failing it twice, or sending a failed one, is refused
    expect(
      (await adminDo(adminUser.session, adminPayoutFailedHandler, id!, { reason: 'once more' }))
        .status,
    ).toBe(409);
    expect(
      (await adminDo(adminUser.session, adminPayoutSentHandler, id!, { utr: 'UTR000000001' }))
        .status,
    ).toBe(409);

    // The agent gives a new UPI ID: the failed payout is queued again for it.
    const upi = await call(agentUpiHandler, {
      method: 'PUT',
      session: agent.session,
      body: { upiId: 'ramesh.new@okaxis' },
    });
    expect(upi.status).toBe(200);
    expect(agentMeSchema.parse(upi.jsonBody)).toMatchObject({ upiHint: 'ra•••@okaxis' });
    expect((await me(agent.session)).payouts[0]).toMatchObject({ status: 'pending' });
    const list = body<{ id: string; status: string; failedAttempts: number }[]>(
      await call(adminPayoutsHandler, { session: adminUser.session, query: { status: 'pending' } }),
    );
    expect(list.find((p) => p.id === id)).toMatchObject({ failedAttempts: 1 });
    // ...and the admin can also retry a failed one directly
    await adminDo(adminUser.session, adminPayoutFailedHandler, id!, { reason: 'again' });
    expect((await adminDo(adminUser.session, adminPayoutRetryHandler, id!)).status).toBe(204);
    expect((await me(agent.session)).payouts[0]).toMatchObject({ status: 'pending' });
  });

  it('holds payouts from ₹20,000 earned in the year until the PAN is given, then 2% TDS on the excess only', async () => {
    const agent = await activeAgent();
    const adminUser = await makeUser('admin');
    const ids = await livePayouts(agent, 20); // ₹20,000 this year
    let view = await me(agent.session);
    expect(view).toMatchObject({
      fyEarnedPaise: 20 * AGENT_PAYOUT_PAISE,
      panOnFile: false,
      panPrompt: true,
      panRequired: true,
    });
    expect(view.payouts.every((p) => p.blocked === 'pan_required')).toBe(true);
    expect(view.payouts.every((p) => p.tdsPaise === 0)).toBe(true); // nothing above the threshold yet
    expect(
      errorCode(
        await adminDo(adminUser.session, adminPayoutSentHandler, ids[0]!, { utr: 'UTR000000002' }),
      ),
    ).toBe('pan_required');

    const pan = await call(agentPanHandler, {
      method: 'POST',
      session: agent.session,
      body: { pan: 'abcde1234f' },
    });
    expect(agentMeSchema.parse(pan.jsonBody)).toMatchObject({
      panOnFile: true,
      panRequired: false,
    });
    expect(
      (await adminDo(adminUser.session, adminPayoutSentHandler, ids[0]!, { utr: 'UTR000000002' }))
        .status,
    ).toBe(204);
    // the PAN is stored encrypted, only its last 4 in clear
    const [row] = await db().select().from(agents).where(eq(agents.userId, agent.user.id));
    expect(row!.panEnc).not.toContain('ABCDE1234F');
    expect(row!.panLast4).toBe('234F');

    // The 21st shop: ₹1,000 above the threshold → ₹20 TDS, ₹980 reaches the agent.
    await livePayouts(agent, 1);
    view = await me(agent.session);
    const latest = view.payouts[0]!;
    expect(latest).toMatchObject({ amountPaise: 100000, tdsPaise: 2000, netPaise: 98000 });
    expect(view.fyEarnedPaise).toBe(21 * AGENT_PAYOUT_PAISE);
  });

  it('a reversed payout suspends the agent; a UPI ID belongs to one agent', async () => {
    const agent = await activeAgent();
    const adminUser = await makeUser('admin');
    const [id] = await livePayouts(agent, 1);
    await adminDo(adminUser.session, adminPayoutSentHandler, id!, { utr: 'UTR000000003' });
    expect(
      (
        await adminDo(adminUser.session, adminPayoutReverseHandler, id!, {
          reason: 'Subscription refunded',
        })
      ).status,
    ).toBe(204);
    expect((await me(agent.session)).payouts[0]).toMatchObject({ status: 'reversed' });
    const [a] = await db().select().from(agents).where(eq(agents.userId, agent.user.id));
    expect(a!.status).toBe('suspended');

    const other = await makeUser();
    const reg = await call(agentRegisterHandler, {
      method: 'POST',
      session: other.session,
      body: {
        name: 'Other',
        upiId: 'shared@okaxis',
        acceptTerms: true,
        inductionVersion: INDUCTION_VERSION,
      },
    });
    expect(reg.status).toBe(201);
    const taken = await call(agentUpiHandler, {
      method: 'PUT',
      session: agent.session,
      body: { upiId: 'shared@okaxis' },
    });
    expect(errorCode(taken)).toBe('upi_in_use');
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
