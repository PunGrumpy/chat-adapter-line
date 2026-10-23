/* eslint-disable class-methods-use-this */
import crypto from "node:crypto";

import {
  AdapterRateLimitError,
  extractFiles,
  PermissionError,
  ValidationError,
} from "@chat-adapter/shared";
import { HTTPFetchError, LineBotClient } from "@line/bot-sdk";
import type { messagingApi } from "@line/bot-sdk";
import type {
  Adapter,
  AdapterPostableMessage,
  Attachment,
  Author,
  ChatInstance,
  EmojiValue,
  FetchOptions,
  FetchResult,
  FormattedContent,
  Logger,
  Message,
  RawMessage,
  StreamChunk,
  StreamOptions,
  ThreadInfo,
  WebhookOptions,
} from "chat";
import { ConsoleLogger } from "chat";

import { parseInboundEmojis } from "./lib/emojis.js";
import { deserializePostbackData } from "./lib/flex-messages.js";
import { LineFormatConverter } from "./lib/format-converter.js";
import { isNonEmptyString } from "./lib/guards.js";
import { isLifecycleEvent, toLifecycleEvent } from "./lib/lifecycle-events.js";
import { parseInboundLocation } from "./lib/locations.js";
import { parseInboundMedia } from "./lib/media.js";
import { parseInboundMentions } from "./lib/mentions.js";
import {
  hasMentionSubstitution,
  MAX_MESSAGES_PER_REQUEST,
  toBatchLineMessages,
  toLineMessages,
  validateAggregationUnits,
  validateMulticastRecipients,
  validateRetryKey,
} from "./lib/outbound.js";
import { ReplyTokenStore } from "./lib/reply-token-store.js";
import { splitText } from "./lib/split-text.js";
import { parseInboundSticker } from "./lib/stickers.js";
import { buildTextMessage, MAX_TEXT_LENGTH } from "./lib/text-v2.js";
import {
  decodeThreadId,
  encodeThreadId,
  isDM as isDMThreadId,
  sourceIdFrom,
} from "./lib/thread-id.js";
import { LineMessage } from "./message.js";
import type {
  LineAdapterConfig,
  LineBatchSendResult,
  LineBroadcastOptions,
  LineEvent,
  LineLifecycleEvent,
  LineLifecycleHandler,
  LineLifecycleRawEvent,
  LineMediaMetadata,
  LineMessageEvent,
  LineMulticastOptions,
  LinePostableMessage,
  LinePostbackEvent,
  LineThreadId,
  LineWebhookPayload,
} from "./types.js";

export { LineFormatConverter } from "./lib/format-converter.js";

type RawMessageType = LineMessageEvent["message"]["type"];

interface SendResult {
  sentMessages?: { id: string; quoteToken?: string }[];
}

const verifySignature = (
  body: string,
  signature: string | null,
  channelSecret: string
): boolean => {
  if (!signature) {
    return false;
  }

  const expected = Buffer.from(
    crypto.createHmac("SHA256", channelSecret).update(body).digest("base64")
  );
  const received = Buffer.from(signature);

  // timingSafeEqual throws on inputs of different byte lengths.
  if (received.length !== expected.length) {
    return false;
  }

  return crypto.timingSafeEqual(received, expected);
};

const readableToBuffer = async (
  readable: NodeJS.ReadableStream
): Promise<Buffer> => {
  const chunks: Buffer[] = [];
  for await (const chunk of readable) {
    chunks.push(chunk instanceof Buffer ? chunk : Buffer.from(chunk));
  }
  return chunks.length === 1 ? chunks[0] : Buffer.concat(chunks);
};

const isLineEvent = (
  event: LineEvent | Record<string, unknown>
): event is LineEvent =>
  (event.type === "message" || event.type === "postback") &&
  typeof event.source === "object" &&
  event.source !== null &&
  typeof (event.source as Record<string, unknown>).type === "string" &&
  typeof event.timestamp === "number" &&
  typeof event.replyToken === "string" &&
  typeof event.webhookEventId === "string";

const getMimeType = (kind: LineMediaMetadata["kind"]): string => {
  if (kind === "image") {
    return "image/jpeg";
  }
  if (kind === "video") {
    return "video/mp4";
  }
  if (kind === "audio") {
    return "audio/mp4";
  }
  return "application/octet-stream";
};

const parseLineErrorMessage = (body: string): string | undefined => {
  try {
    const parsed: unknown = JSON.parse(body);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "message" in parsed &&
      typeof parsed.message === "string"
    ) {
      return parsed.message;
    }
  } catch {
    return undefined;
  }

  return undefined;
};

const INVALID_REPLY_TOKEN_MESSAGE = "Invalid reply token";

const isInvalidReplyTokenError = (error: unknown): boolean =>
  error instanceof HTTPFetchError &&
  error.status === 400 &&
  parseLineErrorMessage(error.body) === INVALID_REPLY_TOKEN_MESSAGE;

const toRateLimitError = (
  error: unknown
): AdapterRateLimitError | undefined => {
  if (!(error instanceof HTTPFetchError) || error.status !== 429) {
    return undefined;
  }
  const retryAfter = Number.parseInt(
    error.headers.get("retry-after") ?? "",
    10
  );
  return new AdapterRateLimitError(
    "line",
    retryAfter >= 0 ? retryAfter : undefined
  );
};

const VERIFICATION_REPLY_TOKEN_PATTERN = /^(0+|f+)$/i;

/**
 * LINE accepts multiples of 5 up to 60, and hides the animation early when
 * the bot's next message arrives.
 */
const LOADING_ANIMATION_SECONDS = 20;

const LOADING_ANIMATION_COOLDOWN_MS = 15_000;

const LOADING_ANIMATION_CHECK_MS = 1000;

const extractStreamText = (chunk: string | StreamChunk): string => {
  if (typeof chunk === "string") {
    return chunk;
  }
  if (chunk.type === "markdown_text") {
    return chunk.text;
  }
  return "";
};

const readStreamText = async (
  textStream: AsyncIterable<string | StreamChunk>
): Promise<string> => {
  let markdown = "";
  for await (const chunk of textStream) {
    markdown += extractStreamText(chunk);
  }
  return markdown;
};

const readRequestId = (response: {
  httpResponse: Response;
}): string | undefined =>
  response.httpResponse.headers.get("x-line-request-id") ?? undefined;

// An empty channel secret is a valid HMAC key, so anyone could sign webhooks.
const requireCredential = (
  value: unknown,
  name: "channelAccessToken" | "channelSecret"
): string => {
  if (typeof value !== "string" || value.trim() === "") {
    throw new ValidationError(
      "line",
      `${name} must be a non-empty string. Get your credentials at: https://developers.line.biz/console/`
    );
  }

  return value;
};

export class LineAdapter implements Adapter<LineThreadId, LineEvent> {
  readonly name = "line";
  readonly userName: string;

  private chat: ChatInstance | null = null;
  private logger: Logger;
  private client: LineBotClient;
  private channelSecret: string;
  private channelId: string | null = null;
  private converter = new LineFormatConverter();
  private threadCache = new Map<
    string,
    { info: ThreadInfo; expires: number }
  >();
  private loadingAnimationShownAt = new Map<string, number>();
  private replyTokens = new ReplyTokenStore();
  private lifecycleHandlers = new Set<LineLifecycleHandler>();

  constructor(config: LineAdapterConfig) {
    const channelAccessToken = requireCredential(
      config.channelAccessToken,
      "channelAccessToken"
    );
    this.channelSecret = requireCredential(
      config.channelSecret,
      "channelSecret"
    );
    this.client = LineBotClient.fromChannelAccessToken({ channelAccessToken });
    this.userName = config.userName ?? "line-bot";
    this.logger = config.logger ?? new ConsoleLogger();
  }

  async initialize(chat: ChatInstance): Promise<void> {
    this.chat = chat;
    this.logger = chat.getLogger("line");

    try {
      const botInfo = await this.callLine(() => this.client.getBotInfo());
      this.channelId = botInfo.userId;
      this.logger.info("LINE adapter initialized", { botId: botInfo.userId });
    } catch (error) {
      // Never throw here: the Chat SDK keeps a failed initialization and
      // replays it to every later webhook, for every adapter, until the
      // process restarts.
      this.logger.warn(
        "Failed to fetch bot info; the channel ID will come from the first webhook",
        { error }
      );
    }
  }

  disconnect(): Promise<void> {
    this.chat = null;
    return Promise.resolve();
  }

  /**
   * A LINE conversation has no threads inside it, so each 1:1 chat, group,
   * or room is its own Chat SDK channel, named by its thread ID.
   */
  channelIdFromThreadId(threadId: string): string {
    const { channelId, sourceId, sourceType } = decodeThreadId(threadId);
    return encodeThreadId(sourceType, channelId, sourceId);
  }

  isDM(threadId: string): boolean {
    return isDMThreadId(threadId);
  }

  encodeThreadId(data: LineThreadId): string {
    if (!this.channelId) {
      throw new ValidationError(
        "line",
        "Channel ID not available. Ensure the adapter is initialized before encoding thread IDs."
      );
    }
    return encodeThreadId(data.sourceType, this.channelId, data.sourceId);
  }

  decodeThreadId(threadId: string): LineThreadId {
    return decodeThreadId(threadId);
  }

  async handleWebhook(
    request: Request,
    options?: WebhookOptions
  ): Promise<Response> {
    const signature = request.headers.get("x-line-signature");
    const body = await request.text();

    if (!verifySignature(body, signature, this.channelSecret)) {
      return new Response("Invalid signature", { status: 401 });
    }

    let payload: LineWebhookPayload;
    try {
      payload = JSON.parse(body);
    } catch {
      return new Response("Invalid JSON", { status: 400 });
    }

    if (!payload.events) {
      return new Response("OK", { status: 200 });
    }

    if (this.channelId === null && isNonEmptyString(payload.destination)) {
      this.channelId = payload.destination;
    }

    const channelId = this.channelId ?? payload.destination;

    for (const event of payload.events) {
      if (isLifecycleEvent(event)) {
        this.dispatchLifecycleEvent(event, channelId, options);
        continue;
      }

      if (!isLineEvent(event)) {
        continue;
      }
      if (!this.chat) {
        continue;
      }
      if (event.mode !== "active") {
        continue;
      }
      if (event.deliveryContext?.isRedelivery) {
        continue;
      }
      if (VERIFICATION_REPLY_TOKEN_PATTERN.test(event.replyToken)) {
        continue;
      }

      const sourceId = sourceIdFrom(event.source);
      if (!sourceId) {
        continue;
      }

      const threadId = encodeThreadId(event.source.type, channelId, sourceId);

      this.replyTokens.set(threadId, event.replyToken);

      try {
        if (event.type === "postback") {
          this.processPostbackEvent(event, threadId, options);
        } else {
          const factory = (): Promise<Message<LineEvent>> =>
            Promise.resolve(this.parseMessage(event));

          this.chat?.processMessage(this, threadId, factory, options);
        }
      } catch (error) {
        this.logger.error("processMessage failed", {
          error,
          threadId,
        });
      }
    }

    return new Response("OK", { status: 200 });
  }

  /**
   * Registers a handler for LINE lifecycle events: `follow`, `unfollow`,
   * `join`, `leave`, `memberJoined`, and `memberLeft`.
   *
   * Every registered handler sees every event, and the returned function
   * unregisters this one. A handler that throws or rejects is logged and
   * does not stop the others or change the webhook response.
   *
   * Unlike message events, redelivered and standby-mode events are
   * delivered too, because a missed `unfollow` cannot be recovered the way
   * a missed message can be resent. Filter on `isRedelivery` and `mode`,
   * and deduplicate on `webhookEventId`.
   *
   * @example
   * ```ts
   * const stop = adapter.onLifecycleEvent((event) => {
   *   if (event.type === "follow") {
   *     console.log("new friend", event.userId);
   *   }
   * });
   * ```
   */
  onLifecycleEvent(handler: LineLifecycleHandler): () => void {
    this.lifecycleHandlers.add(handler);
    return () => {
      this.lifecycleHandlers.delete(handler);
    };
  }

  private dispatchLifecycleEvent(
    event: LineLifecycleRawEvent,
    channelId: string,
    options?: WebhookOptions
  ): void {
    const sourceId = sourceIdFrom(event.source);
    if (!sourceId) {
      return;
    }

    const threadId = encodeThreadId(event.source.type, channelId, sourceId);
    const lifecycle = toLifecycleEvent(event, threadId, sourceId);

    if (
      lifecycle.replyToken !== undefined &&
      !VERIFICATION_REPLY_TOKEN_PATTERN.test(lifecycle.replyToken)
    ) {
      this.replyTokens.set(threadId, lifecycle.replyToken);
    }

    for (const handler of this.lifecycleHandlers) {
      const task = this.runLifecycleHandler(handler, lifecycle);
      options?.waitUntil?.(task);
    }
  }

  private async runLifecycleHandler(
    handler: LineLifecycleHandler,
    event: LineLifecycleEvent
  ): Promise<void> {
    try {
      await handler(event);
    } catch (error) {
      this.logger.error("Lifecycle handler failed", {
        error,
        threadId: event.threadId,
        type: event.type,
      });
    }
  }

  private processPostbackEvent(
    event: LinePostbackEvent,
    threadId: string,
    options?: WebhookOptions
  ): void {
    const { data, params } = event.postback;
    const encoded = deserializePostbackData(data);
    const userId = event.source.userId ?? "unknown";

    this.chat?.processAction(
      {
        actionId: encoded?.id ?? data,
        adapter: this,
        messageId: event.webhookEventId,
        raw: event,
        threadId,
        user: {
          fullName: "",
          isBot: false,
          isMe: false,
          userId,
          userName: userId,
        },
        value:
          params?.datetime ?? params?.date ?? params?.time ?? encoded?.value,
      },
      options
    );
  }

  parseMessage(raw: LineMessageEvent): LineMessage {
    const sourceId = sourceIdFrom(raw.source);

    if (!this.channelId) {
      throw new ValidationError(
        "line",
        "Adapter not initialized. Call initialize() before parsing messages."
      );
    }

    if (!sourceId) {
      throw new ValidationError(
        "line",
        "Event has no valid source ID. Cannot construct thread ID."
      );
    }

    const userId = raw.source.userId ?? "unknown";
    const threadId = encodeThreadId(raw.source.type, this.channelId, sourceId);
    const author: Author = {
      fullName: "",
      isBot: false,
      isMe: false,
      userId,
      userName: userId,
    };

    const isText = raw.message.type === "text";
    const text = isText ? (raw.message.text ?? "") : "";
    const mentions = isText ? parseInboundMentions(raw.message) : [];
    const emojis = isText ? parseInboundEmojis(raw.message) : [];
    const mentionsBot = mentions.some((mention) => mention.isSelf === true);
    const quoteToken =
      typeof raw.message.quoteToken === "string"
        ? raw.message.quoteToken
        : undefined;
    const quotedMessageId =
      typeof raw.message.quotedMessageId === "string" &&
      raw.message.quotedMessageId !== ""
        ? raw.message.quotedMessageId
        : undefined;
    const sticker = parseInboundSticker(raw.message);
    const location = parseInboundLocation(raw.message);
    const media = parseInboundMedia(raw.message);

    const attachments: Attachment[] = [];
    if (media) {
      const messageId = media.providerMessageId;
      const attachment: Attachment = {
        fetchData: async () => {
          const stream = await this.callLine(() =>
            this.client.getMessageContent(messageId)
          );
          return readableToBuffer(stream);
        },
        mimeType: getMimeType(media.kind),
        name: media.fileName ?? `${media.kind}-${messageId}`,
        type: media.kind,
      };

      if (media.fileSize !== undefined) {
        attachment.size = media.fileSize;
      }

      // LINE hosts its own uploads behind the authenticated content API, so a
      // URL only exists when the sender's app hosted the file itself.
      if (
        media.contentProvider?.type === "external" &&
        media.contentProvider.originalContentUrl !== undefined
      ) {
        attachment.url = media.contentProvider.originalContentUrl;
      }

      attachments.push(attachment);
    }

    return new LineMessage({
      attachments,
      author,
      emojis,
      formatted: this.converter.toAst(text),
      id: raw.webhookEventId,
      isMention: mentionsBot,
      location,
      media,
      mentions,
      metadata: {
        dateSent: new Date(raw.timestamp),
        edited: false,
      },
      quoteToken,
      quotedMessageId,
      raw,
      sticker,
      text,
      threadId,
    });
  }

  async postMessage(
    threadId: string,
    message: LinePostableMessage
  ): Promise<RawMessage<LineEvent>> {
    const { sourceId, sourceType } = this.decodeThreadId(threadId);

    const files = extractFiles(message as AdapterPostableMessage);
    if (files.length > 0) {
      this.logger.warn("File attachments are not directly supported in LINE", {
        count: files.length,
      });
    }

    const lineMessages = toLineMessages(message, this.converter);

    if (sourceType === "user" && lineMessages.some(hasMentionSubstitution)) {
      throw new ValidationError(
        "line",
        "LINE only renders mentions in group chats and multi-person chats, not 1:1 chats"
      );
    }

    const result = await this.sendMessages(threadId, sourceId, lineMessages);
    const sentType = lineMessages[0]?.type === "audio" ? "audio" : "text";

    return this.buildRawMessage(result, "", threadId, sentType);
  }

  /**
   * Sends messages to every user who follows the channel through LINE's
   * broadcast endpoint. This never touches reply tokens or the push
   * fallback, so it cannot consume a pending reply.
   *
   * Pass the same `retryKey` when you retry a request whose outcome is
   * unknown; LINE then deduplicates delivery instead of sending twice.
   */
  async broadcastMessages(
    messages: LinePostableMessage | LinePostableMessage[],
    options: LineBroadcastOptions = {}
  ): Promise<LineBatchSendResult> {
    validateRetryKey(options.retryKey);
    const lineMessages = toBatchLineMessages(messages, this.converter);

    const response = await this.callLine(() =>
      this.client.broadcastWithHttpInfo(
        {
          messages: lineMessages,
          notificationDisabled: options.notificationDisabled,
        },
        options.retryKey
      )
    );

    const requestId = readRequestId(response);
    this.logger.debug("Sent broadcast", {
      messageCount: lineMessages.length,
      requestId,
    });

    return { messageCount: lineMessages.length, requestId };
  }

  /**
   * Sends messages to up to 500 LINE user IDs through LINE's multicast
   * endpoint. Like `broadcastMessages`, this bypasses reply tokens and the
   * reply/push path entirely.
   */
  async multicastMessages(
    userIds: string[],
    messages: LinePostableMessage | LinePostableMessage[],
    options: LineMulticastOptions = {}
  ): Promise<LineBatchSendResult> {
    validateRetryKey(options.retryKey);
    validateMulticastRecipients(userIds);
    validateAggregationUnits(options.customAggregationUnits);
    const lineMessages = toBatchLineMessages(messages, this.converter);

    const response = await this.callLine(() =>
      this.client.multicastWithHttpInfo(
        {
          customAggregationUnits: options.customAggregationUnits,
          messages: lineMessages,
          notificationDisabled: options.notificationDisabled,
          to: userIds,
        },
        options.retryKey
      )
    );

    const requestId = readRequestId(response);
    this.logger.debug("Sent multicast", {
      messageCount: lineMessages.length,
      recipientCount: userIds.length,
      requestId,
    });

    return {
      messageCount: lineMessages.length,
      recipientCount: userIds.length,
      requestId,
    };
  }

  private async sendMessages(
    threadId: string,
    sourceId: string,
    messages: messagingApi.Message[]
  ): Promise<SendResult> {
    this.loadingAnimationShownAt.delete(threadId);

    const replyToken = this.replyTokens.take(threadId);

    if (!replyToken) {
      return this.pushMessages(sourceId, messages);
    }

    try {
      const result = await this.client.replyMessage({
        messages,
        replyToken,
      });
      this.logger.debug("Sent via reply API", { threadId });
      return result;
    } catch (error) {
      const rateLimit = toRateLimitError(error);
      if (rateLimit) {
        this.replyTokens.set(threadId, replyToken);
        throw rateLimit;
      }

      if (!isInvalidReplyTokenError(error)) {
        throw error;
      }

      this.logger.warn("Reply token rejected, falling back to push", {
        error,
        threadId,
      });

      return this.pushMessages(sourceId, messages);
    }
  }

  private pushMessages(
    sourceId: string,
    messages: messagingApi.Message[]
  ): Promise<SendResult> {
    return this.callLine(() =>
      this.client.pushMessage({
        messages,
        to: sourceId,
      })
    );
  }

  private async callLine<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (error) {
      throw toRateLimitError(error) ?? error;
    }
  }

  /**
   * Sends a streamed reply once the stream ends.
   *
   * LINE cannot edit a sent message, so a reply cannot grow in place the way
   * it does on platforms with native streaming. The adapter collects the
   * whole stream, renders it the way it renders a `markdown` postable, splits
   * it into text messages within LINE's 5000-character limit, and sends them
   * five to a request. The first request uses the thread's reply token when
   * one is fresh, so a typical reply costs no message quota. In a 1:1 chat,
   * LINE's loading animation shows until the stream ends.
   */
  async stream(
    threadId: string,
    textStream: AsyncIterable<string | StreamChunk>,
    _options?: StreamOptions
  ): Promise<RawMessage<LineEvent>> {
    const { sourceId } = this.decodeThreadId(threadId);

    const markdown = await this.collectStream(threadId, textStream);

    const text = this.converter.fromMarkdown(markdown);
    const messages = splitText(text, MAX_TEXT_LENGTH).map((part) =>
      buildTextMessage(part)
    );

    if (messages.length === 0) {
      this.logger.debug("Stream produced no content, skipping send");
      return this.buildEmptyRawMessage(threadId);
    }

    let first: SendResult | undefined;
    for (
      let start = 0;
      start < messages.length;
      start += MAX_MESSAGES_PER_REQUEST
    ) {
      const result = await this.sendMessages(
        threadId,
        sourceId,
        messages.slice(start, start + MAX_MESSAGES_PER_REQUEST)
      );
      first ??= result;
    }

    return this.buildRawMessage(first ?? {}, text, threadId);
  }

  private async collectStream(
    threadId: string,
    textStream: AsyncIterable<string | StreamChunk>
  ): Promise<string> {
    if (!this.isDM(threadId)) {
      return readStreamText(textStream);
    }

    let renewal = this.startTyping(threadId);
    const timer = setInterval(() => {
      renewal = this.startTyping(threadId);
    }, LOADING_ANIMATION_CHECK_MS);

    try {
      return await readStreamText(textStream);
    } finally {
      clearInterval(timer);
      // A renewal reaching LINE after the reply would bring the animation back.
      await renewal;
    }
  }

  private buildRawMessage(
    result: SendResult,
    text: string,
    threadId: string,
    type: RawMessageType = "text"
  ): RawMessage<LineEvent> {
    const sent = result.sentMessages?.[0];
    const messageId = sent?.id ?? "";
    return {
      id: messageId,
      raw: {
        deliveryContext: { isRedelivery: false },
        message: {
          id: messageId,
          ...(sent?.quoteToken === undefined
            ? {}
            : { quoteToken: sent.quoteToken }),
          text,
          type,
        },
        mode: "active",
        replyToken: "",
        source: { type: "user", userId: "" },
        timestamp: Date.now(),
        type: "message",
        webhookEventId: messageId,
      },
      threadId,
    };
  }

  private buildEmptyRawMessage(threadId: string): RawMessage<LineEvent> {
    return {
      id: "",
      raw: {
        deliveryContext: { isRedelivery: false },
        message: { id: "", text: "", type: "text" },
        mode: "active",
        replyToken: "",
        source: { type: "user", userId: "" },
        timestamp: Date.now(),
        type: "message",
        webhookEventId: "",
      },
      threadId,
    };
  }

  editMessage(
    _threadId: string,
    _messageId: string,
    _message: LinePostableMessage
  ): Promise<RawMessage<LineEvent>> {
    throw new PermissionError("line", "LINE does not support message editing");
  }

  deleteMessage(_threadId: string, _messageId: string): Promise<void> {
    throw new PermissionError("line", "LINE does not support message deletion");
  }

  addReaction(
    _threadId: string,
    _messageId: string,
    _emoji: EmojiValue | string
  ): Promise<void> {
    throw new PermissionError("line", "LINE does not support reactions");
  }

  removeReaction(
    _threadId: string,
    _messageId: string,
    _emoji: EmojiValue | string
  ): Promise<void> {
    throw new PermissionError("line", "LINE does not support reactions");
  }

  fetchMessages(
    _threadId: string,
    _options?: FetchOptions
  ): Promise<FetchResult<LineEvent>> {
    throw new PermissionError("line", "LINE does not provide message history");
  }

  async fetchThread(threadId: string): Promise<ThreadInfo> {
    const cached = this.threadCache.get(threadId);
    if (cached && cached.expires > Date.now()) {
      return cached.info;
    }

    const { sourceType, sourceId } = this.decodeThreadId(threadId);
    const channelId = this.channelIdFromThreadId(threadId);

    let result: ThreadInfo;

    if (sourceType === "user") {
      result = await this.fetchUserThread(threadId, channelId, sourceId);
    } else if (sourceType === "group") {
      result = await this.fetchGroupThread(threadId, channelId, sourceId);
    } else {
      result = {
        channelId,
        channelName: undefined,
        id: threadId,
        isDM: false,
        metadata: { sourceType: "room" },
      };
    }

    this.threadCache.set(threadId, {
      expires: Date.now() + 5 * 60 * 1000,
      info: result,
    });

    return result;
  }

  private async fetchUserThread(
    threadId: string,
    channelId: string,
    sourceId: string
  ): Promise<ThreadInfo> {
    try {
      const profile = await this.callLine(() =>
        this.client.getProfile(sourceId)
      );
      return {
        channelId,
        channelName: undefined,
        id: threadId,
        isDM: true,
        metadata: { displayName: profile.displayName },
      };
    } catch (error) {
      if (error instanceof AdapterRateLimitError) {
        throw error;
      }
      return {
        channelId,
        channelName: undefined,
        id: threadId,
        isDM: true,
        metadata: {},
      };
    }
  }

  private async fetchGroupThread(
    threadId: string,
    channelId: string,
    sourceId: string
  ): Promise<ThreadInfo> {
    try {
      const summary = await this.callLine(() =>
        this.client.getGroupSummary(sourceId)
      );
      return {
        channelId,
        channelName: summary.groupName,
        id: threadId,
        isDM: false,
        metadata: { groupName: summary.groupName },
      };
    } catch (error) {
      if (error instanceof AdapterRateLimitError) {
        throw error;
      }
      return {
        channelId,
        channelName: undefined,
        id: threadId,
        isDM: false,
        metadata: {},
      };
    }
  }

  /**
   * Shows LINE's loading animation, its typing indicator. LINE only displays
   * it in one-on-one chats, so group and room threads are skipped.
   */
  async startTyping(threadId: string): Promise<void> {
    if (!this.isDM(threadId)) {
      return;
    }

    const shownAt = this.loadingAnimationShownAt.get(threadId);
    if (shownAt && Date.now() - shownAt < LOADING_ANIMATION_COOLDOWN_MS) {
      return;
    }

    const { sourceId } = this.decodeThreadId(threadId);

    try {
      await this.client.showLoadingAnimation({
        chatId: sourceId,
        loadingSeconds: LOADING_ANIMATION_SECONDS,
      });
      this.loadingAnimationShownAt.set(threadId, Date.now());
    } catch (error) {
      this.logger.debug("Failed to show the loading animation", {
        error,
        threadId,
      });
    }
  }

  renderFormatted(content: FormattedContent): string {
    return this.converter.fromAst(content);
  }

  /**
   * Returns the underlying LINE SDK client for operations not covered by the adapter.
   *
   * @example
   * ```ts
   * const client = adapter.getLineClient();
   * await client.getProfile(userId);
   * ```
   *
   * Note: Operations performed directly on this client bypass the adapter's
   * error handling and logging.
   */
  getLineClient(): LineBotClient {
    return this.client;
  }

  /**
   * @deprecated Use getLineClient() instead.
   */
  getClient(): LineBotClient {
    return this.client;
  }
}
