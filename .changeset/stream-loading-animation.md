---
"chat-adapter-line": patch
---

Keep LINE's loading animation up while a streamed reply is collected. `stream()` sends nothing until the stream ends, and LINE hides the animation after 20 seconds, so a reply that took longer to generate left a 1:1 chat looking idle. `stream()` now shows the animation when it starts reading and renews it every 15 seconds until the stream ends. It waits for a renewal still in flight before sending, so the animation never reappears after the reply. Groups and rooms are unchanged, because LINE shows no animation there.
