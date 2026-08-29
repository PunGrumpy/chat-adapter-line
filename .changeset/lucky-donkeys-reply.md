---
"chat-adapter-line": patch
---

Use LINE's free Reply API for the first send after a webhook event, instead of always sending through the quota-metered Push API. Reply tokens are stored per thread and expire after 60 seconds. Later sends, proactive messages, and tokens rejected as invalid fall back to `pushMessage`. A reply failure other than an invalid token propagates without a push retry, so real errors aren't masked.
