import { describe, expect, it } from 'vitest';
import { fillTemplate, PUSH_KINDS } from '@pataka/shared';
import en from './en.json';
import te from './te.json';

describe('push notification text (read by the service worker)', () => {
  it.each(PUSH_KINDS)('%s has a title and body in English and Telugu', (kind) => {
    for (const lang of [en, te]) {
      const text = (lang.push as Record<string, { title: string; body: string }>)[kind];
      expect(text?.title).toBeTruthy();
      expect(text?.body).toBeTruthy();
    }
  });

  it('fills placeholders and blanks unknown ones', () => {
    expect(fillTemplate(en.push.order_packed.title, { packNo: 7 })).toBe('Packed — pack no. 7');
    expect(fillTemplate('{{ shop }}/{{x}}', { shop: 'Sri' })).toBe('Sri/');
  });
});
