import type { messagingApi } from "@line/bot-sdk";
import type {
  AdapterPostableMessage,
  Logger,
  PostableAst,
  PostableMarkdown,
  PostableRaw,
} from "chat";

/** Configuration for the LINE adapter */
export interface LineAdapterConfig {
  channelAccessToken: string;
  channelSecret: string;
  userName?: string;
  logger?: Logger;
}

/** Decoded thread ID components */
export interface LineThreadId {
  channelId: string;
  sourceType: "user" | "group" | "room";
  sourceId: string;
}

/**
 * A mention carried on an inbound LINE text message.
 *
 * `index` and `length` locate the mention text (for example `@Alice`) inside
 * the message text. `userId` is only present when the mentioned user has
 * consented to sharing their profile with the channel, and `isSelf` is true
 * when the mentioned user is the bot itself.
 */
export interface LineMention {
  type: "user" | "all";
  index: number;
  length: number;
  userId?: string;
  isSelf?: boolean;
}

/**
 * How LINE renders a sticker.
 *
 * `CUSTOM`, `MESSAGE`, `NAME_TEXT`, and `PER_STICKER_TEXT` stickers carry
 * text the sender typed, which puts them outside the sticker definitions a
 * bot can send.
 */
export type LineStickerResourceType =
  | "STATIC"
  | "ANIMATION"
  | "SOUND"
  | "ANIMATION_SOUND"
  | "POPUP"
  | "POPUP_SOUND"
  | "CUSTOM"
  | "MESSAGE"
  | "NAME_TEXT"
  | "PER_STICKER_TEXT";

/**
 * The sticker on an inbound LINE sticker message.
 *
 * `packageId` and `stickerId` identify the sticker. `keywords` describes it
 * in words, and LINE returns at most 15 of them, picked at random for each
 * event when the sticker has more. `text` is the sender's own text, which
 * only the personalized resource types carry.
 */
export interface LineSticker {
  packageId: string;
  stickerId: string;
  resourceType?: LineStickerResourceType;
  keywords?: string[];
  text?: string;
}

/** Raw LINE webhook message event */
export interface LineMessageEvent {
  type: "message";
  message: {
    type:
      | "text"
      | "image"
      | "video"
      | "audio"
      | "file"
      | "location"
      | "sticker";
    id: string;
    text?: string;
    quoteToken?: string;
    quotedMessageId?: string;
    markAsReadToken?: string;
    duration?: number;
    packageId?: string;
    stickerId?: string;
    stickerResourceType?: LineStickerResourceType;
    keywords?: string[];
    mention?: {
      mentionees: LineMention[];
    };
    contentProvider?: {
      type: "line" | "external";
      originalContentUrl?: string;
      previewImageUrl?: string;
    };
  };
  timestamp: number;
  source: {
    type: "user" | "group" | "room";
    userId?: string;
    groupId?: string;
    roomId?: string;
  };
  replyToken: string;
  mode: "active" | "standby";
  webhookEventId: string;
  deliveryContext: {
    isRedelivery: boolean;
  };
}

/** Raw LINE webhook postback event */
export interface LinePostbackEvent {
  type: "postback";
  postback: {
    data: string;
    params?: {
      date?: string;
      time?: string;
      datetime?: string;
    };
  };
  timestamp: number;
  source: {
    type: "user" | "group" | "room";
    userId?: string;
    groupId?: string;
    roomId?: string;
  };
  replyToken: string;
  mode: "active" | "standby";
  webhookEventId: string;
  deliveryContext: {
    isRedelivery: boolean;
  };
}

export type LineEvent = LineMessageEvent | LinePostbackEvent;

/** Raw LINE webhook payload (top-level) */
export interface LineWebhookPayload {
  destination: string;
  events: (LineEvent | Record<string, unknown>)[];
}

/** Response from LINE send message API */
export interface LineRawMessage {
  sentMessages: {
    id: string;
    quoteToken?: string;
  }[];
}

/**
 * A native mention to encode into an outbound text message.
 *
 * `index` and `length` select the span of the outbound text that LINE
 * replaces with the mention. Set `userId` to mention one user, or `all: true`
 * to mention everyone in a group or room.
 */
export interface LineMentionSegment {
  index: number;
  length: number;
  userId?: string;
  all?: boolean;
}

/** LINE-specific options accepted on outbound text messages. */
export interface LineTextOptions {
  /**
   * Quote token of the message to quote, taken from an inbound
   * `LineMessage.quoteToken` or from a previously sent message.
   */
  quoteToken?: string;
  /** Native mentions to encode into the text. */
  mentions?: LineMentionSegment[];
}

/** Plain text with optional LINE quote and mention data. */
export interface LinePostableText extends LineTextOptions {
  text: string;
}

/** Native LINE audio message. */
export interface LinePostableAudio {
  audio: {
    /** HTTPS URL of the audio file. */
    originalContentUrl: string;
    /** Length of the audio in milliseconds. */
    duration: number;
  };
}

/**
 * Native LINE sticker message.
 *
 * A bot can only send the stickers in LINE's sticker definitions, listed at
 * https://developers.line.biz/en/docs/messaging-api/sticker-list/.
 */
export interface LinePostableSticker {
  sticker: {
    packageId: string;
    stickerId: string;
    /**
     * Resource type, so an inbound `LineMessage.sticker` can be passed back
     * unchanged. The adapter rejects the types LINE cannot send.
     */
    resourceType?: LineStickerResourceType;
  };
  /**
   * Quote token of the message to quote. Unlike cards, Flex Messages, and
   * audio, a LINE sticker can carry a quote.
   */
  quoteToken?: string;
}

/**
 * Native LINE Flex Message.
 *
 * The adapter sends `contents` to LINE untouched, so this shape covers the
 * parts of the Flex schema the Chat SDK `card` model cannot express: hero
 * images, carousels, URI and datetime-picker actions, colors, and layout.
 */
export interface LinePostableFlex {
  flex: {
    /** Notification and chat-list text. Required, and at most 400 characters. */
    altText: string;
    /** A `bubble` or `carousel` container. */
    contents: messagingApi.FlexContainer;
  };
}

/**
 * Everything `LineAdapter.postMessage` accepts: the Chat SDK postables plus
 * LINE-native shapes.
 *
 * Quote tokens work on any postable that renders to text. Mentions need
 * stable character offsets, so they are only accepted on `text` and `raw`
 * postables, whose content is sent verbatim.
 */
export type LinePostableMessage =
  | AdapterPostableMessage
  | LinePostableText
  | LinePostableAudio
  | LinePostableFlex
  | LinePostableSticker
  | (PostableRaw & LineTextOptions)
  | (PostableMarkdown & Pick<LineTextOptions, "quoteToken">)
  | (PostableAst & Pick<LineTextOptions, "quoteToken">);

/** Options for `LineAdapter.broadcastMessages`. */
export interface LineBroadcastOptions {
  /**
   * Idempotency key forwarded as `X-Line-Retry-Key`. Must be a UUID. Reuse
   * the same key when retrying a request whose outcome is unknown so LINE
   * does not deliver it twice.
   */
  retryKey?: string;
  /** Deliver silently, without a push notification. */
  notificationDisabled?: boolean;
}

/** Options for `LineAdapter.multicastMessages`. */
export interface LineMulticastOptions extends LineBroadcastOptions {
  /** Aggregation unit name for LINE's per-unit statistics. At most one. */
  customAggregationUnits?: string[];
}

/** Result of a broadcast or multicast submission. */
export interface LineBatchSendResult {
  /** LINE's `X-Line-Request-Id` for the accepted request, when returned. */
  requestId?: string;
  /** Number of LINE message objects submitted. */
  messageCount: number;
  /** Number of recipients addressed. Only set for multicast. */
  recipientCount?: number;
}
