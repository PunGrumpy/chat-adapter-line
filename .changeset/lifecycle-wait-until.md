---
"chat-adapter-line": patch
---

Keep lifecycle handlers running on serverless hosts. The adapter now hands each `onLifecycleEvent()` handler's work to the `waitUntil` passed in the webhook options, the way the Chat SDK already does for message and action handlers. It used to start handlers without registering them, so on Vercel Functions or with Next.js `after()` the runtime could stop once the `200` was sent, before a welcome message on `follow` went out. The webhook still answers without waiting for handlers.
