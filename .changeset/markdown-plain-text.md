---
"chat-adapter-line": patch
---

Render Markdown and AST postables to plain text from their parsed structure, instead of stripping a re-serialized Markdown string with patterns. The old path added Markdown escapes and then removed only the markers, so ordinary text was rewritten: underscores disappeared from URLs and file names (`my_report_2024.pdf`, `utm_source`), `snake_case` arrived as `snake\case`, `2 * 3` as `2 \ 3`, links lost their URLs, and code blocks kept a stray backtick and their language tag. Text now arrives as written. A link keeps its URL as `text (url)`, list items keep their `-` or `1.` markers, code keeps its exact text, and tables render as text.

`toPlainText()` keeps its signature and uses the same renderer. `LineFormatConverter.fromAst()` and `adapter.renderFormatted()` now return this plain text rather than Markdown. `renderPostable()` passes a plain string through unchanged, as the Chat SDK specifies. Inbound LINE text is no longer parsed as Markdown, so `message.formatted` keeps names like `__init__.py` intact.
