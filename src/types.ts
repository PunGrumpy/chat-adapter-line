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
