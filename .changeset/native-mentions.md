---
"chat-adapter-line": patch
---

Support native LINE mentions in both directions. Inbound text messages expose LINE's `mention.mentionees` as `LineMessage.mentions` with `index`, `length`, `userId`, and `isSelf`. A mention of the bot sets `message.isMention`, so `onMention()` and `onNewMention()` fire in groups. Outbound `text` and `raw` postables accept `mentions: [{ index, length, userId | all }]`, which the adapter encodes as a LINE text message v2 with mention substitutions. Mentions on Markdown, AST, card, or audio postables throw a `ValidationError` rather than degrading to plain text, as do more than 20 mentions, mentions in a 1:1 chat, and mentions in a broadcast or multicast, which LINE does not render.
