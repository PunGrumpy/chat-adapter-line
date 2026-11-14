---
"chat-adapter-line": patch
---

Return from `thread.startTyping()` without waiting for LINE, so your handler starts its real work about one LINE round trip sooner on every 1:1 reply. The bot's next message still waits for the animation request, so the animation never reappears under the reply.
