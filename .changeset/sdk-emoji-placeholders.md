---
"chat-adapter-line": patch
---

Render the Chat SDK's `emoji` placeholders as Unicode emoji instead of sending `{{emoji:name}}` text to LINE users. This covers string, `text`, `raw`, Markdown, and AST postables, streamed replies, `toPlainText()`, and card titles, text, button labels, and notification text. A `text` or `raw` postable that mixes a placeholder with positioned `mentions` or `emojis` throws a `ValidationError`, because converting the placeholder would shift those positions. Use Unicode emoji directly in that case.
