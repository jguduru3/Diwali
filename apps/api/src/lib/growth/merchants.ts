// Agent-led merchant onboarding and the merchant subscription.
// draft → consented (owner's OTP or Approve link) → setup (agent captures the shop) → review
// (owner opens the link, approves and pays ₹1,999 + GST) → approved (owner gets the shop) →
// live (admin verified the licence). The agent's ₹1,000 is credited once, at live (G12, G13).
import { randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { and, asc, count, desc, eq, inArray, isNotNull, isNull, sql } from 'drizzle-orm';
import {
  AGENT_PAYOUT_PAISE,
  canOnboard,
  generateCode,
  isValidGstin,
  RECRUIT_REWARD_PAISE,
  SUBMIT_MIN_PRODUCTS,
  SUBSCRIPTION_GST_PAISE,
  SUBSCRIPTION_PAISE,
  SUBSCRIPTION_TOTAL_PAISE,
  TERMS_VERSIONS,
  type AgentMe,
  type AgentRegister,
  type MerchantDraft,
  type MerchantSetup,
  type NewMerchant,
  type OnboardingStatus,
  type ReviewPage,
} from '@pataka/shared';
import type { Db } from '../../db/client';
import {
  agentFeedback,
  agentPayouts,
  agents,
  influencers,
  items,
  merchantSubscriptions,
  ownerLinks,
  shopConsents,
  shopLicences,
  shopMembers,
  shops,
  termsAcceptances,
  users,
} from '../../db/schema';
import { audit } from '../audit';
import type { SessionUser } from '../auth';
import { itemImageUrl } from '../catalogue';
import { env } from '../env';
import { HttpError } from '../errors';
import { generateOtp, otpSender } from '../otp';
import { activeProvider, type ProviderEvent } from '../payments';
import {
  ensureWallet,
  maskPhone,
  notify,
  sha256,
  shopEvent,
  type DbOrTx,
  type Tx,
  uniqueCode,
  walletEntry,
  walletOf,
} from './common';

type AgentRow = typeof agents.$inferSelect;
type ShopRow = typeof shops.$inferSelect;

const CONSENT_TTL_MS = 10 * 60 * 1000;
const REVIEW_TTL_MS = 72 * 3_600_000;
const CONSENT_MAX_ATTEMPTS = 3;
const season = () => env.seasonEndDate().slice(0, 4);

// ---- Agents ----

export async function agentOf(db: DbOrTx, userId: string) {
  const [a] = await db.select().from(agents).where(eq(agents.userId, userId));
  return a ?? null;
}

/** Agent actions need an approved (active) agent. */
export async function requireActiveAgent(db: DbOrTx, user: SessionUser): Promise<AgentRow> {
  const a = await agentOf(db, user.id);
  if (!a) throw new HttpError(403, 'not_agent', 'Register as an agent first');
  if (a.status !== 'active') {
    throw new HttpError(403, 'agent_not_active', 'Your agent account is waiting for approval');
  }
  return a;
}

export async function registerAgent(db: Db, user: SessionUser, input: AgentRegister) {
  return db.transaction(async (tx) => {
    if (await agentOf(tx, user.id))
      throw new HttpError(409, 'already_agent', 'You are already registered');
    let recruitedBy: string | null = null;
    if (input.recruitCode) {
      const [inf] = await tx
        .select()
        .from(influencers)
        .where(and(eq(influencers.code, input.recruitCode), eq(influencers.status, 'active')));
      if (!inf) throw new HttpError(404, 'code_not_found', 'That influencer code was not found');
      // An influencer working as an agent gets no recruit bonus on themselves (G12).
      if (inf.userId !== user.id) recruitedBy = inf.id;
    }
    await ensureWallet(tx, user.id, input.upiId);
    const code = await uniqueCode(
      tx,
      'DXA',
      async (c) => !!(await tx.select({ id: agents.id }).from(agents).where(eq(agents.code, c)))[0],
    );
    const [a] = await tx
      .insert(agents)
      .values({
        userId: user.id,
        code,
        name: input.name,
        recruitedByInfluencerId: recruitedBy,
        agreementVersion: TERMS_VERSIONS.agent,
        agreementAcceptedAt: new Date(),
      })
      .returning();
    await tx
      .insert(termsAcceptances)
      .values({ userId: user.id, party: 'agent', version: TERMS_VERSIONS.agent })
      .onConflictDoNothing();
    await audit(tx, {
      actorUserId: user.id,
      action: 'agent.register',
      entity: 'agent',
      entityId: a!.id,
    });
    return a!;
  });
}

// ---- Merchant drafts ----

async function agentShop(db: DbOrTx, agent: AgentRow, shopId: string): Promise<ShopRow> {
  const [s] = await db
    .select()
    .from(shops)
    .where(and(eq(shops.id, shopId), eq(shops.onboardedByAgentId, agent.id)));
  if (!s) throw new HttpError(404, 'merchant_not_found', 'No such merchant');
  return s;
}

/** Compare-and-set on the onboarding status, with an event row. */
async function moveShop(
  tx: Tx,
  shop: ShopRow,
  to: OnboardingStatus,
  actorId: string | null,
  meta: Record<string, unknown> = {},
  extra: Partial<typeof shops.$inferInsert> = {},
): Promise<ShopRow> {
  if (!canOnboard(shop.onboardingStatus, to)) {
    throw new HttpError(409, 'bad_state', `This merchant is ${shop.onboardingStatus}`);
  }
  const [row] = await tx
    .update(shops)
    .set({ ...extra, onboardingStatus: to })
    .where(and(eq(shops.id, shop.id), eq(shops.onboardingStatus, shop.onboardingStatus)))
    .returning();
  if (!row) throw new HttpError(409, 'merchant_changed', 'This merchant changed; reload');
  await shopEvent(tx, shop.id, actorId, to, { from: shop.onboardingStatus, ...meta });
  return row;
}

const token = () => randomBytes(24).toString('base64url');
const linkUrl = (kind: 'approve' | 'review', t: string) => `${env.publicOrigin()}/m/${kind}/${t}`;

export async function missingForSubmit(db: DbOrTx, shop: ShopRow): Promise<string[]> {
  const missing: string[] = [];
  const [licence] = await db
    .select({ id: shopLicences.id })
    .from(shopLicences)
    .where(
      and(eq(shopLicences.shopId, shop.id), inArray(shopLicences.status, ['pending', 'verified'])),
    )
    .limit(1);
  if (!licence) missing.push('licence');
  if (!shop.gstin || !isValidGstin(shop.gstin)) missing.push('gstin');
  if (!shop.openFrom || !shop.openTo) missing.push('hours');
  if (shop.lat == null || shop.lng == null) missing.push('map');
  const [{ n } = { n: 0 }] = await db
    .select({ n: count() })
    .from(items)
    .where(
      and(
        eq(items.shopId, shop.id),
        eq(items.isActive, true),
        isNull(items.removedAt),
        isNotNull(items.imagePath),
      ),
    );
  if (n < SUBMIT_MIN_PRODUCTS) missing.push('products');
  return missing;
}

/** `ownerLink` is only known in the response that made it: the database keeps its hash. */
async function draftView(
  db: DbOrTx,
  agent: AgentRow,
  s: ShopRow,
  ownerLink: string | null = null,
): Promise<MerchantDraft> {
  const [consent] = await db
    .select({ id: shopConsents.id })
    .from(shopConsents)
    .where(eq(shopConsents.shopId, s.id));
  const [payout] = await db.select().from(agentPayouts).where(eq(agentPayouts.shopId, s.id));
  const [fb] = await db
    .select({ id: agentFeedback.id })
    .from(agentFeedback)
    .where(and(eq(agentFeedback.shopId, s.id), eq(agentFeedback.agentId, agent.id)));
  const [lastNote] = await db
    .execute<{ note: string | null }>(
      sql`select meta->>'note' as note from shop_events where shop_id = ${s.id} and meta ? 'note' order by at desc limit 1`,
    )
    .then((r) => r.rows);
  return {
    id: s.id,
    shopCode: s.shortCode,
    shopName: s.name,
    area: s.area,
    ownerName: s.ownerName,
    ownerPhoneMasked: maskPhone(s.ownerPhoneE164),
    status: s.onboardingStatus,
    consented: !!consent,
    missing: ['setup', 'consented'].includes(s.onboardingStatus)
      ? await missingForSubmit(db, s)
      : [],
    ownerLink,
    payout: payout ? payout.status : 'none',
    feedbackGiven: !!fb,
    note: lastNote?.note ?? null,
    updatedAt: s.updatedAt.toISOString(),
  };
}

export async function agentMe(db: Db, agent: AgentRow): Promise<AgentMe> {
  const rows = await db
    .select()
    .from(shops)
    .where(eq(shops.onboardedByAgentId, agent.id))
    .orderBy(desc(shops.updatedAt));
  return {
    code: agent.code,
    name: agent.name,
    status: agent.status,
    merchants: await Promise.all(rows.map((s) => draftView(db, agent, s))),
  };
}

/** Owner's consent: a 6-digit code by SMS (given to the agent) and an Approve link to forward. */
async function sendConsent(tx: Tx, shop: ShopRow): Promise<string> {
  const t = token();
  const code = generateOtp();
  await tx.insert(ownerLinks).values({
    shopId: shop.id,
    purpose: 'consent',
    tokenHash: sha256(t),
    codeHash: await bcrypt.hash(code, 8),
    expiresAt: new Date(Date.now() + CONSENT_TTL_MS),
  });
  await otpSender().send(shop.ownerPhoneE164!, code);
  return linkUrl('approve', t);
}

export async function createMerchant(db: Db, agent: AgentRow, input: NewMerchant) {
  const shop = await db.transaction(async (tx) => {
    // The owner's number must not already run a shop here (first confirmed consent wins).
    const [owner] = await tx
      .select({ id: shopMembers.shopId })
      .from(shopMembers)
      .innerJoin(users, eq(users.id, shopMembers.userId))
      .where(and(eq(users.phoneE164, input.ownerPhone), eq(shopMembers.role, 'shop_owner')))
      .limit(1);
    const [draft] = await tx
      .select({ agentId: shops.onboardedByAgentId })
      .from(shops)
      .where(
        and(eq(shops.ownerPhoneE164, input.ownerPhone), sql`${shops.onboardingStatus} <> 'closed'`),
      )
      .limit(1);
    if (owner || draft) {
      const [holder] = draft?.agentId
        ? await tx.select({ code: agents.code }).from(agents).where(eq(agents.id, draft.agentId))
        : [];
      throw new HttpError(
        409,
        'owner_exists',
        holder ? `This owner is already with ${holder.code}` : 'This owner already has a shop here',
      );
    }
    let shortCode = '';
    for (let i = 0; i < 10 && !shortCode; i++) {
      const c = `M${generateCode('DXA').slice(4, 9)}`;
      const [hit] = await tx.select({ id: shops.id }).from(shops).where(eq(shops.shortCode, c));
      if (!hit) shortCode = c;
    }
    const [s] = await tx
      .insert(shops)
      .values({
        shortCode,
        name: input.shopName,
        area: input.area,
        ownerName: input.ownerName,
        ownerPhoneE164: input.ownerPhone,
        phoneE164: input.ownerPhone,
        onboardingStatus: 'draft',
        onboardedByAgentId: agent.id,
        isLive: false,
      })
      .returning();
    await shopEvent(tx, s!.id, agent.userId, 'draft', { agent: agent.code });
    const link = await sendConsent(tx, s!);
    await audit(tx, {
      actorUserId: agent.userId,
      action: 'merchant.draft',
      entity: 'shop',
      entityId: s!.id,
    });
    return { s: s!, link };
  });
  return draftView(db, agent, shop.s, shop.link);
}

export async function resendConsent(db: Db, agent: AgentRow, shopId: string) {
  const shop = await agentShop(db, agent, shopId);
  if (shop.onboardingStatus !== 'draft')
    throw new HttpError(409, 'bad_state', 'Consent is already given');
  const [last] = await db
    .select({ at: ownerLinks.createdAt })
    .from(ownerLinks)
    .where(and(eq(ownerLinks.shopId, shop.id), eq(ownerLinks.purpose, 'consent')))
    .orderBy(desc(ownerLinks.createdAt))
    .limit(1);
  if (last && Date.now() - last.at.getTime() < CONSENT_TTL_MS) {
    throw new HttpError(429, 'resend_too_soon', 'Wait 10 minutes before sending the code again');
  }
  const link = await db.transaction((tx) => sendConsent(tx, shop));
  return draftView(db, agent, shop, link);
}

async function recordConsent(
  tx: Tx,
  shop: ShopRow,
  agentId: string | null,
  method: 'otp' | 'link',
  actor: string | null,
) {
  await tx
    .insert(shopConsents)
    .values({ shopId: shop.id, agentId, method, device: method === 'otp' ? 'agent' : null });
  const consented = await moveShop(tx, shop, 'consented', actor, { method });
  const setup = await moveShop(tx, consented, 'setup', actor);
  const [a] = shop.onboardedByAgentId
    ? await tx.select().from(agents).where(eq(agents.id, shop.onboardedByAgentId))
    : [];
  if (a) await notify(tx, a.userId, 'merchant.consented', { shop: shop.name });
  return setup;
}

/** The agent types the code the owner read out; three wrong codes lock it for an hour. */
export async function consentByCode(db: Db, agent: AgentRow, shopId: string, code: string) {
  const shop = await agentShop(db, agent, shopId);
  await db
    .transaction(async (tx) => {
      const [link] = await tx
        .select()
        .from(ownerLinks)
        .where(
          and(
            eq(ownerLinks.shopId, shop.id),
            eq(ownerLinks.purpose, 'consent'),
            isNull(ownerLinks.usedAt),
          ),
        )
        .orderBy(desc(ownerLinks.createdAt))
        .limit(1)
        .for('update');
      if (!link || link.expiresAt < new Date())
        throw new HttpError(400, 'otp_expired', 'The code expired. Send a new one.');
      if (link.lockedUntil && link.lockedUntil > new Date()) {
        throw new HttpError(429, 'otp_locked', 'Too many wrong codes. Try again in an hour.');
      }
      if (!(await bcrypt.compare(code, link.codeHash!))) {
        throw new HttpError(400, 'otp_wrong', 'Wrong code');
      }
      await tx.update(ownerLinks).set({ usedAt: new Date() }).where(eq(ownerLinks.id, link.id));
      await recordConsent(tx, shop, agent.id, 'otp', agent.userId);
    })
    .catch(async (e) => {
      // Count the wrong attempt outside the rolled-back transaction; three lock it for an hour.
      if (e instanceof HttpError && e.code === 'otp_wrong') {
        await db
          .update(ownerLinks)
          .set({
            attempts: sql`${ownerLinks.attempts} + 1`,
            lockedUntil: sql`case when ${ownerLinks.attempts} + 1 >= ${CONSENT_MAX_ATTEMPTS} then now() + interval '1 hour' else null end`,
          })
          .where(
            and(
              eq(ownerLinks.shopId, shop.id),
              eq(ownerLinks.purpose, 'consent'),
              isNull(ownerLinks.usedAt),
            ),
          );
      }
      throw e;
    });
  return draftView(db, agent, await agentShop(db, agent, shopId));
}

async function linkByToken(db: DbOrTx, purpose: 'consent' | 'review', t: string) {
  const [link] = await db
    .select()
    .from(ownerLinks)
    .where(and(eq(ownerLinks.tokenHash, sha256(t)), eq(ownerLinks.purpose, purpose)));
  if (!link) throw new HttpError(404, 'link_not_found', 'This link is not valid');
  const [shop] = await db.select().from(shops).where(eq(shops.id, link.shopId));
  return { link, shop: shop! };
}

/** The owner taps Approve in the message instead of reading out the code. */
export async function consentByLink(db: Db, t: string) {
  const { link, shop } = await linkByToken(db, 'consent', t);
  if (shop.onboardingStatus !== 'draft') return { shopName: shop.name, done: true };
  if (link.usedAt || link.expiresAt < new Date())
    throw new HttpError(410, 'link_expired', 'This link has expired');
  await db.transaction(async (tx) => {
    await tx.update(ownerLinks).set({ usedAt: new Date() }).where(eq(ownerLinks.id, link.id));
    await recordConsent(tx, shop, null, 'link', null);
  });
  return { shopName: shop.name, done: true };
}

export async function saveSetup(db: Db, agent: AgentRow, shopId: string, input: MerchantSetup) {
  const shop = await agentShop(db, agent, shopId);
  if (shop.onboardingStatus !== 'setup')
    throw new HttpError(409, 'bad_state', 'Setup is closed for this merchant');
  if (input.gstin !== undefined && input.gstin !== '' && !isValidGstin(input.gstin)) {
    throw new HttpError(400, 'gstin_invalid', 'That GSTIN is not valid');
  }
  if (input.openFrom && input.openTo && input.openFrom >= input.openTo) {
    throw new HttpError(400, 'invalid_body', 'Opening time must be before closing time');
  }
  const [row] = await db
    .update(shops)
    .set({
      ...(input.address !== undefined ? { address: input.address || null } : {}),
      ...(input.lat !== undefined ? { lat: input.lat } : {}),
      ...(input.lng !== undefined ? { lng: input.lng } : {}),
      ...(input.gstin !== undefined ? { gstin: input.gstin || null } : {}),
      ...(input.openFrom ? { openFrom: input.openFrom } : {}),
      ...(input.openTo ? { openTo: input.openTo } : {}),
    })
    .where(eq(shops.id, shop.id))
    .returning();
  await audit(db, {
    actorUserId: agent.userId,
    action: 'merchant.setup',
    entity: 'shop',
    entityId: shop.id,
    meta: input,
  });
  return draftView(db, agent, row!);
}

/** Everything is captured: send the owner the review-and-pay link (valid 72 hours). */
export async function submitMerchant(db: Db, agent: AgentRow, shopId: string) {
  const shop = await agentShop(db, agent, shopId);
  const missing = await missingForSubmit(db, shop);
  if (missing.length)
    throw new HttpError(409, 'setup_incomplete', `Still missing: ${missing.join(', ')}`);
  const t = token();
  await db.transaction(async (tx) => {
    await moveShop(tx, shop, 'review', agent.userId, { submittedBy: agent.code });
    await tx.insert(ownerLinks).values({
      shopId: shop.id,
      purpose: 'review',
      tokenHash: sha256(t),
      expiresAt: new Date(Date.now() + REVIEW_TTL_MS),
    });
  });
  return draftView(db, agent, await agentShop(db, agent, shopId), linkUrl('review', t));
}

/** The owner's review: their shop as customers will see it, the price, and the choices. */
export async function reviewPage(db: Db, t: string): Promise<ReviewPage> {
  const { link, shop } = await linkByToken(db, 'review', t);
  if (shop.onboardingStatus === 'review' && link.expiresAt < new Date()) {
    throw new HttpError(410, 'link_expired', 'This link has expired');
  }
  const rows = await db
    .select()
    .from(items)
    .where(and(eq(items.shopId, shop.id), eq(items.isActive, true), isNull(items.removedAt)))
    .orderBy(asc(items.itemNo));
  const [agent] = shop.onboardedByAgentId
    ? await db
        .select({ code: agents.code })
        .from(agents)
        .where(eq(agents.id, shop.onboardedByAgentId))
    : [];
  const [sub] = await db
    .select()
    .from(merchantSubscriptions)
    .where(eq(merchantSubscriptions.shopId, shop.id))
    .orderBy(desc(merchantSubscriptions.createdAt))
    .limit(1);
  return {
    shopName: shop.name,
    area: shop.area,
    ownerName: shop.ownerName,
    agentCode: agent?.code ?? null,
    status: shop.onboardingStatus,
    gstin: shop.gstin,
    openFrom: shop.openFrom?.slice(0, 5) ?? null,
    openTo: shop.openTo?.slice(0, 5) ?? null,
    items: rows.map((r) => ({
      name: r.nameEn,
      packDesc: r.packDesc,
      pricePaise: r.pricePaise,
      imageUrl: itemImageUrl(r),
    })),
    amountPaise: SUBSCRIPTION_PAISE,
    gstPaise: SUBSCRIPTION_GST_PAISE,
    subscription: sub
      ? {
          status: sub.status,
          method: sub.method,
          checkoutUrl: sub.status === 'pending' ? sub.checkoutUrl : null,
          reference: `SUB-${shop.shortCode}`,
        }
      : null,
  };
}

/** Approve and pay: online through the platform's fee adapter, or by bank transfer (admin marks it). */
export async function approveReview(db: Db, t: string, method: 'online' | 'offline') {
  const { link, shop } = await linkByToken(db, 'review', t);
  if (shop.onboardingStatus !== 'review')
    throw new HttpError(409, 'bad_state', 'This shop is not waiting for approval');
  if (link.expiresAt < new Date())
    throw new HttpError(410, 'link_expired', 'This link has expired');
  const [open] = await db
    .select()
    .from(merchantSubscriptions)
    .where(
      and(eq(merchantSubscriptions.shopId, shop.id), eq(merchantSubscriptions.status, 'pending')),
    );
  if (open && open.method === method) return reviewPage(db, t);
  if (open)
    await db
      .update(merchantSubscriptions)
      .set({ status: 'cancelled' })
      .where(eq(merchantSubscriptions.id, open.id));
  if (method === 'online') {
    const provider = activeProvider();
    const checkout = await provider.createCheckout({
      idempotencyKey: `sub:${shop.id}:${Date.now()}`,
      amountPaise: SUBSCRIPTION_TOTAL_PAISE,
      reference: `SUB-${shop.shortCode}`,
      returnPath: `/m/review/${t}`,
    });
    await db.insert(merchantSubscriptions).values({
      shopId: shop.id,
      season: season(),
      amountPaise: SUBSCRIPTION_PAISE,
      gstPaise: SUBSCRIPTION_GST_PAISE,
      method: 'online',
      provider: provider.name,
      checkoutId: checkout.checkoutId,
      checkoutUrl: checkout.url,
    });
  } else {
    await db.insert(merchantSubscriptions).values({
      shopId: shop.id,
      season: season(),
      amountPaise: SUBSCRIPTION_PAISE,
      gstPaise: SUBSCRIPTION_GST_PAISE,
      method: 'offline',
    });
  }
  await shopEvent(db, shop.id, null, 'approve_started', {
    method,
    termsVersion: TERMS_VERSIONS.merchant,
  });
  return reviewPage(db, t);
}

export async function reviewDecision(
  db: Db,
  t: string,
  kind: 'changes' | 'decline' | 'report',
  note: string,
) {
  const { shop } = await linkByToken(db, 'review', t);
  await db.transaction(async (tx) => {
    const [a] = shop.onboardedByAgentId
      ? await tx.select().from(agents).where(eq(agents.id, shop.onboardedByAgentId))
      : [];
    if (kind === 'changes') {
      await moveShop(tx, shop, 'setup', null, { note });
      if (a) await notify(tx, a.userId, 'merchant.changes', { shop: shop.name, note });
    } else {
      if (shop.onboardingStatus === 'live' || shop.onboardingStatus === 'approved') {
        throw new HttpError(409, 'bad_state', 'This shop is already approved');
      }
      await moveShop(tx, shop, 'closed', null, { note, kind });
      if (a && kind === 'report') {
        // "I never agreed": the agent is suspended pending review.
        await tx
          .update(agents)
          .set({ status: 'suspended', suspendedReason: `Owner report: ${note}` })
          .where(eq(agents.id, a.id));
      }
      if (a) await notify(tx, a.userId, 'merchant.closed', { shop: shop.name, note });
    }
  });
  return { status: kind === 'changes' ? 'setup' : 'closed' };
}

// ---- Payment of the subscription ----

/** Fee-adapter events for subscription checkouts (same signed webhook, same idempotency table). */
export async function applySubscriptionEvent(
  tx: Tx,
  provider: string,
  event: ProviderEvent,
  now: Date,
) {
  if (event.type !== 'payment.captured' && event.type !== 'payment.failed') return null;
  const [sub] = await tx
    .select()
    .from(merchantSubscriptions)
    .where(
      and(
        eq(merchantSubscriptions.provider, provider),
        eq(merchantSubscriptions.checkoutId, event.checkoutId),
      ),
    )
    .for('update');
  if (!sub) return null;
  if (event.amountPaise !== sub.amountPaise + sub.gstPaise) return 'amount_mismatch' as const;
  if (event.type === 'payment.failed') return 'payment_failed' as const;
  if (sub.status === 'paid') return 'already_captured' as const;
  await markSubscriptionPaid(tx, sub, { providerPaymentId: event.paymentId, paidAt: now });
  return 'placed' as const;
}

export async function markOfflinePaid(
  db: Db,
  adminId: string,
  subscriptionId: string,
  reference: string,
) {
  return db.transaction(async (tx) => {
    const [sub] = await tx
      .select()
      .from(merchantSubscriptions)
      .where(eq(merchantSubscriptions.id, subscriptionId))
      .for('update');
    if (!sub) throw new HttpError(404, 'subscription_not_found', 'No such subscription');
    if (sub.status !== 'pending')
      throw new HttpError(409, 'bad_state', `This subscription is ${sub.status}`);
    await markSubscriptionPaid(tx, sub, {
      offlineReference: reference,
      markedBy: adminId,
      paidAt: new Date(),
    });
    await audit(tx, {
      actorUserId: adminId,
      action: 'subscription.paid_offline',
      entity: 'subscription',
      entityId: sub.id,
      meta: { reference },
    });
  });
}

async function markSubscriptionPaid(
  tx: Tx,
  sub: typeof merchantSubscriptions.$inferSelect,
  patch: Partial<typeof merchantSubscriptions.$inferInsert>,
) {
  const [{ n }] = (
    await tx.execute<{ n: string }>(sql`select nextval('merchant_invoice_seq') as n`)
  ).rows as [{ n: string }];
  const invoiceNo = `DXE/${season()}/${String(n).padStart(6, '0')}`;
  await tx
    .update(merchantSubscriptions)
    .set({ ...patch, status: 'paid', invoiceNo })
    .where(eq(merchantSubscriptions.id, sub.id));
  const [shop] = await tx.select().from(shops).where(eq(shops.id, sub.shopId)).for('update');
  if (!shop || shop.onboardingStatus !== 'review') return;
  // The owner takes over: owner access now, the agent's setup access ends (status leaves setup).
  let [owner] = await tx.select().from(users).where(eq(users.phoneE164, shop.ownerPhoneE164!));
  if (!owner)
    [owner] = await tx
      .insert(users)
      .values({ phoneE164: shop.ownerPhoneE164!, displayName: shop.ownerName, role: 'shop_owner' })
      .returning();
  else if (owner.role === 'customer')
    await tx.update(users).set({ role: 'shop_owner' }).where(eq(users.id, owner.id));
  await tx
    .insert(shopMembers)
    .values({ shopId: shop.id, userId: owner!.id, role: 'shop_owner' })
    .onConflictDoNothing();
  await tx
    .insert(termsAcceptances)
    .values({ userId: owner!.id, party: 'merchant', version: TERMS_VERSIONS.merchant })
    .onConflictDoNothing();
  const approved = await moveShop(tx, shop, 'approved', null, { invoiceNo });
  const [a] = shop.onboardedByAgentId
    ? await tx.select().from(agents).where(eq(agents.id, shop.onboardedByAgentId))
    : [];
  if (a) await notify(tx, a.userId, 'merchant.approved', { shop: shop.name });
  await promoteIfReady(tx, approved.id);
}

// ---- Live and the agent's payout ----

/** Approved and paid, with a verified in-date licence: the shop goes live and the agent is paid. */
export async function promoteIfReady(tx: Tx, shopId: string) {
  const [shop] = await tx.select().from(shops).where(eq(shops.id, shopId)).for('update');
  if (!shop || shop.onboardingStatus !== 'approved') return false;
  const [licence] = await tx
    .select({ id: shopLicences.id })
    .from(shopLicences)
    .where(
      and(
        eq(shopLicences.shopId, shop.id),
        eq(shopLicences.status, 'verified'),
        sql`${shopLicences.validTo} >= (now() at time zone 'Asia/Kolkata')::date`,
      ),
    )
    .limit(1);
  if (!licence) return false;
  const live = await moveShop(tx, shop, 'live', null, {}, { isLive: true });
  await creditAgentPayout(tx, live);
  return true;
}

/**
 * ₹1,000 once per shop, only when an agent set it up with the owner's consent recorded from the
 * agent and submitted it themselves, the subscription is paid, and the agent is not a member of
 * the shop. Self-onboarded shops pay no one (G12).
 */
async function creditAgentPayout(tx: Tx, shop: ShopRow) {
  if (!shop.onboardedByAgentId) return;
  const [agent] = await tx.select().from(agents).where(eq(agents.id, shop.onboardedByAgentId));
  if (!agent || agent.status !== 'active') return;
  const [consent] = await tx.select().from(shopConsents).where(eq(shopConsents.shopId, shop.id));
  if (!consent) return;
  const [paid] = await tx
    .select({ id: merchantSubscriptions.id })
    .from(merchantSubscriptions)
    .where(
      and(eq(merchantSubscriptions.shopId, shop.id), eq(merchantSubscriptions.status, 'paid')),
    );
  if (!paid) return;
  const [member] = await tx
    .select({ id: shopMembers.userId })
    .from(shopMembers)
    .where(and(eq(shopMembers.shopId, shop.id), eq(shopMembers.userId, agent.userId)));
  if (member) return; // an agent onboarding their own shop earns nothing for it
  const wallet = await walletOf(tx, agent.userId);
  if (!wallet) return;
  const [payout] = await tx
    .insert(agentPayouts)
    .values({ agentId: agent.id, shopId: shop.id, amountPaise: AGENT_PAYOUT_PAISE })
    .onConflictDoNothing()
    .returning();
  if (!payout) return;
  await walletEntry(tx, wallet.id, 'onboarding', payout.id, AGENT_PAYOUT_PAISE);
  await notify(tx, agent.userId, 'merchant.live', {
    shop: shop.name,
    amountPaise: AGENT_PAYOUT_PAISE,
  });
  await audit(tx, {
    actorUserId: null,
    action: 'payout.credited',
    entity: 'agent_payout',
    entityId: payout.id,
  });
  // The influencer who brought this agent: ₹10 once, on the agent's first live merchant.
  if (agent.recruitedByInfluencerId) {
    const [inf] = await tx
      .select()
      .from(influencers)
      .where(eq(influencers.id, agent.recruitedByInfluencerId));
    const infWallet = inf && inf.status === 'active' ? await walletOf(tx, inf.userId) : null;
    if (infWallet)
      await walletEntry(tx, infWallet.id, 'recruit_reward', agent.id, RECRUIT_REWARD_PAISE);
  }
}

export async function reversePayout(db: Db, adminId: string, payoutId: string, reason: string) {
  await db.transaction(async (tx) => {
    const [p] = await tx
      .select()
      .from(agentPayouts)
      .where(eq(agentPayouts.id, payoutId))
      .for('update');
    if (!p) throw new HttpError(404, 'payout_not_found', 'No such payout');
    if (p.status === 'reversed') return;
    const [agent] = await tx.select().from(agents).where(eq(agents.id, p.agentId));
    const wallet = await walletOf(tx, agent!.userId);
    await tx
      .update(agentPayouts)
      .set({ status: 'reversed', reversedAt: new Date() })
      .where(eq(agentPayouts.id, p.id));
    // The balance may go negative until later earnings cover it.
    if (wallet) await walletEntry(tx, wallet.id, 'reversal', `payout:${p.id}`, -p.amountPaise);
    await tx
      .update(agents)
      .set({ status: 'suspended', suspendedReason: reason })
      .where(eq(agents.id, p.agentId));
    await audit(tx, {
      actorUserId: adminId,
      action: 'payout.reversed',
      entity: 'agent_payout',
      entityId: p.id,
      meta: { reason },
    });
  });
}

export async function giveFeedback(
  db: Db,
  agent: AgentRow,
  shopId: string,
  helped: boolean,
  note?: string,
) {
  const shop = await agentShop(db, agent, shopId);
  if (shop.onboardingStatus !== 'live')
    throw new HttpError(409, 'bad_state', 'Feedback opens when the shop is live');
  await db
    .insert(agentFeedback)
    .values({ agentId: agent.id, shopId: shop.id, helped, note: note || null })
    .onConflictDoNothing();
  return draftView(db, agent, shop);
}

// ---- Jobs ----

/** Hourly: shops approved and paid whose licence was verified since go live (and pay out). */
export async function payoutCheck(db: Db): Promise<number> {
  const rows = await db
    .select({ id: shops.id })
    .from(shops)
    .where(eq(shops.onboardingStatus, 'approved'));
  let n = 0;
  for (const r of rows) if (await db.transaction((tx) => promoteIfReady(tx, r.id))) n++;
  return n;
}

/**
 * Hourly: an owner who has not answered the review link gets the agent reminded at 24 h and
 * at 48 h (each once; the agent forwards the link again). Returns the reminders sent.
 */
export async function onboardingReminders(db: Db, now = new Date()): Promise<number> {
  const rows = await db
    .select({ shop: shops, sentAt: ownerLinks.createdAt })
    .from(shops)
    .innerJoin(
      ownerLinks,
      and(
        eq(ownerLinks.shopId, shops.id),
        eq(ownerLinks.purpose, 'review'),
        isNull(ownerLinks.usedAt),
      ),
    )
    .where(eq(shops.onboardingStatus, 'review'));
  let n = 0;
  for (const { shop, sentAt } of rows) {
    const hours = (now.getTime() - sentAt.getTime()) / 3_600_000;
    const due = hours >= 48 ? 'reminder_48' : hours >= 24 ? 'reminder_24' : null;
    if (!due || !shop.onboardedByAgentId) continue;
    const [sent] = await db
      .execute<{ id: string }>(
        sql`select id from shop_events where shop_id = ${shop.id} and type = ${due} limit 1`,
      )
      .then((r) => r.rows);
    if (sent) continue;
    const [a] = await db.select().from(agents).where(eq(agents.id, shop.onboardedByAgentId));
    if (!a) continue;
    await db.transaction(async (tx) => {
      await shopEvent(tx, shop.id, null, due);
      await notify(tx, a.userId, 'merchant.reminder', {
        shop: shop.name,
        hours: due === 'reminder_48' ? 48 : 24,
      });
    });
    n++;
  }
  return n;
}

/** Hourly: review links unanswered for 72 hours and drafts without consent for 7 days close. */
export async function onboardingExpiry(db: Db, now = new Date()): Promise<number> {
  const stale = await db
    .select()
    .from(shops)
    .where(
      and(
        inArray(shops.onboardingStatus, ['draft', 'review']),
        sql`${shops.updatedAt} < ${now}::timestamptz - case when ${shops.onboardingStatus} = 'draft' then interval '7 days' else interval '72 hours' end`,
      ),
    );
  let n = 0;
  for (const s of stale) {
    await db
      .transaction(async (tx) => {
        await moveShop(tx, s, 'closed', null, { note: 'expired' });
        const [a] = s.onboardedByAgentId
          ? await tx.select().from(agents).where(eq(agents.id, s.onboardedByAgentId))
          : [];
        if (a) await notify(tx, a.userId, 'merchant.closed', { shop: s.name, note: 'expired' });
      })
      .then(() => n++)
      .catch(() => {});
  }
  return n;
}
