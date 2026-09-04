---
"chat-adapter-line": patch
---

Support native LINE audio messages through `postMessage()`. Pass `{ audio: { originalContentUrl, duration } }` and the adapter sends a LINE `audio` message over the same reply-first, push-fallback path as text. The URL must be HTTPS and at most 2000 characters, and the duration a positive integer of milliseconds. Anything else throws a `ValidationError` before the adapter calls LINE. `linePostable()` types these shapes for `thread.post()`.
