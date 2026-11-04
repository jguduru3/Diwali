import { afterEach, describe, expect, it } from 'vitest';
import i18n from '../i18n';
import { categoryName, itemName } from './format';

const names = { nameEn: 'Flower pots', nameTe: 'చిచ్చుబుడ్లు', nameHi: 'अनार' };

describe('localised names', () => {
  afterEach(() => i18n.changeLanguage('en'));

  it('uses the name for the current language', async () => {
    expect(itemName(names)).toBe('Flower pots');
    await i18n.changeLanguage('te');
    expect(itemName(names)).toBe('చిచ్చుబుడ్లు');
    await i18n.changeLanguage('hi');
    expect(itemName(names)).toBe('अनार');
    expect(categoryName(names)).toBe('अनार');
  });

  it('falls back to English when a translation is missing', async () => {
    await i18n.changeLanguage('hi');
    expect(itemName({ ...names, nameHi: null })).toBe('Flower pots');
    await i18n.changeLanguage('te');
    expect(categoryName({ ...names, nameTe: null })).toBe('Flower pots');
  });
});
