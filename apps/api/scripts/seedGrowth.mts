// Growth program demo data (dev/demo only), built through the same code paths as the app so
// wallets, payouts, referrals and credit follow the real rules (G12, G13). Safe to run again: each part
// skips itself when it is already there.
import { and, eq } from 'drizzle-orm';
import type { Db } from '../src/db/client';
import {
  agents,
  categories,
  influencers,
  items,
  merchantSubscriptions,
  orders,
  referrals,
  shopLicences,
  shops,
  users,
  withdrawals,
} from '../src/db/schema';
import {
  approveReview,
  consentByLink,
  createMerchant,
  registerAgent,
  saveSetup,
  submitMerchant,
  markOfflinePaid,
} from '../src/lib/growth/merchants';
import {
  claimReferral,
  ensureReferralCode,
  qualifyReferralOnPacked,
} from '../src/lib/growth/referrals';
import { markWithdrawalSent, registerInfluencer, withdraw } from '../src/lib/growth/wallet';

type User = typeof users.$inferSelect;

export interface GrowthSeedHelpers {
  phone: (n: number) => string;
  upsertCustomer: (n: number, name: string) => Promise<User>;
  /** creates (or finds) a demo order with the ₹30 fee captured */
  demoOrder: (n: number, code: string, status: 'placed' | 'packed') => Promise<void>;
  adminId: string;
}

const grocery: [string, string, string, string, number][] = [
  ['Sona Masoori rice', 'సోనా మసూరి బియ్యం', 'सोना मसूरी चावल', '5 kg', 42000],
  ['Toor dal', 'కంది పప్పు', 'तूर दाल', '1 kg', 16000],
  ['Sunflower oil', 'సన్‌ఫ్లవర్ నూనె', 'सूरजमुखी तेल', '1 L', 15500],
  ['Sugar', 'చక్కెర', 'चीनी', '1 kg', 4800],
  ['Wheat atta', 'గోధుమ పిండి', 'गेहूँ का आटा', '5 kg', 26000],
  ['Tea powder', 'టీ పొడి', 'चाय पत्ती', '250 g', 13000],
  ['Ghee', 'నెయ్యి', 'घी', '500 ml', 33000],
  ['Besan', 'శనగ పిండి', 'बेसन', '500 g', 6500],
  ['Jaggery', 'బెల్లం', 'गुड़', '1 kg', 7000],
  ['Cashew', 'జీడిపప్పు', 'काजू', '250 g', 25000],
];

export async function seedGrowth(db: Db, h: GrowthSeedHelpers) {
  const agentUser = await h.upsertCustomer(61, 'Ramesh Kumar');

  // Influencer: approved, with visits to the shared link.
  const infUser = await h.upsertCustomer(71, 'Divya Rao');
  if (!(await db.select().from(influencers).where(eq(influencers.userId, infUser.id))).length)
    await registerInfluencer(db, infUser, {
      handle: '@hyd_festive_finds',
      platform: 'instagram',
      upiId: 'demo.influencer@okicici',
      acceptTerms: true,
    });
  await db
    .update(influencers)
    .set({ status: 'active', approvedBy: h.adminId, approvedAt: new Date(), linkVisits: 128 })
    .where(eq(influencers.userId, infUser.id));
  const [inf] = await db.select().from(influencers).where(eq(influencers.userId, infUser.id));

  // A new agent waiting for the admin's approval (Admin → Agents → Pending).
  const pendingUser = await h.upsertCustomer(62, 'Sravani Reddy');
  if (!(await db.select().from(agents).where(eq(agents.userId, pendingUser.id))).length)
    await registerAgent(db, pendingUser, {
      name: 'Sravani Reddy',
      upiId: 'demo.newagent@okaxis',
      acceptTerms: true,
    });

  // Agent (gig worker) recruited by the influencer, approved by the admin.
  const [existing] = await db.select().from(agents).where(eq(agents.userId, agentUser.id));
  if (!existing)
    await registerAgent(db, agentUser, {
      name: 'Ramesh Kumar',
      upiId: 'demo.agent@okhdfc',
      recruitCode: inf!.code,
      acceptTerms: true,
    });
  await db
    .update(agents)
    .set({ status: 'active', approvedBy: h.adminId, approvedAt: new Date() })
    .where(eq(agents.userId, agentUser.id));
  const [agent] = await db.select().from(agents).where(eq(agents.userId, agentUser.id));
  async function seedMerchants() {
    const [cat] = await db
      .insert(categories)
      .values({ slug: 'grocery', nameEn: 'Grocery', nameTe: 'కిరాణా', nameHi: 'किराना', sort: 90 })
      .onConflictDoUpdate({ target: categories.slug, set: { nameEn: 'Grocery' } })
      .returning();

    /** Draft → owner consent (the owner's link) → set up → submitted for the owner's review. */
    async function onboard(
      name: string,
      area: string,
      owner: [number, string],
      at: [number, number],
      licence: 'pending' | 'verified',
    ) {
      const draft = await createMerchant(db, agent!, {
        shopName: name,
        area,
        ownerName: owner[1],
        ownerPhone: h.phone(owner[0]),
      });
      await consentByLink(db, draft.ownerLink!.split('/m/approve/')[1]!);
      await db.insert(shopLicences).values({
        shopId: draft.id,
        licenceNo: `TL/HYD/2026/${owner[0]}`,
        licenceType: 'Trade licence',
        issuedBy: 'GHMC',
        validFrom: '2026-04-01',
        validTo: '2027-03-31',
        imageBlobPath: 'seed/demo-licence.png',
        status: licence,
        ...(licence === 'verified' ? { verifiedAt: new Date(), verifiedBy: h.adminId } : {}),
      });
      let n = 0;
      for (const [en, te, hi, pack, pricePaise] of grocery) {
        n++;
        await db.insert(items).values({
          shopId: draft.id,
          itemNo: n,
          categoryId: cat!.id,
          nameEn: en,
          nameTe: te,
          nameHi: hi,
          packDesc: pack,
          saleMode: 'mrp',
          pricePaise,
          barcode: `89${owner[0]}${String(n).padStart(4, '0')}`,
          imagePath: 'seed/demo-licence.png',
        });
      }
      await saveSetup(db, agent!, draft.id, {
        gstin: '36AAPFU0939F1ZW',
        openFrom: '08:00',
        openTo: '22:00',
        lat: at[0],
        lng: at[1],
        address: `Main Road, ${area}`,
      });
      const submitted = await submitMerchant(db, agent!, draft.id);
      return { id: draft.id, review: submitted.ownerLink!.split('/m/review/')[1]! };
    }

    // 1. Live: the owner approved and paid by bank transfer, licence verified → ₹1,000 to the
    //    agent and ₹10 to the influencer who recruited them.
    const live = await onboard(
      'Sri Venkateswara Kirana',
      'Kukatpally',
      [65, 'Venkat Rao'],
      [17.4948, 78.3996],
      'verified',
    );
    await approveReview(db, live.review, 'offline');
    const [sub] = await db
      .select()
      .from(merchantSubscriptions)
      .where(
        and(eq(merchantSubscriptions.shopId, live.id), eq(merchantSubscriptions.status, 'pending')),
      );
    await markOfflinePaid(db, h.adminId, sub!.id, 'NEFT DEMO000001');

    // 2. Waiting for the owner to approve the review link.
    const review = await onboard(
      'Lakshmi General Stores',
      'Miyapur',
      [66, 'Lakshmi Devi'],
      [17.4968, 78.3614],
      'pending',
    );

    // 3. New draft: waiting for the owner's consent.
    await createMerchant(db, agent!, {
      shopName: 'Balaji Super Market',
      area: 'Madhapur',
      ownerName: 'Balaji N',
      ownerPhone: h.phone(67),
    });

    // Agent wallet: one withdrawal sent (UTR recorded), one waiting for the admin.
    await withdraw(db, agentUser.id, 50000, 'seed-withdrawal-1');
    const [w1] = await db.select().from(withdrawals).where(eq(withdrawals.amountPaise, 50000));
    await markWithdrawalSent(db, h.adminId, w1!.id, 'UTR612345678901');
    await withdraw(db, agentUser.id, 20000, 'seed-withdrawal-2');
    return review.review;
  }

  const [hasShops] = await db
    .select({ id: shops.id })
    .from(shops)
    .where(eq(shops.onboardedByAgentId, agent!.id));
  const reviewToken = hasShops ? null : await seedMerchants();

  // Customer referrals: Ravi (+91 90000 00099) shared his code with Anil and Meena;
  // Anil's first order is packed (₹10 credit to Ravi), Meena has not ordered yet.
  // Kiran came through the influencer's link; his first order is packed (₹10 to her wallet).
  const raviCode = await ensureReferralCode(
    db,
    (
      await db
        .select()
        .from(users)
        .where(eq(users.phoneE164, h.phone(99)))
    )[0]!.id,
  );
  const referred: [number, string, string, string | null][] = [
    [93, 'Anil Varma', raviCode, 'DEM093'],
    [94, 'Meena Iyer', raviCode, null],
    [95, 'Kiran Goud', inf!.code, 'DEM095'],
  ];
  for (const [n, name, code, orderCode] of referred) {
    const u = await h.upsertCustomer(n, name);
    const [claimed] = await db.select().from(referrals).where(eq(referrals.refereeUserId, u.id));
    if (!claimed) await claimReferral(db, u.id, code);
    if (!orderCode) continue;
    await h.demoOrder(n, orderCode, 'packed');
    const [o] = await db.select().from(orders).where(eq(orders.code, orderCode));
    await db.transaction((tx) => qualifyReferralOnPacked(tx, o!));
  }

  return { agentCode: agent!.code, influencerCode: inf!.code, reviewToken };
}
