# Chat SDK LINE adapter

[LINE Messaging API](https://developers.line.biz/en/docs/messaging-api/) adapter for [Chat SDK](https://chat-sdk.dev/). It receives webhook events from your LINE bot and sends replies, mentions, quotes, audio, and batch messages back.

## Install the package

```bash
npm install chat-adapter-line
```

## Set up a bot

Create a `Chat` instance with the LINE adapter and register handlers:

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

The factory reads credentials from environment variables by default:

| Environment variable        | Required | Description                            |
| --------------------------- | -------- | -------------------------------------- |
| `LINE_CHANNEL_ACCESS_TOKEN` | Yes      | The access token for the LINE channel. |
| `LINE_CHANNEL_SECRET`       | Yes      | The secret for the LINE channel.       |

You can also pass them as options to the factory:

```typescript
const adapter = createLineAdapter({
  channelAccessToken: "your_channel_access_token",
  channelSecret: "your_channel_secret",
});
```

### Reply-token-first sending

LINE does not bill Reply API calls, but each Push API call counts against the channel's monthly message quota. That quota varies by plan and by country or region.

When your bot answers an inbound message, the adapter sends that first reply through the Reply API. Later sends use the Push API, because a reply token works once and expires within a minute. You don't need to change any adapter code.

### Direct messages and mentions

A LINE thread whose source is a single user is a direct message, so `bot.onDirectMessage()` fires for 1:1 chats. In groups and rooms, LINE delivers native mentions as structured data. The adapter parses them onto the message and sets `message.isMention` when someone mentions the bot, so `onNewMention()` and `onMention()` work without any `@name` text matching.

Inbound text messages are `LineMessage` instances. Each entry in `message.mentions` has a `type` of `user` or `all`, plus `index` and `length` for its position in the text. User mentions also carry `userId` and `isSelf` when the mentioned user has shared their profile with the channel:

```typescript
import { LineMessage } from "chat-adapter-line";

bot.onSubscribedMessage(async (thread, message) => {
  if (!(message instanceof LineMessage)) {
    return;
  }
  for (const mention of message.mentions) {
    console.log(mention.type, mention.userId, mention.isSelf);
  }
});
```

### Posting LINE-native messages

The Chat SDK's `PostableMessage` type does not know about LINE's extra fields, so wrap LINE-native postables in `linePostable()` when calling `thread.post()`. The helper only narrows the static type. The adapter accepts these shapes at runtime either way.

### Quoted replies

Every inbound text, image, video, and sticker message carries a `quoteToken`. Pass it back on a text postable to quote that message natively:

```typescript
import { LineMessage, linePostable } from "chat-adapter-line";

bot.onSubscribedMessage(async (thread, message) => {
  if (message instanceof LineMessage) {
    await thread.post(
      linePostable({
        text: "Replying to this one",
        quoteToken: message.quoteToken,
      })
    );
  }
});
```

`quoteToken` works on `text`, `raw`, `markdown`, and `ast` postables and survives both the Reply API and Push API paths. LINE cannot quote from a card or audio message, so combining those with a `quoteToken` throws a `ValidationError` rather than sending an unquoted message.

### Sending mentions

Mentions need stable character offsets, so the adapter accepts them on `text` and `raw` postables only. LINE renders them in group chats and multi-person chats, through the Reply API or Push API, with at most 20 mentions per message. Each segment selects the span of your text that LINE replaces with the mention:

```typescript
await thread.post(
  linePostable({
    text: "Hello @Alice, please review",
    mentions: [
      { index: 6, length: 6, userId: "U1234567890abcdef1234567890abcdef" },
    ],
  })
);

await thread.post(
  linePostable({
    text: "@everyone stand-up in 5",
    mentions: [{ all: true, index: 0, length: 9 }],
  })
);
```

The adapter encodes these as a LINE text message v2 with mention substitutions. Passing `mentions` on a Markdown, AST, card, or audio postable, in a 1:1 chat, or in a broadcast or multicast throws a `ValidationError`.

### Audio messages

Pass an `audio` object with an HTTPS URL and the length in milliseconds to send a native LINE audio message:

```typescript
await thread.post(
  linePostable({
    audio: {
      originalContentUrl: "https://example.com/audio.m4a",
      duration: 12_000,
    },
  })
);
```

The URL must be HTTPS and at most 2000 characters, and the duration a positive integer. Audio uses the same reply-first, push-fallback delivery as text.

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

Before calling LINE, the adapter validates user IDs, the retry key, and the five-message limit, and throws instead of truncating. 429 responses become `AdapterRateLimitError`. The returned `requestId` is LINE's `X-Line-Request-Id`, which you can use to reconcile the submission.

## License

[MIT](./LICENSE)

## Run benchmarks

This package includes targeted benchmarks for hot paths:

- Markdown normalization (`toPlainText`)
- Thread ID encode and decode
- Webhook signature verification and parsing

Run benchmarks:

```bash
vp run benchmark
```

Export JSON results:

```bash
vp run benchmark:json
```
