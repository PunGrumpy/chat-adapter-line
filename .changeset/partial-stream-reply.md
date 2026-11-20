---
"chat-adapter-line": patch
---

Send the text a stream produced before it failed instead of dropping it. When an AI stream breaks partway, `thread.post()` now delivers what the adapter has collected and then rethrows the stream's error, so the user keeps the partial reply and your handler still sees the failure.
