import { ValidationError } from "@chat-adapter/shared";

import { LineAdapter } from "./adapter.js";
import type { LineAdapterConfig } from "./types.js";

/**
 * Create a LINE adapter with eager config validation.
 *
 * @example
 * ```ts
 * // With explicit config
 * const adapter = createLineAdapter({
 *   channelAccessToken: "eyJhbG...",
 *   channelSecret: "abc123...",
 * });
 *
 * // With environment variables
 * // LINE_CHANNEL_ACCESS_TOKEN and LINE_CHANNEL_SECRET must be set
 * const adapter = createLineAdapter();
 * ```
 */
export const createLineAdapter = (
  config?: Partial<LineAdapterConfig>
): LineAdapter => {
  const channelAccessToken =
    config?.channelAccessToken ?? process.env.LINE_CHANNEL_ACCESS_TOKEN;
  const channelSecret =
    config?.channelSecret ?? process.env.LINE_CHANNEL_SECRET;

  const missing: string[] = [];

  if (!channelAccessToken) {
    missing.push(
      "channelAccessToken (or set LINE_CHANNEL_ACCESS_TOKEN env var)"
    );
  }

  if (!channelSecret) {
    missing.push("channelSecret (or set LINE_CHANNEL_SECRET env var)");
  }

  if (missing.length > 0) {
    throw new ValidationError(
      "line",
      `Missing required configuration:\n` +
        `  - ${missing.join("\n  - ")}\n\n` +
        `Get your credentials at: https://developers.line.biz/console/`
    );
  }

  return new LineAdapter({
    channelAccessToken: channelAccessToken as string,
    channelSecret: channelSecret as string,
    logger: config?.logger,
    userName: config?.userName,
  });
};

export { LineAdapter, LineFormatConverter } from "./adapter.js";
export { LineMessage } from "./message.js";
export type { LineMessageData } from "./message.js";
export type {
  LineAdapterConfig,
  LineBatchSendResult,
  LineBroadcastOptions,
  LineEvent,
  LineMention,
  LineMentionSegment,
  LineMessageEvent,
  LineMulticastOptions,
  LinePostableAudio,
  LinePostableMessage,
  LinePostableText,
  LinePostbackEvent,
  LineRawMessage,
  LineTextOptions,
  LineThreadId,
  LineWebhookPayload,
} from "./types.js";
export { decodeThreadId, encodeThreadId, isDM } from "./lib/thread-id.js";
export { toPlainText } from "./lib/to-plain-text.js";
export {
  buildFlexMessage,
  deserializePostbackData,
  serializePostbackData,
} from "./lib/flex-messages.js";
export { buildTextMessage } from "./lib/mentions.js";
export { linePostable, toLineMessages } from "./lib/outbound.js";
