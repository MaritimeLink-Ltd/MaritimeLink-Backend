import { toAlpha2CountryCode } from '../services/externalJobs/countryCodes.js';
import { MARITIME_COUNTRIES } from '../services/externalJobs/queryGrid.js';

describe('toAlpha2CountryCode', () => {
  it('maps every country in the live rotation to a valid alpha-2 code', () => {
    // Imported from the real grid rather than duplicated here, so a country
    // added to the rotation without a matching JSearch code fails this test
    // instead of silently losing all JSearch coverage for that country.
    for (const { name } of MARITIME_COUNTRIES) {
      const code = toAlpha2CountryCode(name);
      expect(code).not.toBeNull();
      expect(code).toMatch(/^[a-z]{2}$/);
    }
  });

  it('returns the expected code for a known country', () => {
    expect(toAlpha2CountryCode('United Kingdom')).toBe('gb');
    expect(toAlpha2CountryCode('Nigeria')).toBe('ng');
    expect(toAlpha2CountryCode('Philippines')).toBe('ph');
  });

  it('returns null for an unmapped country rather than guessing', () => {
    expect(toAlpha2CountryCode('Atlantis')).toBeNull();
  });
});
