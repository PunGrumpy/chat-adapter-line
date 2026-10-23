/**
 * Keeps the latest reply token for each thread and expires entries before
 * LINE's reply-token deadline. Taking a token consumes it, because LINE
 * accepts each token once.
 */

const REPLY_TOKEN_LIFETIME_MS = 60_000;
const EXPIRY_MARGIN_MS = 5000;
const TOKEN_TTL_MS = REPLY_TOKEN_LIFETIME_MS - EXPIRY_MARGIN_MS;

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

  set(threadId: string, token: string): void {
    if (this.tokens.size >= this.maxEntries && !this.tokens.has(threadId)) {
      const oldest = this.tokens.keys().next().value;
      if (oldest !== undefined) {
        this.tokens.delete(oldest);
      }
    }

    this.tokens.delete(threadId);
    this.tokens.set(threadId, { expiresAt: Date.now() + this.ttlMs, token });
  }

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
