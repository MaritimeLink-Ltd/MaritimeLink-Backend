import {
  ApiKeyPool,
  maskApiKey,
  resolveApiKeys,
} from '../services/externalJobs/apiKeyPool.js';

describe('resolveApiKeys', () => {
  it('keeps configured keys in slot order', () => {
    expect(resolveApiKeys(['a', 'b', 'c'])).toEqual(['a', 'b', 'c']);
  });

  it('drops blank, whitespace-only, and missing slots', () => {
    expect(resolveApiKeys(['a', '', '   ', undefined, null, 'b'])).toEqual([
      'a',
      'b',
    ]);
  });

  it('collapses a duplicated key, since one key is one quota', () => {
    expect(resolveApiKeys(['a', 'b', 'a'])).toEqual(['a', 'b']);
  });

  it('trims surrounding whitespace from a pasted key', () => {
    expect(resolveApiKeys([' a '])).toEqual(['a']);
  });
});

describe('ApiKeyPool', () => {
  const pool = (allowances: Array<[string, number]>) =>
    new ApiKeyPool(allowances.map(([key, allowance]) => ({ key, allowance })));

  it('sums each key’s allowance into the day’s budget', () => {
    expect(
      pool([
        ['a', 8],
        ['b', 8],
        ['c', 8],
      ]).totalAllowance,
    ).toBe(24);
  });

  it('ignores keys with no allowance left', () => {
    const p = pool([
      ['a', 8],
      ['b', 0],
    ]);
    expect(p.keyCount).toBe(1);
    expect(p.totalAllowance).toBe(8);
  });

  it('hands out keys round-robin so usage stays level across them', () => {
    const p = pool([
      ['a', 2],
      ['b', 2],
    ]);
    expect([p.take(), p.take(), p.take(), p.take()]).toEqual([
      'a',
      'b',
      'a',
      'b',
    ]);
  });

  it('returns null once every key is spent', () => {
    const p = pool([['a', 1]]);
    expect(p.take()).toBe('a');
    expect(p.take()).toBeNull();
  });

  it('skips a key that has been retired and keeps serving the others', () => {
    const p = pool([
      ['a', 4],
      ['b', 4],
    ]);
    p.markExhausted('a');

    expect(p.liveKeyCount).toBe(1);
    expect(p.totalAllowance).toBe(4);
    expect([p.take(), p.take()]).toEqual(['b', 'b']);
  });

  it('refunds an unspent claim back to its key', () => {
    const p = pool([['a', 1]]);
    const key = p.take();
    expect(p.totalAllowance).toBe(0);

    p.refund(key as string);
    expect(p.totalAllowance).toBe(1);
  });

  it('never refunds a retired key back into service', () => {
    const p = pool([['a', 2]]);
    p.markExhausted('a');
    p.refund('a');

    expect(p.totalAllowance).toBe(0);
    expect(p.take()).toBeNull();
  });

  it('clamps a key down to what the provider says is actually left', () => {
    const p = pool([['a', 6]]);
    p.clampRemaining('a', 2);
    expect(p.totalAllowance).toBe(2);
  });

  it('never raises an allowance above the budgeted daily share', () => {
    const p = pool([['a', 6]]);
    // A key with 190 searches left this month still only gets today's share.
    p.clampRemaining('a', 190);
    expect(p.totalAllowance).toBe(6);
  });

  it('treats an empty pool as configured-but-spent, not a crash', () => {
    const p = pool([]);
    expect(p.keyCount).toBe(0);
    expect(p.totalAllowance).toBe(0);
    expect(p.take()).toBeNull();
    expect(p.describe()).toBe('no keys configured');
  });
});

describe('maskApiKey', () => {
  it('shows only the last four characters of a real key', () => {
    expect(
      maskApiKey('371f7a50b6msh31f205ecd18ac15p127fccjsn925a3d971a4c'),
    ).toBe('…1a4c');
  });

  it('fully masks a key too short to partially reveal', () => {
    expect(maskApiKey('abcd')).toBe('****');
  });
});
