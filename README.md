# Chat SDK LINE Adapter

[LINE Messaging API](https://developers.line.biz/en/docs/messaging-api/) adapter for [Chat SDK](https://chat-sdk.dev/) — send and receive messages from your bot.

## Installation

```bash
npm install chat-adapter-line
```

## Usage

```typescript
import { Chat } from "chat";
import { createLineAdapter } from "chat-adapter-line";

const bot = new Chat({
  userName: "mybot",
  adapters: {
    line: createLineAdapter(),
  },
});

bot.onNewMention(async (thread) => {
  await thread.subscribe();
  await thread.post("Hello! I'm listening to this thread.");
});

bot.onSubscribedMessage(async (thread, message) => {
  await thread.post(`You said: ${message.text}`);
});
```

the factory reads credentials from the environment variables by default.

| Environment Variable        | Required | Description                            |
| --------------------------- | -------- | -------------------------------------- |
| `LINE_CHANNEL_ACCESS_TOKEN` | Yes      | The access token for the LINE channel. |
| `LINE_CHANNEL_SECRET`       | Yes      | The secret for the LINE channel.       |

or pass them as options to the factory:

```typescript
const adapter = createLineAdapter({
  channelAccessToken: "eyJhbG...",
  channelSecret: "abc123...",
});
```

### Reply-token-first sending

LINE does not bill Reply API calls, but each Push API call counts against the channel's monthly message quota. That quota varies by plan and by country or region.

When your bot answers an inbound message, the adapter sends that first reply through the Reply API. Later sends use the Push API, because a reply token works once and expires within a minute. You don't need to change any adapter code.

### Broadcast and multicast

`broadcastMessages()` sends to every follower of the channel and `multicastMessages()` sends to up to 500 user IDs. Both accept a single postable or an array of up to five, reuse the same conversion as `postMessage()`, and never consume a reply token:

```typescript
const adapter = createLineAdapter();

const { requestId } = await adapter.broadcastMessages("New release is out", {
  retryKey: crypto.randomUUID(),
});

await adapter.multicastMessages(
  ["U1234567890abcdef1234567890abcdef", "U2345678901abcdef2345678901abcdef"],
  [{ markdown: "**Reminder**: stand-up at 10" }, "See you there"],
  { retryKey: crypto.randomUUID(), notificationDisabled: true }
);
```

The adapter forwards `retryKey` as `X-Line-Retry-Key`. Reuse the same key when you retry a request whose outcome you don't know, and LINE delivers it once.

Before calling LINE, the adapter validates user IDs, the retry key, aggregation units, and the five-message limit, and throws instead of truncating. 429 responses become `AdapterRateLimitError`. The returned `requestId` is LINE's `X-Line-Request-Id`, which you can use to reconcile the submission.

## License

[MIT](./LICENSE)

## Benchmarking

This package includes targeted benchmarks for hot paths:

- Markdown normalization (`toPlainText`)
- Thread ID encode/decode
- Webhook signature + parse path

Run benchmarks:

```bash
vp run benchmark
```

Export JSON results:

```bash
vp run benchmark:json
```
