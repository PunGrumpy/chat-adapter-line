---
"chat-adapter-line": patch
---

Map LINE 429 responses to the Chat SDK's `AdapterRateLimitError`. The adapter keeps an unconsumed reply token after a rate-limited reply, throws instead of caching degraded thread and bot metadata, and maps 429s across reply, push, content, bot info, profile, and group calls.
