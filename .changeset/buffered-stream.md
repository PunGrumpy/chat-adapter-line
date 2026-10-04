---
"chat-adapter-line": patch
---

Never drop text from a streamed reply. `stream()` sent a new message every 500 characters and stopped after five, so the rest of any reply longer than about 2,500 characters was silently discarded, while the Chat SDK recorded the whole text as sent. It also skipped LINE's 5000-character limit and sent Markdown markers unrendered.

The adapter now collects the whole stream, renders it like a `markdown` postable, splits it at paragraph, line, or word breaks into messages within LINE's limit, and sends them five to a request, the first over the free Reply API when a reply token is fresh. A typical streamed reply now costs no message quota, where each message after the first used to be a billed push.
