import { describe, expect, it } from 'vitest';
import { healthResponseSchema } from './schemas';

describe('healthResponseSchema', () => {
  it('accepts the health payload', () => {
    expect(healthResponseSchema.parse({ ok: true, db: true })).toEqual({ ok: true, db: true });
  });

  it('rejects extra keys', () => {
    expect(() => healthResponseSchema.parse({ ok: true, db: true, extra: 1 })).toThrow();
  });
});
