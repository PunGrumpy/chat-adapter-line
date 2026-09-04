---
"chat-adapter-line": patch
---

Support native LINE quoted replies. Inbound messages are now `LineMessage` instances exposing the `quoteToken` LINE issues for text, image, video, and sticker messages. Outbound `text`, `raw`, `markdown`, and `ast` postables accept a `quoteToken` that survives both the Reply API and Push API paths. Cards and audio cannot carry a quote on LINE, so passing one throws a `ValidationError` instead of silently sending unquoted. `postMessage()` returns the sent message's own quote token on `raw.message.quoteToken`.
