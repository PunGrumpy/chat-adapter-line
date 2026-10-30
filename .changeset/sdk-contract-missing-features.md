---
"chat-adapter-line": patch
---

Reject edit, delete, and reaction calls with the Chat SDK's `NotImplementedError` (was `PermissionError`, thrown synchronously), and let the SDK keep thread history for LINE so `thread.messages` and `thread.refresh()` work.
