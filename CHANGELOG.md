# chat-adapter-line

## 0.1.5

### Patch Changes

- c6d48f6: Support native LINE image and video messages. `postMessage()` accepts `{ image: { originalContentUrl, previewImageUrl } }` and `{ video: { ... } }` and sends each as a native LINE message over the same reply-first, push-fallback path as text. `broadcastMessages()` and `multicastMessages()` take both shapes too.

  LINE fetches both URLs itself rather than taking bytes from the bot, so each must be an HTTPS URL of at most 2000 characters. A missing, non-HTTPS, or over-long URL throws a `ValidationError` before the adapter calls LINE, naming the field and the message type it belongs to. Neither message type can carry a quote on LINE, so a `quoteToken`, `mentions`, or `emojis` throws rather than being dropped, as it already does on a card. Hosting and transcoding stay with the caller: the adapter never uploads a file or generates a thumbnail.

  The audio, image, and video builders now share one URL check in a new `lib/media.js`, which `buildAudioMessage` moves into from `lib/outbound.js`. Its behavior and error messages are unchanged, and it joins the other builders in the public exports, alongside the new `buildMediaMessage` helper and the `LineMediaUrls`, `LinePostableImage`, and `LinePostableVideo` types.

- 2df0e38: Preserve the metadata LINE sends with an inbound image, video, audio, or file message. `LineMessage.media` now carries `providerMessageId`, `kind`, and, where LINE supplies them, `fileName`, `fileSize`, `duration`, and a `contentProvider` saying whether LINE hosts the file or the sender's own app does. Reading any of it used to mean digging through the raw webhook payload.

  The Chat SDK attachment gains what it has slots for, so code that never touches `message.media` benefits too: `name` is the sender's file name rather than the synthetic `image-<id>` it used to be, `size` is the byte count, and `url` points at an externally hosted file. LINE serves its own uploads through an authenticated API rather than a public URL, so `url` stays unset for those. Deferred fetching is unchanged: `fetchData()` still downloads nothing until it is called, and webhook parsing never touches the content.

  Optional fields LINE reports in an unusable shape are dropped rather than guessed at or allowed to reject the attachment, so an unparseable file size costs you the size and nothing else. A media message with no ID now yields no attachment at all, because the ID is what the content is fetched by, and an attachment that cannot be fetched is worse than none.

  The public exports now include the `LineContentProvider` and `LineMediaMetadata` types and the `parseInboundMedia` helper.

- 67b9c41: Expose LINE's lifecycle webhook events. `adapter.onLifecycleEvent(handler)` reports `follow`, `unfollow`, `join`, `leave`, `memberJoined`, and `memberLeft`, and returns a function that unsubscribes that handler. The adapter used to drop these events on the floor, because they carry no message and some carry no reply token.

  Each event arrives flattened onto one shape with `type`, `threadId`, `sourceType`, `sourceId`, `timestamp`, `webhookEventId`, `mode`, `isRedelivery`, and the untouched `raw` event, plus `userId`, `members`, `isUnblocked`, and `replyToken` where LINE supplies them. Lifecycle events never reach the Chat SDK's message or action handlers and are never turned into synthetic text messages. Every registered handler sees every event, and one that throws or rejects is logged without stopping the others or changing the `200` the webhook returns.

  A redelivered or standby-mode lifecycle event is delivered rather than dropped, unlike a message, because a missed `unfollow` cannot be recovered the way a missed message can be resent. Both facts ride on the event as `isRedelivery` and `mode`, and `webhookEventId` identifies a delivery uniquely, so a handler can filter and deduplicate.

  LINE issues a reply token with `follow`, `join`, and `memberJoined`. The adapter now stores it for the reply-first path, so a welcome message sent after a follow goes out over the free Reply API rather than the quota-metered Push API. A dummy token from the LINE console's verify button is ignored, as it already is for messages.

  The public exports now include the `LineEventSource`, `LineLifecycleEvent`, `LineLifecycleEventType`, `LineLifecycleHandler`, and `LineLifecycleRawEvent` types and the `isLifecycleEvent`, `toLifecycleEvent`, and `sourceIdFrom` helpers.

- c94a308: Support native LINE location messages in both directions. An inbound location message now exposes `LineMessage.location` with `latitude`, `longitude`, and the optional `title` and `address`, so a bot can read the place a user shared without inspecting the raw webhook payload. LINE leaves the title and address off a pin the sender did not name, and coordinates that are missing or outside the geographic ranges leave `location` unset rather than arriving as a place that looks valid. Webhook parsing makes no geocoding, map, or tile request.

  Outbound, `postMessage()` accepts `{ location: { title, address, latitude, longitude } }` and sends a native LINE location message over the same reply-first, push-fallback path as text. LINE requires all four, so the title and address must be non-blank and at most 100 characters, the latitude must fall between -90 and 90, and the longitude between -180 and 180; anything else throws a `ValidationError` before the adapter calls LINE. A LINE location message cannot carry a quote, so a `quoteToken` or `mentions` throws instead of being dropped, as it already does on a card. Broadcast and multicast accept the new shape too. The public exports now include the `LineLocation` and `LinePostableLocation` types and the `buildLocationMessage` and `parseInboundLocation` helpers.

- b1a9358: Support native LINE stickers in both directions. An inbound sticker message now exposes `LineMessage.sticker` with `packageId`, `stickerId`, the `resourceType`, up to 15 `keywords`, and the text the sender typed on a personalized sticker, so a bot can classify a sticker without reading the raw webhook payload. Webhook parsing never downloads or transforms the sticker image, and a sticker event missing either ID leaves `sticker` unset instead of failing the parse. Unknown resource types and non-string keywords are dropped, so a sticker kind LINE adds later still arrives with its identity intact.

  Outbound, `postMessage()` accepts `{ sticker: { packageId, stickerId } }` and sends a native LINE sticker message over the same reply-first, push-fallback path as text, so an inbound `message.sticker` can be passed straight back. Both IDs must be decimal strings from LINE's sticker definitions, and the `CUSTOM`, `MESSAGE`, `NAME_TEXT`, and `PER_STICKER_TEXT` resource types throw a `ValidationError` rather than sending a different sticker under the same IDs. A sticker can carry a `quoteToken`, which a card, Flex Message, or audio message cannot, while `mentions` throws. Broadcast and multicast accept the new shape too. The public exports now include the `LinePostableSticker`, `LineSticker`, and `LineStickerResourceType` types and the `buildStickerMessage` and `parseInboundSticker` helpers.

- d2b6f5b: Expose the ID of a quoted message on inbound events. When a user quotes an earlier message, LINE sends `quotedMessageId` alongside the usual `quoteToken`, and `LineMessage.quotedMessageId` now carries it. The two point in opposite directions: `quoteToken` is what you send back to quote the message you just received, while `quotedMessageId` identifies the older message that message was quoting.

  The value is parsed from any message event that carries it, which covers the text, image, video, and sticker messages LINE issues quote tokens for. An absent, empty, or non-string value leaves the property unset rather than rejecting an otherwise valid message, and existing `quoteToken` behavior is unchanged. The adapter reports the ID and nothing more: it never fetches, resolves, or validates the message behind it.

- 2fb42d4: Reject a text message over LINE's 5000-character limit before calling LINE. A `text`, `raw`, `markdown`, or `ast` postable whose text would exceed the cap now throws a `ValidationError` locally, where it used to reach LINE and come back as a 400. The count uses UTF-16 code units, which is how LINE counts and how `String.prototype.length` counts, and it is taken on the text the adapter would actually send: after mention and emoji placeholders replace their spans and literal braces are doubled, since both change the length. The `MAX_TEXT_LENGTH` constant is exported alongside the other limits.
- 88947c5: Support native LINE emoji in both directions. An inbound text message now exposes `LineMessage.emojis`, each entry carrying the `index`, `length`, `productId`, and `emojiId` LINE reported. The adapter leaves `message.text` exactly as LINE sent it, emoji sequences and all, and drops an entry that is malformed or whose span runs past the text, rather than the whole message.

  Outbound, `text` and `raw` postables accept `emojis: [{ index, productId, emojiId }]`. Each `index` must line up with a `$` in the text, which the adapter replaces with an `{emojiN}` placeholder on a LINE text message v2, the same shape it already uses for mentions. One message can therefore carry both, and the adapter rejects a mention and an emoji that cover the same characters, an index that does not land on a `$`, an empty `productId` or `emojiId`, and more than the 100 substitutions LINE accepts. Emoji are rejected on Markdown, AST, card, Flex, audio, location, and sticker postables for the same reason mentions are: those have no stable character offsets.

  This also fixes `postMessage()` rejecting any `textV2` message sent to a 1:1 chat. The guard existed to catch mentions, which LINE does not render outside groups and rooms, but it keyed off the message type rather than the substitutions. Emoji use the same `textV2` shape and do render in a 1:1 chat, so the check now looks for an actual mention substitution. Broadcast and multicast accept emoji too.

  The public exports now include the `LineEmoji` and `LineEmojiSegment` types and the `parseInboundEmojis` helper. `buildTextMessage` moves from `lib/mentions.js` to a new `lib/text-v2.js`, which owns the substitution encoding both mentions and emoji share; the package export is unchanged.

## 0.1.4

### Patch Changes

- ef428db: Support arbitrary Flex Messages in `postMessage`. A `{ flex: { altText, contents } }` postable sends a LINE `bubble` or `carousel` container through untouched, so callers can use hero images, carousels, URI and datetime-picker actions, colors, and custom layout that the `card` model cannot express.

  The adapter rejects a blank `altText` and one longer than 400 characters. It rejects a quote token or mentions on a `flex` postable, as it already does on a card. Reply, push, broadcast, and multicast all take the new shape. The public exports now include the `LinePostableFlex` type and the `buildNativeFlexMessage` helper.

## 0.1.3

### Patch Changes

- 4538834: Implement `Adapter.isDM()` on `LineAdapter`. The Chat SDK asks the adapter whether a thread is a direct message before dispatching. Without the method, every LINE 1:1 chat routed as a non-DM, so `onDirectMessage()` handlers never fired and `message.isMention` stayed unset. The adapter now reports a thread whose source is a single user as a DM.
- eb3ce10: Support native LINE audio messages through `postMessage()`. Pass `{ audio: { originalContentUrl, duration } }` and the adapter sends a LINE `audio` message over the same reply-first, push-fallback path as text. The URL must be HTTPS and at most 2000 characters, and the duration a positive integer of milliseconds. Anything else throws a `ValidationError` before the adapter calls LINE. `linePostable()` types these shapes for `thread.post()`.
- 102d4c3: Add `broadcastMessages()` and `multicastMessages()` for LINE's broadcast and multicast endpoints. Both reuse the adapter's postable-to-LINE conversion for text, Markdown, and cards. They map 429s to `AdapterRateLimitError`, forward a caller-supplied `retryKey` as `X-Line-Retry-Key`, and return LINE's `X-Line-Request-Id`. They validate recipient IDs, the retry key, aggregation units, and the five-message limit up front and throw instead of truncating. Batch sends never touch reply tokens or the reply/push fallback. `postMessage()` also now handles `{ raw: string }` postables.
- 4538834: Fix `channelIdFromThreadId()` overflowing the call stack. It delegated to the Chat SDK's `deriveChannelId()`, which calls straight back into the adapter, so every `fetchThread()` call and every `thread.channel` access threw `RangeError: Maximum call stack size exceeded`. The adapter now parses the channel ID from the thread ID itself. The test suite no longer mocks `deriveChannelId`, so tests exercise the real SDK path.
- d01f305: Support native LINE mentions in both directions. Inbound text messages expose LINE's `mention.mentionees` as `LineMessage.mentions` with `index`, `length`, `userId`, and `isSelf`. A mention of the bot sets `message.isMention`, so `onMention()` and `onNewMention()` fire in groups. Outbound `text` and `raw` postables accept `mentions: [{ index, length, userId | all }]`, which the adapter encodes as a LINE text message v2 with mention substitutions. Mentions on Markdown, AST, card, or audio postables throw a `ValidationError` rather than degrading to plain text, as do more than 20 mentions, mentions in a 1:1 chat, and mentions in a broadcast or multicast, which LINE does not render.
- 4d8de99: Support native LINE quoted replies. Inbound messages are now `LineMessage` instances exposing the `quoteToken` LINE issues for text, image, video, and sticker messages. Outbound `text`, `raw`, `markdown`, and `ast` postables accept a `quoteToken` that survives both the Reply API and Push API paths. Cards and audio cannot carry a quote on LINE, so passing one throws a `ValidationError` instead of silently sending unquoted. `postMessage()` returns the sent message's own quote token on `raw.message.quoteToken`.
- 645f12e: Ship `dist/index.d.ts` again. The build had declaration output turned off, so TypeScript consumers of the published package saw no types for `LineAdapter` or its exports.

## 0.1.2

### Patch Changes

- 9ef341c: Use LINE's free Reply API for the first send after a webhook event, instead of always sending through the quota-metered Push API. Reply tokens are stored per thread and expire after 60 seconds. Later sends, proactive messages, and tokens rejected as invalid fall back to `pushMessage`. A reply failure other than an invalid token propagates without a push retry, so real errors aren't masked.
- df91b83: Map LINE 429 responses to the Chat SDK's `AdapterRateLimitError`. The adapter keeps an unconsumed reply token after a rate-limited reply, throws instead of caching degraded thread and bot metadata, and maps 429s across reply, push, content, bot info, profile, and group calls.

## 0.1.1

### Patch Changes

- 6362fe3: Add support for translating Chat SDK JSX cards to LINE Flex Messages and handling postback events. Postback button clicks now dispatch to Chat SDK `onAction` handlers via `processAction`.

## 0.1.0

### Minor Changes

- a52bebb: Implement core Line messaging API adapter
