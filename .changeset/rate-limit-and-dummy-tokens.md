---
"chat-adapter-line": patch
---

LINE 429 responses now surface as the Chat SDK's `AdapterRateLimitError`, carrying the `Retry-After` seconds when LINE sends the header. This covers every LINE API call the adapter makes: reply, push, bot info, message content, and profile/group lookups.

A rate-limited reply no longer falls back to push. The throttle applies to the whole channel, and LINE never consumed the reply token, so the adapter keeps it and the retry can still use the free Reply API. Profile and group lookups rethrow rate limits instead of caching an empty `ThreadInfo` for five minutes. A rate-limited `getBotInfo` during `initialize` rethrows instead of pinning the channel ID to `"unknown"`.

The webhook handler now drops LINE's webhook-URL-verification dummy events, which carry all-zero or all-"f" reply tokens. They no longer cache a doomed token or trigger a reply to LINE's fake verification user.
