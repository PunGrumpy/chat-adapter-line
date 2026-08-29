---
"chat-adapter-line": patch
---

LINE 429 responses on both the Reply and Push transports now surface as the Chat SDK's `AdapterRateLimitError` (with `Retry-After` seconds when the header is present) instead of a raw `HTTPFetchError` — and a rate-limited reply does not fall back to push, since the throttle applies to the channel as a whole and a 429 was never processed. The webhook handler also no longer caches LINE's all-zero webhook-URL-verification dummy reply tokens, which would otherwise be spent (and rejected) on the next real reply.
