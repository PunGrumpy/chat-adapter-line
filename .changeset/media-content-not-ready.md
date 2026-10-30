---
"chat-adapter-line": patch
---

Reject `fetchData()` with a `CONTENT_NOT_READY` error while LINE is still preparing a video or audio file, instead of returning empty bytes, and leave `fetchData` unset for files hosted outside LINE.
