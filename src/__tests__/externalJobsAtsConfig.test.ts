import {
  parseAtsConfig,
  parseWorkdaySites,
} from '../services/externalJobs/ats/config.js';

describe('parseAtsConfig', () => {
  it('returns nothing for an unset value', () => {
    expect(parseAtsConfig(undefined)).toEqual([]);
    expect(parseAtsConfig('')).toEqual([]);
  });

  it('parses a bare id with no label', () => {
    expect(parseAtsConfig('acmeshipping')).toEqual([{ id: 'acmeshipping' }]);
  });

  it('parses an id:label pair', () => {
    expect(parseAtsConfig('acmeshipping:Acme Shipping Co')).toEqual([
      { id: 'acmeshipping', label: 'Acme Shipping Co' },
    ]);
  });

  it('trims whitespace around entries and around the id/label split', () => {
    expect(parseAtsConfig(' acme : Acme Co ')).toEqual([
      { id: 'acme', label: 'Acme Co' },
    ]);
  });

  it('parses several comma-separated entries, dropping empty ones', () => {
    expect(parseAtsConfig('acme, ,globex:Globex Corp,')).toEqual([
      { id: 'acme' },
      { id: 'globex', label: 'Globex Corp' },
    ]);
  });
});

describe('parseWorkdaySites', () => {
  it('returns nothing for an unset value', () => {
    expect(parseWorkdaySites(undefined)).toEqual([]);
  });

  it('parses a bare URL with no label, colons intact', () => {
    const url = 'https://acme.wd1.myworkdayjobs.com/wday/cxs/acme/External';
    expect(parseWorkdaySites(url)).toEqual([{ url }]);
  });

  it('parses a url|label pair', () => {
    const url = 'https://acme.wd1.myworkdayjobs.com/wday/cxs/acme/External';
    expect(parseWorkdaySites(`${url}|Acme Shipping`)).toEqual([
      { url, label: 'Acme Shipping' },
    ]);
  });

  it('parses multiple comma-separated tenants', () => {
    const a = 'https://acme.wd1.myworkdayjobs.com/wday/cxs/acme/External';
    const b = 'https://globex.wd3.myworkdayjobs.com/wday/cxs/globex/Careers';
    expect(parseWorkdaySites(`${a},${b}|Globex`)).toEqual([
      { url: a },
      { url: b, label: 'Globex' },
    ]);
  });
});
