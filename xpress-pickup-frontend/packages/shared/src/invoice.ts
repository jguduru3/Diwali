// GST tax invoices for what the platform charges (G3): the customer's platform fee and the
// merchant's season subscription. Both prices include GST. Pure rules, shared by the API (which
// numbers and issues the invoices) and the web (which shows and prints them).
import { z } from 'zod';

/**
 * SAC 996211: services provided for a fee or on a contract basis on retail trade. The platform's
 * service, to customers and to shops alike, is enabling a retail shop's sale. 18% GST.
 * (Owner's choice from 998316, 997158, 996211 and 998551, 2026-11-04; confirm with the CA.)
 */
export const PLATFORM_SAC = '996211';
export const GST_RATE_PERCENT = 18;

export type GstSplit = {
  taxablePaise: number;
  cgstPaise: number;
  sgstPaise: number;
  gstPaise: number;
  totalPaise: number;
};

/**
 * Splits a GST-inclusive price into taxable value and tax. Supplier and customers are in
 * Telangana, so the tax is CGST + SGST at half the rate each; an odd paisa goes to SGST.
 */
export function gstFromInclusive(totalPaise: number): GstSplit {
  const taxablePaise = Math.round((totalPaise * 100) / (100 + GST_RATE_PERCENT));
  const gstPaise = totalPaise - taxablePaise;
  const cgstPaise = Math.floor(gstPaise / 2);
  return { taxablePaise, cgstPaise, sgstPaise: gstPaise - cgstPaise, gstPaise, totalPaise };
}

/** Invoice series: XPF for platform fees, XPS for merchant subscriptions. */
export type InvoiceSeries = 'XPF' | 'XPS';

/** `XPF/2627/000042`: series, financial year, serial; at most 16 characters (GST rule 46). */
export function invoiceNumber(series: InvoiceSeries | string, fy: string, n: number): string {
  const [a, b] = fy.split('-');
  return `${series}/${a!.slice(2)}${b}/${String(n).padStart(6, '0')}`;
}

const party = z.object({
  name: z.string().nullable(),
  address: z.string().nullable(),
  gstin: z.string().nullable(),
  phone: z.string().nullable(),
});

/** A tax invoice as the app shows and prints it. */
export const taxInvoiceSchema = z.object({
  kind: z.enum(['platform_fee', 'subscription']),
  invoiceNo: z.string(),
  issuedAt: z.string(),
  supplier: party.extend({ stateCode: z.string(), state: z.string() }),
  recipient: party,
  placeOfSupply: z.string(),
  lines: z.array(
    z.object({
      description: z.string(),
      sac: z.string(),
      qty: z.number(),
      taxablePaise: z.number(),
    }),
  ),
  ratePercent: z.number(),
  taxablePaise: z.number(),
  cgstPaise: z.number(),
  sgstPaise: z.number(),
  totalPaise: z.number(),
  /** the order or shop this invoice belongs to, as the person knows it */
  reference: z.string(),
  /** the fee was refunded afterwards (a credit note is issued against this invoice) */
  refunded: z.boolean(),
});
export type TaxInvoice = z.infer<typeof taxInvoiceSchema>;
