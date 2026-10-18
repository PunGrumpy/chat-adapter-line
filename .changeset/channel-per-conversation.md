---
"chat-adapter-line": patch
---

Make each LINE conversation its own Chat SDK channel. `channelIdFromThreadId()` returned the bot's user ID, so every 1:1 chat, group, and room of a bot was one channel. They shared `thread.channel.state` and channel-scoped locks, and `thread.channel.post()` threw "Invalid LINE thread ID". The channel ID is now the conversation's thread ID, so `thread.channel.post()` sends to that conversation, and `fetchThread()` reports the same `channelId`. State saved with `thread.channel.setState()` before this release was shared by every conversation and is no longer read. Per-thread state and subscriptions are unchanged.
