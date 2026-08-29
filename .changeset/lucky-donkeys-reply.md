---
"chat-adapter-line": patch
---

Use LINE's free Reply API for the first send after a webhook event, instead of always sending through the quota-metered Push API. Reply tokens are stored per thread and expire after 60 seconds. Later sends, proactive messages, and rejected tokens fall back to `pushMessage`, so message delivery is unchanged. Only the transport for immediate replies changes.
