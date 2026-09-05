/**
 * Multi-key quota pooling for the metered job providers.
 *
 * SerpApi and JSearch both meter per *key*, not per account, so several free
 * keys behave as one larger quota: 3 SerpApi keys = 750 searches/month rather
 * than 250. This module is what lets the refresh treat them that way — it
 * hands out keys one search at a time, tracks what each has left, and drops a
 * key for the rest of the run the moment it reports itself out.
 *
 * Deliberately stateless across runs: allowances are rebuilt every refresh
 * from env + (for SerpApi) a live quota check, so nothing here has to be
 * persisted or kept in sync with the providers' own counters.
 */

/**
 * Collects a provider's configured keys in slot order, dropping blanks and
 * duplicates. Duplicates matter: the same key pasted into two slots is one
 * quota, not two, and counting it twice would silently overrun the monthly cap.
 */
export const resolveApiKeys = (
  values: Array<string | undefined | null>,
): string[] => {
  const seen = new Set<string>();

  for (const value of values) {
    const key = String(value ?? '').trim();
    if (key) seen.add(key);
  }

  return [...seen];
};

/** Enough of a key to identify it in logs, without printing the secret. */
export const maskApiKey = (key: string): string =>
  key.length <= 4 ? '****' : `…${key.slice(-4)}`;

export type KeyAllowance = {
  key: string;
  /** Searches this key may spend in this run. */
  allowance: number;
};

/**
 * Round-robin dispenser over a set of keys, each with its own spend ceiling
 * for this run.
 *
 * Round-robin rather than draining one key at a time: it keeps the keys'
 * monthly usage level with each other, so a mid-month failure of any single
 * key costs a third of the day's searches instead of all of them.
 */
export class ApiKeyPool {
  private readonly remaining = new Map<string, number>();
  /**
   * Keys the provider has told us are out. Tracked apart from a zero
   * allowance, which only means "today's share is spent" — a spent key can
   * still take a refund, a retired one never can.
   */
  private readonly retired = new Set<string>();
  private readonly order: string[];
  private cursor = 0;

  constructor(allowances: KeyAllowance[]) {
    this.order = allowances
      .filter(({ key, allowance }) => Boolean(key) && allowance > 0)
      .map(({ key, allowance }) => {
        this.remaining.set(key, Math.floor(allowance));
        return key;
      });
  }

  /** Total searches this pool can still spend in this run. */
  get totalAllowance(): number {
    let total = 0;
    for (const left of this.remaining.values()) total += left;
    return total;
  }

  /** Keys configured for this pool, spent or not. */
  get keyCount(): number {
    return this.order.length;
  }

  /** Keys that still have room to spend. */
  get liveKeyCount(): number {
    return [...this.remaining.values()].filter((left) => left > 0).length;
  }

  /**
   * Claims one search from the next key with room, or null when the pool is
   * spent. The claim is deducted immediately, so concurrent callers can never
   * both be handed the last unit of the same key.
   */
  take(): string | null {
    for (let attempt = 0; attempt < this.order.length; attempt += 1) {
      const key = this.order[(this.cursor + attempt) % this.order.length];
      const left = this.remaining.get(key) ?? 0;

      if (left > 0) {
        this.remaining.set(key, left - 1);
        this.cursor = (this.cursor + attempt + 1) % this.order.length;
        return key;
      }
    }
    return null;
  }

  /**
   * Returns an unspent claim — for a request that never reached the provider
   * (a transport error), so it isn't charged against the key that was holding
   * it. Never restores a key already marked exhausted.
   */
  refund(key: string): void {
    const left = this.remaining.get(key);
    if (left === undefined || this.retired.has(key)) return;
    this.remaining.set(key, left + 1);
  }

  /**
   * Retires a key for the rest of this run — it reported itself out of quota
   * (or rate-limited), so anything still allocated to it is unusable.
   */
  markExhausted(key: string): void {
    if (!this.remaining.has(key)) return;
    this.retired.add(key);
    this.remaining.set(key, 0);
  }

  /**
   * Lowers a key's allowance to what the provider says it actually has left.
   * Only ever lowers — the day's budget is a deliberate fraction of the
   * monthly quota, so a large upstream balance must not raise it.
   *
   * This is what keeps a provider with no pre-flight quota endpoint (JSearch)
   * honest: the per-response `x-ratelimit-requests-remaining` header
   * retroactively corrects a budget that assumed a full monthly allowance.
   */
  clampRemaining(key: string, upstreamRemaining: number): void {
    const left = this.remaining.get(key);
    if (left === undefined) return;
    if (upstreamRemaining < left) {
      this.remaining.set(key, Math.max(0, Math.floor(upstreamRemaining)));
    }
  }

  /** One-line summary for the refresh log. */
  describe(): string {
    if (this.order.length === 0) return 'no keys configured';
    return `${this.order.length} key(s), ${this.totalAllowance} search(es) available today`;
  }
}
