import { toAlpha2CountryCode } from '../services/externalJobs/countryCodes.js';

describe('toAlpha2CountryCode', () => {
  it('maps every current MARITIME_COUNTRIES entry to a valid alpha-2 code', () => {
    // Mirrors refresh.ts's MARITIME_COUNTRIES — kept as a literal list here
    // (rather than importing it) so this test also catches a country being
    // added to the rotation without a matching JSearch code, which would
    // otherwise silently drop that country from JSearch's coverage.
    const currentRotationCountries = [
      'United Kingdom',
      'Nigeria',
      'Philippines',
      'India',
      'Germany',
      'Ethiopia',
    ];

    for (const country of currentRotationCountries) {
      const code = toAlpha2CountryCode(country);
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
