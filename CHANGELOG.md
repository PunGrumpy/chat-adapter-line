# chat-adapter-line

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
