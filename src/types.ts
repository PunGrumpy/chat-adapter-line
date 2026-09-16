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

/**
 * A place on an inbound LINE location message.
 *
 * LINE always sends the coordinates. The title and address are optional,
 * because a sender can drop a pin without naming it.
 */
export interface LineLocation {
  latitude: number;
  longitude: number;
  title?: string;
  address?: string;
}

/**
 * A native LINE emoji on an inbound text message.
 *
 * `index` and `length` locate the emoji sequence inside the message text,
 * which LINE leaves in place. `productId` names the emoji set and `emojiId`
 * the emoji inside it.
 */
export interface LineEmoji {
  index: number;
  length: number;
  productId: string;
  emojiId: string;
}

/** Who a LINE webhook event came from. */
export interface LineEventSource {
  type: "user" | "group" | "room";
  userId?: string;
  groupId?: string;
  roomId?: string;
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
    emojis?: LineEmoji[];
    packageId?: string;
    stickerId?: string;
    stickerResourceType?: LineStickerResourceType;
    keywords?: string[];
    title?: string;
    address?: string;
    latitude?: number;
    longitude?: number;
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
  source: LineEventSource;
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
  source: LineEventSource;
  replyToken: string;
  mode: "active" | "standby";
  webhookEventId: string;
  deliveryContext: {
    isRedelivery: boolean;
  };
}

export type LineEvent = LineMessageEvent | LinePostbackEvent;

/** The LINE webhook events that report a change in who the bot can reach. */
export type LineLifecycleEventType =
  | "follow"
  | "unfollow"
  | "join"
  | "leave"
  | "memberJoined"
  | "memberLeft";

/** Raw LINE webhook lifecycle event */
export interface LineLifecycleRawEvent {
  type: LineLifecycleEventType;
  timestamp: number;
  source: LineEventSource;
  /** LINE issues one for `follow`, `join`, and `memberJoined` only. */
  replyToken?: string;
  mode: "active" | "standby";
  webhookEventId: string;
  deliveryContext: {
    isRedelivery: boolean;
  };
  follow?: {
    isUnblocked?: boolean;
  };
  joined?: {
    members: LineEventSource[];
  };
  left?: {
    members: LineEventSource[];
  };
}

/**
 * A LINE lifecycle webhook event, flattened onto one shape.
 *
 * These report who the bot can reach rather than what anyone said, so they
 * never become messages and never reach the Chat SDK's message handlers.
 */
export interface LineLifecycleEvent {
  type: LineLifecycleEventType;
  /** Thread the event happened in, in the adapter's encoded form. */
  threadId: string;
  sourceType: "user" | "group" | "room";
  /** The user, group, or room ID LINE named as the source. */
  sourceId: string;
  /** The acting user, when LINE identifies one. */
  userId?: string;
  /** When LINE recorded the event. */
  timestamp: Date;
  /** LINE's unique ID for this delivery. Deduplicate on it. */
  webhookEventId: string;
  mode: "active" | "standby";
  /** True when LINE is redelivering an event it already sent. */
  isRedelivery: boolean;
  /** Reply token, on the events LINE issues one for. */
  replyToken?: string;
  /** Who joined or left, on `memberJoined` and `memberLeft`. */
  members?: string[];
  /** On `follow`, true when a user unblocked rather than added the bot. */
  isUnblocked?: boolean;
  /** The event as LINE sent it. */
  raw: LineLifecycleRawEvent;
}

/** Receives every lifecycle event the adapter accepts. */
export type LineLifecycleHandler = (
  event: LineLifecycleEvent
) => void | Promise<void>;

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

/**
 * A native LINE emoji to encode into an outbound text message.
 *
 * `index` selects the `$` in the outbound text that LINE replaces with the
 * emoji, so the segment needs no length of its own.
 */
export interface LineEmojiSegment {
  index: number;
  productId: string;
  emojiId: string;
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
  /** Native LINE emoji to substitute for `$` characters in the text. */
  emojis?: LineEmojiSegment[];
}

/** Plain text with optional LINE quote and mention data. */
export interface LinePostableText extends LineTextOptions {
  text: string;
}

/**
 * The pair of URLs a LINE image or video message points at.
 *
 * LINE fetches both itself rather than taking bytes from the bot, so each
 * must be an HTTPS URL of at most 2000 characters that LINE can reach.
 */
export interface LineMediaUrls {
  /** The full-size image, or the video file. */
  originalContentUrl: string;
  /** The thumbnail shown in the chat before the media loads. */
  previewImageUrl: string;
}

/** Native LINE image message. */
export interface LinePostableImage {
  image: LineMediaUrls;
}

/** Native LINE video message. */
export interface LinePostableVideo {
  video: LineMediaUrls;
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
 * Native LINE location message.
 *
 * LINE drops the pin at the coordinates and shows the title and address
 * beside it, and requires all four. Latitude runs from -90 to 90 and
 * longitude from -180 to 180; the title and address are capped at 100
 * characters each.
 */
export interface LinePostableLocation {
  location: {
    title: string;
    address: string;
    latitude: number;
    longitude: number;
  };
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
 * Quote tokens work on any postable that renders to text. Mentions and
 * emoji need stable character offsets, so they are only accepted on `text`
 * and `raw` postables, whose content is sent verbatim.
 */
export type LinePostableMessage =
  | AdapterPostableMessage
  | LinePostableText
  | LinePostableAudio
  | LinePostableFlex
  | LinePostableImage
  | LinePostableLocation
  | LinePostableSticker
  | LinePostableVideo
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
