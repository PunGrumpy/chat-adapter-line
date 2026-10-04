---
"chat-adapter-line": patch
---

Answer a webhook whose `x-line-signature` header has the wrong length with a `401`, the same as any other wrong signature. The comparison used to throw when the header's byte length differed from a real signature's. Any caller could make the webhook route fail with the framework's `500` and an error log entry.

`new LineAdapter()` now rejects an empty or blank `channelSecret` or `channelAccessToken` with a `ValidationError`, as `createLineAdapter()` already did. An empty channel secret is a valid HMAC key that anyone can sign webhooks with.
