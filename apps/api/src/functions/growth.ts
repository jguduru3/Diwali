// Growth program endpoints: agents, influencers, wallets, referrals and credit, the owner's
// consent and review links, kits, terms, notifications, settlements and their admin screens.
import type { HttpRequest, HttpResponseInit } from '@azure/functions';
import { and, desc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  agentFeedbackSchema,
  agentRegisterSchema,
  claimReferralSchema,
  codeSchema,
  consentCodeSchema,
  growthReasonSchema,
  influencerRegisterSchema,
  KIT_TYPES,
  merchantSetupSchema,
  newMerchantSchema,
  offlinePaidSchema,
  orderCreditSchema,
  panSetSchema,
  reviewApproveSchema,
  reviewNoteSchema,
  TERMS_VERSIONS,
  termsAcceptSchema,
  utrSchema,
  withdrawSchema,
} from '@pataka/shared';
import { getDb } from '../db/client';
import {
  agentFeedback,
  agentPayouts,
  agents,
  influencers,
  merchantSubscriptions,
  notifications,
  shops,
  termsAcceptances,
  users,
} from '../db/schema';
import { requireShop, requireUuidParam } from '../lib/access';
import { audit } from '../lib/audit';
import { requireRole, requireUser } from '../lib/auth';
import { HttpError } from '../lib/errors';
import { maskPhone, walletOf } from '../lib/growth/common';
import { kitOffers, kitTypes } from '../lib/growth/kits';
import {
  agentMe,
  agentOf,
  approveReview,
  consentByCode,
  consentByLink,
  createMerchant,
  giveFeedback,
  markOfflinePaid,
  registerAgent,
  requireActiveAgent,
  resendConsent,
  reversePayout,
  reviewDecision,
  reviewPage,
  saveSetup,
  submitMerchant,
} from '../lib/growth/merchants';
import { claimReferral, creditView, requestOrderCredit } from '../lib/growth/referrals';
import {
  markSettlementPaid,
  requestSettlement,
  settlementViews,
  shopSettlements,
} from '../lib/growth/settlements';
import {
  adminWithdrawals,
  influencerMe,
  influencerOf,
  recordLinkVisit,
  markWithdrawalFailed,
  markWithdrawalSent,
  registerInfluencer,
  setFrozen,
  setPan,
  walletView,
  withdraw,
} from '../lib/growth/wallet';
import { clientIp, http, json, parseBody } from '../lib/http';
import { rateLimit } from '../lib/rateLimit';

const db = () => getDb();
const ok = json;

// ---- Me: profiles, credit, referrals, terms, notifications ----

/** GET /api/me/profiles — which growth roles this person has. */
export async function profilesHandler(req: HttpRequest): Promise<HttpResponseInit> {
  const user = await requireUser(db(), req);
  const [a, i, w] = await Promise.all([
    agentOf(db(), user.id),
    influencerOf(db(), user.id),
    walletOf(db(), user.id),
  ]);
  return ok({ agent: a?.status ?? null, influencer: i?.status ?? null, wallet: !!w });
}

/** GET /api/me/credit — My wallet (customer credit): balance, history, referral code. */
export async function creditHandler(req: HttpRequest): Promise<HttpResponseInit> {
  const user = await requireUser(db(), req);
  return ok(await creditView(db(), user.id));
}

/** POST /api/referrals/claim {code} — before the first order, once. */
export async function claimHandler(req: HttpRequest): Promise<HttpResponseInit> {
  const user = await requireUser(db(), req);
  await rateLimit(db(), `claim:${user.id}`, 10, 3600);
  const { code } = await parseBody(req, claimReferralSchema);
  return ok(await claimReferral(db(), user.id, code));
}

/** POST /api/orders/{id}/credit {amountPaise} — ask to use credit at pickup. */
export async function orderCreditHandler(req: HttpRequest): Promise<HttpResponseInit> {
  const user = await requireUser(db(), req);
  const { amountPaise } = await parseBody(req, orderCreditSchema);
  const applied = await requestOrderCredit(db(), user.id, requireUuidParam(req, 'id'), amountPaise);
  return ok({ creditRequestedPaise: applied });
}

/** GET /api/terms — current versions and what this person accepted. */
export async function termsHandler(req: HttpRequest): Promise<HttpResponseInit> {
  const user = await requireUser(db(), req);
  const rows = await db()
    .select({ party: termsAcceptances.party, version: termsAcceptances.version })
    .from(termsAcceptances)
    .where(eq(termsAcceptances.userId, user.id));
  return ok({ versions: TERMS_VERSIONS, accepted: rows });
}

/** POST /api/terms/accept {party} — accepts the current version. */
export async function termsAcceptHandler(req: HttpRequest): Promise<HttpResponseInit> {
  const user = await requireUser(db(), req);
  const { party } = await parseBody(req, termsAcceptSchema);
  await db()
    .insert(termsAcceptances)
    .values({ userId: user.id, party, version: TERMS_VERSIONS[party] })
    .onConflictDoNothing();
  return termsHandler(req);
}

export async function notificationsHandler(req: HttpRequest): Promise<HttpResponseInit> {
  const user = await requireUser(db(), req);
  const rows = await db()
    .select()
    .from(notifications)
    .where(eq(notifications.userId, user.id))
    .orderBy(desc(notifications.createdAt))
    .limit(50);
  return ok(
    rows.map((n) => ({
      id: n.id,
      type: n.type,
      params: n.params as Record<string, unknown> | null,
      read: !!n.readAt,
      at: n.createdAt.toISOString(),
    })),
  );
}

export async function notificationsReadHandler(req: HttpRequest): Promise<HttpResponseInit> {
  const user = await requireUser(db(), req);
  await db()
    .update(notifications)
    .set({ readAt: new Date() })
    .where(and(eq(notifications.userId, user.id), sql`${notifications.readAt} is null`));
  return { status: 204 };
}

// ---- Kits (public) ----

export async function kitsHandler(): Promise<HttpResponseInit> {
  return json(await kitTypes(db()), 200, { 'Cache-Control': 'public, max-age=30' });
}

const coord = z.coerce.number().finite().optional();
export async function kitOffersHandler(req: HttpRequest): Promise<HttpResponseInit> {
  const type = z.enum(KIT_TYPES).parse(req.params.type);
  const lat = coord.parse(req.query.get('lat') ?? undefined);
  const lng = coord.parse(req.query.get('lng') ?? undefined);
  const origin = lat !== undefined && lng !== undefined ? { lat, lng } : null;
  return json(await kitOffers(db(), type, origin), 200, {
    'Cache-Control': origin ? 'private, max-age=30' : 'public, max-age=30',
  });
}

// ---- Agents ----

export async function agentRegisterHandler(req: HttpRequest): Promise<HttpResponseInit> {
  const user = await requireUser(db(), req);
  const input = await parseBody(req, agentRegisterSchema);
  const a = await registerAgent(db(), user, input);
  return ok(await agentMe(db(), a), 201);
}

export async function agentMeHandler(req: HttpRequest): Promise<HttpResponseInit> {
  const user = await requireUser(db(), req);
  const a = await agentOf(db(), user.id);
  if (!a) throw new HttpError(404, 'not_agent', 'Register as an agent first');
  return ok(await agentMe(db(), a));
}

const agent = async (req: HttpRequest) => requireActiveAgent(db(), await requireUser(db(), req));

export async function merchantNewHandler(req: HttpRequest): Promise<HttpResponseInit> {
  const a = await agent(req);
  await rateLimit(db(), `merchant-new:${a.id}`, 30, 3600);
  return ok(await createMerchant(db(), a, await parseBody(req, newMerchantSchema)), 201);
}

export async function merchantConsentHandler(req: HttpRequest): Promise<HttpResponseInit> {
  const a = await agent(req);
  const { code } = await parseBody(req, consentCodeSchema);
  return ok(await consentByCode(db(), a, requireUuidParam(req, 'id'), code));
}

export async function merchantResendHandler(req: HttpRequest): Promise<HttpResponseInit> {
  const a = await agent(req);
  return ok(await resendConsent(db(), a, requireUuidParam(req, 'id')));
}

export async function merchantSetupHandler(req: HttpRequest): Promise<HttpResponseInit> {
  const a = await agent(req);
  return ok(
    await saveSetup(
      db(),
      a,
      requireUuidParam(req, 'id'),
      await parseBody(req, merchantSetupSchema),
    ),
  );
}

export async function merchantSubmitHandler(req: HttpRequest): Promise<HttpResponseInit> {
  const a = await agent(req);
  return ok(await submitMerchant(db(), a, requireUuidParam(req, 'id')));
}

export async function merchantFeedbackHandler(req: HttpRequest): Promise<HttpResponseInit> {
  const a = await agent(req);
  const { helped, note } = await parseBody(req, agentFeedbackSchema);
  return ok(await giveFeedback(db(), a, requireUuidParam(req, 'id'), helped, note));
}

// ---- Owner links (no sign-in; the token is the proof) ----

const ownerLimit = (req: HttpRequest) =>
  rateLimit(db(), `owner-link:${clientIp(req) ?? 'unknown'}`, 60, 600);
const tokenParam = (req: HttpRequest) =>
  z
    .string()
    .regex(/^[A-Za-z0-9_-]{20,64}$/)
    .parse(req.params.token);

export async function ownerApproveHandler(req: HttpRequest): Promise<HttpResponseInit> {
  await ownerLimit(req);
  return ok(await consentByLink(db(), tokenParam(req)));
}

export async function ownerReviewHandler(req: HttpRequest): Promise<HttpResponseInit> {
  await ownerLimit(req);
  return ok(await reviewPage(db(), tokenParam(req)));
}

export async function ownerReviewApproveHandler(req: HttpRequest): Promise<HttpResponseInit> {
  await ownerLimit(req);
  const { method } = await parseBody(req, reviewApproveSchema);
  return ok(await approveReview(db(), tokenParam(req), method));
}

export const ownerDecision =
  (kind: 'changes' | 'decline' | 'report') => async (req: HttpRequest) => {
    await ownerLimit(req);
    const { note } = await parseBody(req, reviewNoteSchema);
    return ok(await reviewDecision(db(), tokenParam(req), kind, note));
  };

// ---- Influencers and wallets ----

export async function influencerRegisterHandler(req: HttpRequest): Promise<HttpResponseInit> {
  const user = await requireUser(db(), req);
  await registerInfluencer(db(), user, await parseBody(req, influencerRegisterSchema));
  return ok(await influencerMe(db(), user.id), 201);
}

/** A visit to a shared /r/ link (no sign-in). Only an influencer's own counter changes. */
export async function linkVisitHandler(req: HttpRequest): Promise<HttpResponseInit> {
  await rateLimit(db(), `visit:${clientIp(req) ?? 'unknown'}`, 30, 3600);
  const code = codeSchema.safeParse(req.params.code);
  if (code.success) await recordLinkVisit(db(), code.data);
  return { status: 204 };
}

export async function influencerMeHandler(req: HttpRequest): Promise<HttpResponseInit> {
  const user = await requireUser(db(), req);
  return ok(await influencerMe(db(), user.id));
}

export async function walletHandler(req: HttpRequest): Promise<HttpResponseInit> {
  const user = await requireUser(db(), req);
  return ok(await walletView(db(), user.id));
}

/** POST /api/wallet/withdraw {amountPaise}; header Idempotency-Key makes a retry safe. */
export async function withdrawHandler(req: HttpRequest): Promise<HttpResponseInit> {
  const user = await requireUser(db(), req);
  await rateLimit(db(), `withdraw:${user.id}`, 30, 3600);
  const { amountPaise } = await parseBody(req, withdrawSchema);
  const key = z.string().min(8).max(80).safeParse(req.headers.get('idempotency-key'));
  return ok(await withdraw(db(), user.id, amountPaise, key.success ? key.data : `${Date.now()}`));
}

export async function panHandler(req: HttpRequest): Promise<HttpResponseInit> {
  const user = await requireUser(db(), req);
  const { pan } = await parseBody(req, panSetSchema);
  return ok(await setPan(db(), user.id, pan));
}

// ---- Shop: credit settlements ----

export async function shopSettlementsHandler(req: HttpRequest): Promise<HttpResponseInit> {
  const { shop } = await requireShop(db(), req, { ownerOnly: true });
  return ok(await shopSettlements(db(), shop.id));
}

export async function shopSettlementRequestHandler(req: HttpRequest): Promise<HttpResponseInit> {
  const { shop, user } = await requireShop(db(), req, { ownerOnly: true });
  await requestSettlement(db(), shop.id, user.id);
  return ok(await shopSettlements(db(), shop.id), 201);
}

// ---- Admin ----

const admin = (req: HttpRequest) => requireRole(db(), req, ['admin']);
const statusQ = <const T extends [string, ...string[]]>(req: HttpRequest, values: T) =>
  z
    .enum(values)
    .optional()
    .parse(req.query.get('status') || undefined);

export async function adminAgentsHandler(req: HttpRequest): Promise<HttpResponseInit> {
  await admin(req);
  const status = statusQ(req, ['pending', 'active', 'suspended']);
  const rows = await db()
    .select({
      a: agents,
      phone: users.phoneE164,
      recruitedBy: influencers.code,
      merchants: sql<number>`(select count(*)::int from shops s where s.onboarded_by_agent_id = ${agents.id})`,
      live: sql<number>`(select count(*)::int from shops s where s.onboarded_by_agent_id = ${agents.id} and s.onboarding_status = 'live')`,
    })
    .from(agents)
    .innerJoin(users, eq(users.id, agents.userId))
    .leftJoin(influencers, eq(influencers.id, agents.recruitedByInfluencerId))
    .where(status ? eq(agents.status, status) : undefined)
    .orderBy(desc(agents.createdAt))
    .limit(500);
  return ok(
    rows.map((r) => ({
      id: r.a.id,
      code: r.a.code,
      name: r.a.name,
      phoneMasked: maskPhone(r.phone),
      status: r.a.status,
      merchants: r.merchants,
      live: r.live,
      recruitedBy: r.recruitedBy,
      createdAt: r.a.createdAt.toISOString(),
    })),
  );
}

const setStatus =
  (table: typeof agents | typeof influencers, status: 'active' | 'suspended', entity: string) =>
  async (req: HttpRequest): Promise<HttpResponseInit> => {
    const u = await admin(req);
    const id = requireUuidParam(req, 'id');
    const reason =
      status === 'suspended' ? (await parseBody(req, growthReasonSchema)).reason : null;
    const [row] = await db()
      .update(table)
      .set(
        status === 'active'
          ? { status, approvedBy: u.id, approvedAt: new Date() }
          : ({ status, ...(table === agents ? { suspendedReason: reason } : {}) } as never),
      )
      .where(eq(table.id, id))
      .returning();
    if (!row) throw new HttpError(404, 'not_found', 'Not found');
    await audit(db(), {
      actorUserId: u.id,
      action: `${entity}.${status}`,
      entity,
      entityId: id,
      meta: { reason },
    });
    return { status: 204 };
  };

export async function adminInfluencersHandler(req: HttpRequest): Promise<HttpResponseInit> {
  await admin(req);
  const status = statusQ(req, ['pending', 'active', 'suspended']);
  const rows = await db()
    .select({
      i: influencers,
      referred: sql<number>`(select count(*)::int from referrals r where r.referrer_user_id = ${influencers.userId})`,
    })
    .from(influencers)
    .where(status ? eq(influencers.status, status) : undefined)
    .orderBy(desc(influencers.createdAt))
    .limit(500);
  return ok(
    rows.map((r) => ({
      id: r.i.id,
      code: r.i.code,
      handle: r.i.handle,
      platform: r.i.platform,
      status: r.i.status,
      referred: r.referred,
      createdAt: r.i.createdAt.toISOString(),
    })),
  );
}

export async function adminWithdrawalsHandler(req: HttpRequest): Promise<HttpResponseInit> {
  await admin(req);
  return ok(await adminWithdrawals(db(), statusQ(req, ['requested', 'sent', 'failed']) ?? null));
}

export async function adminWithdrawalSentHandler(req: HttpRequest): Promise<HttpResponseInit> {
  const u = await admin(req);
  const { utr } = await parseBody(req, utrSchema);
  await markWithdrawalSent(db(), u.id, requireUuidParam(req, 'id'), utr);
  return { status: 204 };
}

export async function adminWithdrawalFailedHandler(req: HttpRequest): Promise<HttpResponseInit> {
  const u = await admin(req);
  const { reason } = await parseBody(req, growthReasonSchema);
  await markWithdrawalFailed(db(), u.id, requireUuidParam(req, 'id'), reason);
  return { status: 204 };
}

export async function adminWalletFreezeHandler(req: HttpRequest): Promise<HttpResponseInit> {
  const u = await admin(req);
  const { reason } = await parseBody(req, growthReasonSchema);
  await setFrozen(db(), u.id, requireUuidParam(req, 'id'), true, reason);
  return { status: 204 };
}

export async function adminWalletUnfreezeHandler(req: HttpRequest): Promise<HttpResponseInit> {
  const u = await admin(req);
  await setFrozen(db(), u.id, requireUuidParam(req, 'id'), false);
  return { status: 204 };
}

export async function adminSettlementsHandler(req: HttpRequest): Promise<HttpResponseInit> {
  await admin(req);
  return ok(await settlementViews(db(), { status: statusQ(req, ['pending', 'paid']) }));
}

export async function adminSettlementPaidHandler(req: HttpRequest): Promise<HttpResponseInit> {
  const u = await admin(req);
  const { utr } = await parseBody(req, utrSchema);
  await markSettlementPaid(db(), u.id, requireUuidParam(req, 'id'), utr);
  return { status: 204 };
}

export async function adminSubscriptionsHandler(req: HttpRequest): Promise<HttpResponseInit> {
  await admin(req);
  const status = statusQ(req, ['pending', 'paid', 'refunded', 'cancelled']);
  const rows = await db()
    .select({ s: merchantSubscriptions, code: shops.shortCode, name: shops.name })
    .from(merchantSubscriptions)
    .innerJoin(shops, eq(shops.id, merchantSubscriptions.shopId))
    .where(status ? eq(merchantSubscriptions.status, status) : undefined)
    .orderBy(desc(merchantSubscriptions.createdAt))
    .limit(500);
  return ok(
    rows.map((r) => ({
      id: r.s.id,
      shopCode: r.code,
      shopName: r.name,
      method: r.s.method,
      status: r.s.status,
      totalPaise: r.s.amountPaise + r.s.gstPaise,
      reference: `SUB-${r.code}`,
      invoiceNo: r.s.invoiceNo,
      createdAt: r.s.createdAt.toISOString(),
    })),
  );
}

export async function adminSubscriptionPaidHandler(req: HttpRequest): Promise<HttpResponseInit> {
  const u = await admin(req);
  const { reference } = await parseBody(req, offlinePaidSchema);
  await markOfflinePaid(db(), u.id, requireUuidParam(req, 'id'), reference);
  return { status: 204 };
}

export async function adminFeedbackHandler(req: HttpRequest): Promise<HttpResponseInit> {
  await admin(req);
  const rows = await db()
    .select({ f: agentFeedback, agent: agents.code, shop: shops.shortCode })
    .from(agentFeedback)
    .innerJoin(agents, eq(agents.id, agentFeedback.agentId))
    .innerJoin(shops, eq(shops.id, agentFeedback.shopId))
    .orderBy(desc(agentFeedback.at))
    .limit(500);
  return ok(
    rows.map((r) => ({
      agentCode: r.agent,
      shopCode: r.shop,
      helped: r.f.helped,
      note: r.f.note,
      at: r.f.at.toISOString(),
    })),
  );
}

export async function adminPayoutsHandler(req: HttpRequest): Promise<HttpResponseInit> {
  await admin(req);
  const rows = await db()
    .select({ p: agentPayouts, agent: agents.code, shop: shops.shortCode })
    .from(agentPayouts)
    .innerJoin(agents, eq(agents.id, agentPayouts.agentId))
    .innerJoin(shops, eq(shops.id, agentPayouts.shopId))
    .orderBy(desc(agentPayouts.earnedAt))
    .limit(500);
  return ok(
    rows.map((r) => ({
      id: r.p.id,
      agentCode: r.agent,
      shopCode: r.shop,
      amountPaise: r.p.amountPaise,
      status: r.p.status,
      at: r.p.earnedAt.toISOString(),
    })),
  );
}

export async function adminPayoutReverseHandler(req: HttpRequest): Promise<HttpResponseInit> {
  const u = await admin(req);
  const { reason } = await parseBody(req, growthReasonSchema);
  await reversePayout(db(), u.id, requireUuidParam(req, 'id'), reason);
  return { status: 204 };
}

http('meProfiles', ['GET'], 'me/profiles', profilesHandler);
http('meCredit', ['GET'], 'me/credit', creditHandler);
http('referralClaim', ['POST'], 'referrals/claim', claimHandler);
http('orderCredit', ['POST'], 'orders/{id}/credit', orderCreditHandler);
http('terms', ['GET'], 'terms', termsHandler);
http('termsAccept', ['POST'], 'terms/accept', termsAcceptHandler);
http('notifications', ['GET'], 'notifications', notificationsHandler);
http('notificationsRead', ['POST'], 'notifications/read', notificationsReadHandler);
http('kits', ['GET'], 'kits', kitsHandler);
http('kitOffers', ['GET'], 'kits/{type}', kitOffersHandler);
http('agentRegister', ['POST'], 'agent/register', agentRegisterHandler);
http('agentMe', ['GET'], 'agent/me', agentMeHandler);
http('agentMerchantNew', ['POST'], 'agent/merchants/new', merchantNewHandler);
http('agentMerchantConsent', ['POST'], 'agent/merchants/{id}/consent', merchantConsentHandler);
http('agentMerchantResend', ['POST'], 'agent/merchants/{id}/resend', merchantResendHandler);
http('agentMerchantSetup', ['PUT'], 'agent/merchants/{id}/setup', merchantSetupHandler);
http('agentMerchantSubmit', ['POST'], 'agent/merchants/{id}/submit', merchantSubmitHandler);
http('agentMerchantFeedback', ['POST'], 'agent/merchants/{id}/feedback', merchantFeedbackHandler);
http('ownerApprove', ['POST'], 'm/approve/{token}', ownerApproveHandler);
http('ownerReview', ['GET'], 'm/review/{token}', ownerReviewHandler);
http('ownerReviewApprove', ['POST'], 'm/review/{token}/approve', ownerReviewApproveHandler);
http('ownerReviewChanges', ['POST'], 'm/review/{token}/changes', ownerDecision('changes'));
http('ownerReviewDecline', ['POST'], 'm/review/{token}/decline', ownerDecision('decline'));
http('ownerReviewReport', ['POST'], 'm/review/{token}/report', ownerDecision('report'));
http('influencerRegister', ['POST'], 'influencer/register', influencerRegisterHandler);
http('influencerMe', ['GET'], 'influencer/me', influencerMeHandler);
http('linkVisit', ['POST'], 'r/{code}/visit', linkVisitHandler);
http('wallet', ['GET'], 'wallet', walletHandler);
http('walletWithdraw', ['POST'], 'wallet/withdraw', withdrawHandler);
http('walletPan', ['POST'], 'wallet/pan', panHandler);
http('shopSettlements', ['GET'], 'shop/settlements', shopSettlementsHandler);
http('shopSettlementRequest', ['POST'], 'shop/settlements/request', shopSettlementRequestHandler);
http('consoleAgents', ['GET'], 'console/agents', adminAgentsHandler);
http(
  'consoleAgentApprove',
  ['POST'],
  'console/agents/{id}/approve',
  setStatus(agents, 'active', 'agent'),
);
http(
  'consoleAgentSuspend',
  ['POST'],
  'console/agents/{id}/suspend',
  setStatus(agents, 'suspended', 'agent'),
);
http('consoleInfluencers', ['GET'], 'console/influencers', adminInfluencersHandler);
http(
  'consoleInfluencerApprove',
  ['POST'],
  'console/influencers/{id}/approve',
  setStatus(influencers, 'active', 'influencer'),
);
http(
  'consoleInfluencerSuspend',
  ['POST'],
  'console/influencers/{id}/suspend',
  setStatus(influencers, 'suspended', 'influencer'),
);
http('consoleWithdrawals', ['GET'], 'console/withdrawals', adminWithdrawalsHandler);
http(
  'consoleWithdrawalSent',
  ['POST'],
  'console/withdrawals/{id}/sent',
  adminWithdrawalSentHandler,
);
http(
  'consoleWithdrawalFailed',
  ['POST'],
  'console/withdrawals/{id}/failed',
  adminWithdrawalFailedHandler,
);
http('consoleWalletFreeze', ['POST'], 'console/wallets/{id}/freeze', adminWalletFreezeHandler);
http(
  'consoleWalletUnfreeze',
  ['POST'],
  'console/wallets/{id}/unfreeze',
  adminWalletUnfreezeHandler,
);
http('consoleSettlements', ['GET'], 'console/settlements', adminSettlementsHandler);
http(
  'consoleSettlementPaid',
  ['POST'],
  'console/settlements/{id}/paid',
  adminSettlementPaidHandler,
);
http('consoleSubscriptions', ['GET'], 'console/subscriptions', adminSubscriptionsHandler);
http(
  'consoleSubscriptionPaid',
  ['POST'],
  'console/subscriptions/{id}/paid-offline',
  adminSubscriptionPaidHandler,
);
http('consoleAgentFeedback', ['GET'], 'console/agent-feedback', adminFeedbackHandler);
http('consolePayouts', ['GET'], 'console/payouts', adminPayoutsHandler);
http('consolePayoutReverse', ['POST'], 'console/payouts/{id}/reverse', adminPayoutReverseHandler);
