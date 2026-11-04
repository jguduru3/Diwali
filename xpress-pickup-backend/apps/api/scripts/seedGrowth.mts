// Growth program demo data (dev/demo only), built through the same code paths as the app so
// onboarding and agent payouts follow the real rules (G12, G13). Safe to run again: each part
// skips itself when it is already there.
import { INDUCTION_VERSION } from '@pataka/shared';
import { and, eq } from 'drizzle-orm';
import type { Db } from '../src/db/client';
import {
  agentPayouts,
  agents,
  categories,
  items,
  merchantSubscriptions,
  shopLicences,
  shops,
  users,
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
import { markPayoutSent } from '../src/lib/growth/payouts';

type User = typeof users.$inferSelect;

export interface GrowthSeedHelpers {
  phone: (n: number) => string;
  upsertCustomer: (n: number, name: string) => Promise<User>;
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

  // A new agent waiting for the admin's approval (Admin → Agents → Pending).
  const pendingUser = await h.upsertCustomer(62, 'Sravani Reddy');
  if (!(await db.select().from(agents).where(eq(agents.userId, pendingUser.id))).length)
    await registerAgent(db, pendingUser, {
      name: 'Sravani Reddy',
      upiId: 'demo.newagent@okaxis',
      acceptTerms: true,
      inductionVersion: INDUCTION_VERSION,
    });

  // Agent (gig worker), approved by the admin.
  const [existing] = await db.select().from(agents).where(eq(agents.userId, agentUser.id));
  if (!existing)
    await registerAgent(db, agentUser, {
      name: 'Ramesh Kumar',
      upiId: 'demo.agent@okhdfc',
      acceptTerms: true,
      inductionVersion: INDUCTION_VERSION,
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
          imageOpenPath: 'seed/demo-licence.png',
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

    /** The owner approves and pays by bank transfer; with the licence verified it goes live. */
    async function goLive(token: string, shopId: string, reference: string) {
      await approveReview(db, token, 'offline');
      const [sub] = await db
        .select()
        .from(merchantSubscriptions)
        .where(
          and(
            eq(merchantSubscriptions.shopId, shopId),
            eq(merchantSubscriptions.status, 'pending'),
          ),
        );
      await markOfflinePaid(db, h.adminId, sub!.id, reference);
    }

    // 1. Live and paid out: the ₹1,000 went to the agent's UPI ID (UTR recorded).
    const live = await onboard(
      'Sri Venkateswara Kirana',
      'Kukatpally',
      [65, 'Venkat Rao'],
      [17.4948, 78.3996],
      'verified',
    );
    await goLive(live.review, live.id, 'NEFT DEMO000001');
    const [paid] = await db.select().from(agentPayouts).where(eq(agentPayouts.shopId, live.id));
    await markPayoutSent(db, h.adminId, paid!.id, 'UTR612345678901');

    // 1b. Live, payout waiting for the admin to send it (Admin → Payouts).
    const second = await onboard(
      'Annapurna Provisions',
      'Nizampet',
      [68, 'Annapurna K'],
      [17.5155, 78.3852],
      'verified',
    );
    await goLive(second.review, second.id, 'NEFT DEMO000002');

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

    return review.review;
  }

  const [hasShops] = await db
    .select({ id: shops.id })
    .from(shops)
    .where(eq(shops.onboardedByAgentId, agent!.id));
  const reviewToken = hasShops ? null : await seedMerchants();

  return { agentCode: agent!.code, reviewToken };
}
