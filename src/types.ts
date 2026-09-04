import type { AdapterPostableMessage, Logger } from "chat";

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
    markAsReadToken?: string;
    duration?: number;
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
 */
export type LinePostableMessage = AdapterPostableMessage | LinePostableAudio;

/** Response from LINE send message API */
export interface LineRawMessage {
  sentMessages: {
    id: string;
    quoteToken?: string;
  }[];
}
