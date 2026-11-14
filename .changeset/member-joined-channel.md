---
"chat-adapter-line": patch
---

Fire the Chat SDK's `bot.onMemberJoinedChannel()` on LINE when the bot is added to a group or room (once, with the bot's own ID as `userId`) and when people join one it is in (once per member), so a welcome message written for Slack or Teams works here too. Redelivered and standby-mode events are skipped, and `adapter.botUserId` lets a handler tell the bot's own join from a person's.
