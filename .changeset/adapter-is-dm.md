---
"chat-adapter-line": patch
---

Implement `Adapter.isDM()` on `LineAdapter`. The Chat SDK asks the adapter whether a thread is a direct message before dispatching. Without the method, every LINE 1:1 chat routed as a non-DM, so `onDirectMessage()` handlers never fired and `message.isMention` stayed unset. The adapter now reports a thread whose source is a single user as a DM.
