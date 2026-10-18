---
"chat-adapter-line": patch
---

Deliver every LINE postback to `onAction`. A postback whose data was not in the adapter's `id=…&v=…` form, such as one from a hand-built Flex action, a rich menu, or a quick reply, was dropped with only a debug log. It now arrives with its data as `actionId`. A datetime picker's choice, which LINE sends in `postback.params`, now arrives as `value` instead of only in `raw`, ahead of any encoded value. Card buttons are unchanged. A catch-all `bot.onAction(handler)` now also receives these postbacks.
