---
"chat-adapter-line": patch
---

Reject a text message over LINE's 5000-character limit before calling LINE. A `text`, `raw`, `markdown`, or `ast` postable whose text would exceed the cap now throws a `ValidationError` locally, where it used to reach LINE and come back as a 400. The count uses UTF-16 code units, which is how LINE counts and how `String.prototype.length` counts, and it is taken on the text the adapter would actually send: after mention and emoji placeholders replace their spans and literal braces are doubled, since both change the length. The `MAX_TEXT_LENGTH` constant is exported alongside the other limits.
