---
"chat-adapter-line": patch
---

Expose the ID of a quoted message on inbound events. When a user quotes an earlier message, LINE sends `quotedMessageId` alongside the usual `quoteToken`, and `LineMessage.quotedMessageId` now carries it. The two point in opposite directions: `quoteToken` is what you send back to quote the message you just received, while `quotedMessageId` identifies the older message that message was quoting.

The value is parsed from any message event that carries it, which covers the text, image, video, and sticker messages LINE issues quote tokens for. An absent, empty, or non-string value leaves the property unset rather than rejecting an otherwise valid message, and existing `quoteToken` behavior is unchanged. The adapter reports the ID and nothing more: it never fetches, resolves, or validates the message behind it.
