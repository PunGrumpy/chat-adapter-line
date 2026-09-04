---
"chat-adapter-line": minor
---

Add `broadcastMessages()` and `multicastMessages()` for LINE's broadcast and multicast endpoints. Both reuse the adapter's postable-to-LINE conversion for text, Markdown, and cards. They map 429s to `AdapterRateLimitError`, forward a caller-supplied `retryKey` as `X-Line-Retry-Key`, and return LINE's `X-Line-Request-Id`. They validate recipient IDs, the retry key, aggregation units, and the five-message limit up front and throw instead of truncating. Batch sends never touch reply tokens or the reply/push fallback. `postMessage()` also now handles `{ raw: string }` postables.
