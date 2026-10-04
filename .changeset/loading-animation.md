---
"chat-adapter-line": patch
---

Show LINE's loading animation from `thread.startTyping()`. The adapter used to call LINE's Acquire Control API instead, a partner API for module channels: on a regular channel the call failed silently, so no indicator ever appeared, and on a channel attached as a module it would have switched chat control away from the primary channel. The animation shows in 1:1 chats for up to 20 seconds or until the bot's next message arrives, and a later `startTyping()` after the bot has replied shows it again.
