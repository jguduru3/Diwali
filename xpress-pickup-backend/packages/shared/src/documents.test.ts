import { describe, expect, it } from 'vitest';
import { documentSubmitSchema, gstinChecksum, isValidGstin, MERCHANT_DOC_TYPES } from './documents';

const file = { contentType: 'application/pdf' as const, base64: 'J'.repeat(200) };

describe('GSTIN', () => {
  it('accepts a well-formed GSTIN with the right check character', () => {
    expect(gstinChecksum('27AAPFU0939F1Z')).toBe('V');
    expect(isValidGstin('27AAPFU0939F1ZV')).toBe(true);
    expect(isValidGstin('27aapfu0939f1zv')).toBe(true);
  });

  it('refuses a wrong check character, state code or shape', () => {
    expect(isValidGstin('27AAPFU0939F1ZX')).toBe(false);
    expect(isValidGstin('99AAPFU0939F1ZV')).toBe(false);
    expect(isValidGstin('27AAPFU0939F1V')).toBe(false);
    expect(isValidGstin('27AAPF00939F1ZV')).toBe(false);
  });
});

describe('document upload body', () => {
  it('has five document types', () => {
    expect(MERCHANT_DOC_TYPES).toEqual([
      'fire_licence',
      'police_clearance',
      'govt_authority_licence',
      'gst_certificate',
      'business_registration',
    ]);
  });

  it('needs a valid GSTIN for the GST certificate', () => {
    expect(
      documentSubmitSchema.safeParse({ docType: 'gst_certificate', docNumber: 'ABC123', file })
        .success,
    ).toBe(false);
    const ok = documentSubmitSchema.safeParse({
      docType: 'gst_certificate',
      docNumber: '27aapfu0939f1zv',
      file,
    });
    expect(ok.success && ok.data.docNumber).toBe('27AAPFU0939F1ZV');
  });

  it('needs an expiry date for licences and clearances, not for registrations', () => {
    expect(
      documentSubmitSchema.safeParse({ docType: 'fire_licence', docNumber: 'FIRE/22/001', file })
        .success,
    ).toBe(false);
    expect(
      documentSubmitSchema.safeParse({
        docType: 'fire_licence',
        docNumber: 'FIRE/22/001',
        validTo: '2026-11-30',
        file,
      }).success,
    ).toBe(true);
    expect(
      documentSubmitSchema.safeParse({
        docType: 'business_registration',
        docNumber: 'UDYAM-TS-02-0001234',
        file,
      }).success,
    ).toBe(true);
  });

  it('refuses valid-from after valid-to, unknown fields and unknown file types', () => {
    expect(
      documentSubmitSchema.safeParse({
        docType: 'police_clearance',
        docNumber: 'PS/123',
        validFrom: '2026-12-01',
        validTo: '2026-11-30',
        file,
      }).success,
    ).toBe(false);
    expect(
      documentSubmitSchema.safeParse({
        docType: 'police_clearance',
        docNumber: 'PS/123',
        validTo: '2026-11-30',
        file,
        status: 'verified',
      }).success,
    ).toBe(false);
    expect(
      documentSubmitSchema.safeParse({
        docType: 'police_clearance',
        docNumber: 'PS/123',
        validTo: '2026-11-30',
        file: { contentType: 'text/html', base64: 'J'.repeat(200) },
      }).success,
    ).toBe(false);
  });
});
