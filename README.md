# Chat SDK LINE adapter

[LINE Messaging API](https://developers.line.biz/en/docs/messaging-api/) adapter for [Chat SDK](https://chat-sdk.dev/). It receives webhook events from your LINE bot and sends replies, mentions, native emoji, quotes, Flex Messages, stickers, images, videos, audio, locations, and batch messages back. It also reports LINE's lifecycle events, from a new follower to a member leaving a group.

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

When an inbound message is itself quoting an earlier one, `message.quotedMessageId` holds LINE's ID for the message being quoted:

```typescript
bot.onSubscribedMessage(async (thread, message) => {
  if (message instanceof LineMessage && message.quotedMessageId) {
    console.log(message.text, "quotes", message.quotedMessageId);
  }
});
```

The two fields point in opposite directions: `quoteToken` is what you send back to quote _this_ message, while `quotedMessageId` identifies the older message _this one_ quotes. LINE omits `quotedMessageId` unless the sender actually quoted something. The adapter reports the ID and stops there, because LINE's API offers no way to fetch a message by ID, so resolving the quoted message means looking it up in whatever you stored yourself.

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

The adapter encodes these as a LINE text message v2 with mention substitutions. Passing `mentions` on a Markdown, AST, card, Flex, audio, location, or sticker postable, in a 1:1 chat, or in a broadcast or multicast throws a `ValidationError`.

### Native emoji

LINE emoji are identified by a product ID and an emoji ID, not by a Unicode character. Put a `$` in the text where each one belongs and point an `emojis` entry at it:

```typescript
await thread.post(
  linePostable({
    text: "Ship it $",
    emojis: [
      { index: 8, productId: "5ac1bfd5040ab15980c9b435", emojiId: "001" },
    ],
  })
);
```

The adapter encodes this as a LINE text message v2, the same shape it already uses for mentions, so one message can carry both:

```typescript
await thread.post(
  linePostable({
    text: "@Alice $ nice work",
    mentions: [
      { index: 0, length: 6, userId: "U1234567890abcdef1234567890abcdef" },
    ],
    emojis: [
      { index: 7, productId: "5ac1bfd5040ab15980c9b435", emojiId: "001" },
    ],
  })
);
```

Each `index` must line up with a `$`, both identifiers must be non-empty, and no two substitutions may cover the same characters, whether they are mentions or emoji. LINE accepts at most 100 substitutions in one message. Anything else throws a `ValidationError` before the adapter calls LINE. Like mentions, emoji only work on `text` and `raw` postables, because a Markdown, AST, card, Flex, audio, location, or sticker postable has no stable character offsets to anchor them to.

Unlike mentions, emoji render everywhere: 1:1 chats, groups, rooms, and `broadcastMessages()` and `multicastMessages()` all take them.

Inbound, `message.emojis` lists the native emoji a user sent, each with `index`, `length`, `productId`, and `emojiId`. The adapter leaves `message.text` exactly as LINE sent it, emoji sequences and all, and drops a malformed entry rather than the whole message:

```typescript
bot.onSubscribedMessage(async (thread, message) => {
  if (message instanceof LineMessage) {
    for (const emoji of message.emojis) {
      console.log(emoji.productId, emoji.emojiId);
    }
  }
});
```

### Flex Messages

A Chat SDK `card` element renders as a single bubble. A `flex` postable covers the rest of the Flex schema, including hero images, carousels, URI and datetime-picker actions, colors, and custom layout. The adapter sends `contents` to LINE untouched:

```typescript
await thread.post(
  linePostable({
    flex: {
      altText: "Your order shipped",
      contents: {
        type: "bubble",
        hero: {
          type: "image",
          url: "https://example.com/box.png",
          size: "full",
        },
        body: {
          type: "box",
          layout: "vertical",
          contents: [{ type: "text", text: "Arriving Friday", weight: "bold" }],
        },
        footer: {
          type: "box",
          layout: "vertical",
          contents: [
            {
              type: "button",
              style: "primary",
              action: {
                type: "uri",
                label: "Track",
                uri: "https://example.com/track/1",
              },
            },
          ],
        },
      },
    },
  })
);
```

`contents` takes a `bubble` or a `carousel`. `altText` is required and must not be blank. LINE caps it at 400 characters and shows it in notifications and the chat list.

The adapter checks the envelope only. LINE validates the component tree itself, and you know which schema level your payload targets.

Like cards, Flex Messages cannot carry a `quoteToken` or `mentions`. Both combinations throw a `ValidationError`. Delivery uses the same reply-first, push-fallback path as text, and `broadcastMessages()` and `multicastMessages()` accept `flex` postables too.

### Inbound media

An image, video, audio, or file message arrives with a Chat SDK attachment that fetches the content on demand, and with `message.media` describing it without fetching anything:

```typescript
import { LineMessage } from "chat-adapter-line";

bot.onSubscribedMessage(async (thread, message) => {
  if (!(message instanceof LineMessage) || !message.media) {
    return;
  }

  const { kind, fileName, fileSize, duration } = message.media;
  console.log(kind, fileName, fileSize, duration);

  const [attachment] = message.attachments;
  const bytes = await attachment.fetchData?.();
});
```

What LINE reports depends on the message: a name and size for files, a duration for audio and video, and a `contentProvider` saying whether LINE hosts the file or the sender's own app does. `providerMessageId` is LINE's ID for the message, which is what the content is fetched by. Fields LINE omits, or reports in an unusable shape, are left off rather than guessed at, and a bad one never costs you the attachment.

The attachment itself now carries what the Chat SDK has slots for, so code that never touches `message.media` benefits too: `name` is the sender's file name instead of a synthetic one, `size` is the byte count, and `url` points at an externally hosted file. LINE serves its own uploads through an authenticated API rather than a public URL, so `url` stays unset for those and `fetchData()` remains the way to read them. Fetching is still deferred: nothing is downloaded while the webhook is parsed.

### Images and videos

Pass an `image` or `video` object with the media URL and a thumbnail to send a native LINE image or video message:

```typescript
await thread.post(
  linePostable({
    image: {
      originalContentUrl: "https://example.com/photo.jpg",
      previewImageUrl: "https://example.com/photo-thumb.jpg",
    },
  })
);

await thread.post(
  linePostable({
    video: {
      originalContentUrl: "https://example.com/clip.mp4",
      previewImageUrl: "https://example.com/clip-thumb.jpg",
    },
  })
);
```

LINE fetches both URLs itself rather than taking bytes from the bot, so each must be HTTPS and at most 2000 characters, and the host has to be reachable from the internet. A missing, non-HTTPS, or over-long URL throws a `ValidationError` before the adapter calls LINE. Images and videos use the same reply-first, push-fallback delivery as text, and `broadcastMessages()` and `multicastMessages()` accept them too. LINE cannot quote from either, so a `quoteToken`, `mentions`, or `emojis` on one throws, as it does on a card.

Hosting and transcoding are yours to handle. The adapter never uploads a file or generates a thumbnail.

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

### Stickers

A sticker message arrives with `message.sticker`, and a `sticker` postable sends one back. Passing the inbound sticker straight through echoes it:

```typescript
import { LineMessage, linePostable } from "chat-adapter-line";

bot.onSubscribedMessage(async (thread, message) => {
  if (message instanceof LineMessage && message.sticker) {
    await thread.post(
      linePostable({
        sticker: message.sticker,
        quoteToken: message.quoteToken,
      })
    );
  }
});
```

Alongside `packageId` and `stickerId`, an inbound sticker carries `resourceType`, up to 15 `keywords` describing the sticker, and the `text` the sender typed on a personalized sticker. Classify a sticker from those fields instead of reading the raw webhook payload. Webhook parsing never downloads or transforms the sticker image.

A bot can only send the stickers in [LINE's sticker definitions](https://developers.line.biz/en/docs/messaging-api/sticker-list/), so both IDs must be decimal strings and the adapter rejects anything else before calling LINE. It also rejects the four resource types LINE renders from text the sender typed, `CUSTOM`, `MESSAGE`, `NAME_TEXT`, and `PER_STICKER_TEXT`, rather than sending a different sticker under the same IDs. Stickers use the same reply-first, push-fallback delivery as text, and `broadcastMessages()` and `multicastMessages()` accept them too. Unlike a card or audio message, a sticker can carry a `quoteToken`; `mentions` throws a `ValidationError`.

### Location messages

A location message arrives with `message.location`, and a `location` postable sends a pin back:

```typescript
import { LineMessage, linePostable } from "chat-adapter-line";

bot.onSubscribedMessage(async (thread, message) => {
  if (message instanceof LineMessage && message.location) {
    const { latitude, longitude } = message.location;
    await thread.post(
      linePostable({
        location: {
          title: "Our office",
          address: "1-3 Kioicho, Chiyoda-ku, Tokyo, 102-8282, Japan",
          latitude,
          longitude,
        },
      })
    );
  }
});
```

LINE always sends the coordinates on an inbound location, and leaves `title` and `address` optional, because a sender can drop a pin without naming it. Coordinates outside the geographic ranges leave `message.location` unset rather than arriving as a place that looks valid. Webhook parsing makes no geocoding, map, or tile request.

Sending needs all four fields: `title` and `address` must be non-blank and at most 100 characters, `latitude` must fall between -90 and 90, and `longitude` between -180 and 180. Anything else throws a `ValidationError` before the adapter calls LINE. Locations use the same reply-first, push-fallback delivery as text, and `broadcastMessages()` and `multicastMessages()` accept them too. A LINE location message has no room for a quote, so a `quoteToken` or `mentions` on a `location` postable throws, as it does on a card.

### Lifecycle events

LINE reports who the bot can reach through `follow`, `unfollow`, `join`, `leave`, `memberJoined`, and `memberLeft` events. These are not messages, so they never reach `onMessage()` and are never turned into synthetic text. Subscribe to them on the adapter:

```typescript
const adapter = createLineAdapter();

const stop = adapter.onLifecycleEvent(async (event) => {
  switch (event.type) {
    case "follow":
      await adapter.postMessage(event.threadId, "Thanks for adding me");
      break;
    case "memberJoined":
      console.log("joined", event.members, "in", event.threadId);
      break;
    default:
      console.log(event.type, event.sourceType, event.sourceId);
  }
});
```

Every event carries `type`, `threadId`, `sourceType`, `sourceId`, `timestamp`, `webhookEventId`, `mode`, `isRedelivery`, and the untouched `raw` event. `userId` is set when LINE identifies the acting user, `members` lists who joined or left, `isUnblocked` says whether a `follow` came from an unblock, and `replyToken` is present only on `follow`, `join`, and `memberJoined`, the three events LINE issues one for.

`onLifecycleEvent()` returns a function that unsubscribes that handler. Every registered handler sees every event. A handler that throws or rejects is logged and does not stop the others or change the webhook response, which stays `200`.

LINE issues a reply token with `follow`, `join`, and `memberJoined`, and the adapter stores it, so a welcome message sent from the handler goes out over the free Reply API instead of the quota-metered Push API.

Two behaviors differ from message delivery on purpose. A redelivered lifecycle event is still delivered, with `isRedelivery` set, because a missed `unfollow` cannot be recovered the way a missed message can be resent. A standby-mode event is delivered too, with `mode` set to `standby`. Filter on those fields, and deduplicate on `webhookEventId`, which LINE guarantees is unique per delivery.

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
