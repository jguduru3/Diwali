import { describe, expect, it } from 'vitest';
import { pickHighlights } from './DemoSwitcher';

const acc = (phone: string, role: string, profile: 'agent' | 'influencer' | null = null) => ({
  phone,
  role,
  profile,
  displayName: null,
  context: null,
});

describe('demo highlights', () => {
  it('shows one account per role, and agents and influencers as their own kind', () => {
    const shown = pickHighlights([
      acc('+919000000099', 'customer'),
      acc('+919000000095', 'customer'),
      acc('+919000000061', 'customer', 'agent'),
      acc('+919000000062', 'customer', 'agent'),
      acc('+919000000071', 'customer', 'influencer'),
      acc('+919000000001', 'admin'),
    ]);
    expect(shown.map((a) => a.phone)).toEqual([
      '+919000000099',
      '+919000000061',
      '+919000000071',
      '+919000000001',
    ]);
  });
});
