---
"chat-adapter-line": patch
---

Keep `fetchData()` on the media attachments of a message the Chat SDK queued. With `concurrency: "queue"`, `"debounce"`, or `"burst"` and a state adapter that stores JSON, such as Redis, a photo, video, audio clip, or file that waited behind a running handler arrived with no way to download it. The adapter now implements `rehydrateAttachment`, which `chat` 4.27.0 and later call to restore it.
