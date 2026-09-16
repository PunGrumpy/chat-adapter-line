---
"chat-adapter-line": patch
---

Support native LINE image and video messages. `postMessage()` accepts `{ image: { originalContentUrl, previewImageUrl } }` and `{ video: { ... } }` and sends each as a native LINE message over the same reply-first, push-fallback path as text. `broadcastMessages()` and `multicastMessages()` take both shapes too.

LINE fetches both URLs itself rather than taking bytes from the bot, so each must be an HTTPS URL of at most 2000 characters. A missing, non-HTTPS, or over-long URL throws a `ValidationError` before the adapter calls LINE, naming the field and the message type it belongs to. Neither message type can carry a quote on LINE, so a `quoteToken`, `mentions`, or `emojis` throws rather than being dropped, as it already does on a card. Hosting and transcoding stay with the caller: the adapter never uploads a file or generates a thumbnail.

The audio, image, and video builders now share one URL check in a new `lib/media.js`, which `buildAudioMessage` moves into from `lib/outbound.js`. Its behavior and error messages are unchanged, and it joins the other builders in the public exports, alongside the new `buildMediaMessage` helper and the `LineMediaUrls`, `LinePostableImage`, and `LinePostableVideo` types.
