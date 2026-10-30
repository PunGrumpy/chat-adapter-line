---
"chat-adapter-line": patch
---

Split long `thread.post()` text into several LINE messages the way streamed replies are split, instead of throwing, and throw before calling LINE when a post renders to empty text.
