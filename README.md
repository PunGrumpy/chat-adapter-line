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
