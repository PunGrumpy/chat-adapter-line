---
"chat-adapter-line": patch
---

Support native LINE emoji in both directions. An inbound text message now exposes `LineMessage.emojis`, each entry carrying the `index`, `length`, `productId`, and `emojiId` LINE reported. The adapter leaves `message.text` exactly as LINE sent it, emoji sequences and all, and drops a malformed entry rather than the whole message.

Outbound, `text` and `raw` postables accept `emojis: [{ index, productId, emojiId }]`. Each `index` must line up with a `$` in the text, which the adapter replaces with an `{emojiN}` placeholder on a LINE text message v2, the same shape it already uses for mentions. One message can therefore carry both, and the adapter rejects a mention and an emoji that cover the same characters, an index that does not land on a `$`, an empty `productId` or `emojiId`, and more than the 100 substitutions LINE accepts. Emoji are rejected on Markdown, AST, card, Flex, audio, location, and sticker postables for the same reason mentions are: those have no stable character offsets.

This also fixes `postMessage()` rejecting any `textV2` message sent to a 1:1 chat. The guard existed to catch mentions, which LINE does not render outside groups and rooms, but it keyed off the message type rather than the substitutions. Emoji use the same `textV2` shape and do render in a 1:1 chat, so the check now looks for an actual mention substitution. Broadcast and multicast accept emoji too.

The public exports now include the `LineEmoji` and `LineEmojiSegment` types and the `parseInboundEmojis` helper. `buildTextMessage` moves from `lib/mentions.js` to a new `lib/text-v2.js`, which owns the substitution encoding both mentions and emoji share; the package export is unchanged.
