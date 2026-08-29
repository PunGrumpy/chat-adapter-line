/**
 * LINE reply tokens are single-use, expire within a minute of the webhook
 * event, and each webhook event carries exactly one. The Reply API is free
 * while the Push API consumes the channel's monthly message quota, so the
 * adapter prefers replies whenever a token is available.
 *
 * This store keeps the most recent token per thread with a hard expiry,
 * bounded by {@link MAX_STORED_TOKENS}. Taking a token consumes it. A
 * consumed or expired token means later sends fall back to push.
 */

/** Tokens are only valid for a short window after the webhook event. */
const TOKEN_TTL_MS = 60_000;

/** Upper bound so a flood of threads cannot grow the map unbounded. */
const MAX_STORED_TOKENS = 500;

interface Entry {
  expiresAt: number;
  token: string;
}

export class ReplyTokenStore {
  private tokens = new Map<string, Entry>();
  private readonly ttlMs: number;
  private readonly maxEntries: number;

  constructor(
    ttlMs: number = TOKEN_TTL_MS,
    maxEntries: number = MAX_STORED_TOKENS
  ) {
    this.ttlMs = ttlMs;
    this.maxEntries = maxEntries;
  }

  /**
   * Record the latest reply token for a thread, replacing any previous one.
   */
  set(threadId: string, token: string): void {
    if (this.tokens.size >= this.maxEntries && !this.tokens.has(threadId)) {
      // Drop the oldest entry (first insertion key) to stay bounded.
      const oldest = this.tokens.keys().next().value;
      if (oldest !== undefined) {
        this.tokens.delete(oldest);
      }
    }

    // Re-insert so eviction order tracks recency of updates, not just inserts.
    this.tokens.delete(threadId);
    this.tokens.set(threadId, { expiresAt: Date.now() + this.ttlMs, token });
  }

  /**
   * Remove and return a fresh token for the thread, or `undefined` when
   * none is stored or it has already expired.
   */
  take(threadId: string): string | undefined {
    const entry = this.tokens.get(threadId);
    if (!entry) {
      return undefined;
    }

    this.tokens.delete(threadId);

    if (entry.expiresAt <= Date.now()) {
      return undefined;
    }

    return entry.token;
  }
}
