# chat-adapter-line

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
