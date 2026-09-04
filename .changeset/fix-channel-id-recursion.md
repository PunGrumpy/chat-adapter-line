---
"chat-adapter-line": patch
---

Fix `channelIdFromThreadId()` overflowing the call stack. It delegated to the Chat SDK's `deriveChannelId()`, which calls straight back into the adapter, so every `fetchThread()` call and every `thread.channel` access threw `RangeError: Maximum call stack size exceeded`. The adapter now parses the channel ID from the thread ID itself. The test suite no longer mocks `deriveChannelId`, so tests exercise the real SDK path.
