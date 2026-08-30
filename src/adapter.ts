/* eslint-disable max-classes-per-file, class-methods-use-this */
import crypto from "node:crypto";

import {
  AdapterRateLimitError,
  extractCard,
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
  RawMessage,
  Root,
  StreamChunk,
  StreamOptions,
  ThreadInfo,
  WebhookOptions,
} from "chat";
import {
  BaseFormatConverter,
  ConsoleLogger,
  Message,
  deriveChannelId,
  parseMarkdown,
  stringifyMarkdown,
} from "chat";

import {
  buildFlexMessage,
  deserializePostbackData,
} from "./lib/flex-messages.js";
import { ReplyTokenStore } from "./lib/reply-token-store.js";
import { decodeThreadId, encodeThreadId, isDM } from "./lib/thread-id.js";
import { toPlainText } from "./lib/to-plain-text.js";
import type {
  LineAdapterConfig,
  LineEvent,
  LineMessageEvent,
  LinePostbackEvent,
  LineThreadId,
  LineWebhookPayload,
} from "./types.js";

const VALID_ATTACHMENT_TYPES: ReadonlySet<string> = new Set([
  "image",
  "video",
  "audio",
  "file",
]);

const verifySignature = (
  body: string,
  signature: string | null,
  channelSecret: string
): boolean => {
  if (!signature) {
    return false;
  }

  const hash = crypto
    .createHmac("SHA256", channelSecret)
    .update(body)
    .digest("base64");

  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(hash));
};

const getSourceIdFromEvent = (event: LineEvent): string | undefined => {
  const { source } = event;
  if (source.type === "user") {
    return source.userId;
  }
  if (source.type === "group") {
    return source.groupId;
  }
  return source.roomId;
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

const getMimeType = (type: string): string => {
  if (type === "image") {
    return "image/jpeg";
  }
  if (type === "video") {
    return "video/mp4";
  }
  if (type === "audio") {
    return "audio/mp4";
  }
  return "application/octet-stream";
};

/**
 * LINE reports an expired or already used reply token as HTTP 400. Only that
 * case falls back to push, because a 400 caused by the request payload did
 * not consume the reply token and may have already sent messages.
 */
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

const isReplyTokenError = (error: unknown): boolean =>
  error instanceof HTTPFetchError &&
  error.status === 400 &&
  parseLineErrorMessage(error.body) === "Invalid reply token";

/**
 * A LINE 429 means the request was not processed, so mapping it to the
 * Chat SDK's {@link AdapterRateLimitError} (with the `Retry-After` seconds
 * when LINE provides the header) lets callers back off and can never
 * double-send. Returns `undefined` for every other error.
 */
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

/** LINE's webhook-URL verification probes carry an all-zero or all-"f" dummy reply token. */
const DUMMY_REPLY_TOKEN_PATTERN = /^(0+|f+)$/i;

const extractStreamText = (chunk: string | StreamChunk): string => {
  if (typeof chunk === "string") {
    return chunk;
  }
  if (chunk.type === "markdown_text") {
    return chunk.text;
  }
  return "";
};

export class LineFormatConverter extends BaseFormatConverter {
  toAst(platformText: string): Root {
    return parseMarkdown(platformText);
  }

  fromAst(ast: Root): string {
    return stringifyMarkdown(ast);
  }

  override renderPostable(message: AdapterPostableMessage): string {
    const rendered = super.renderPostable(message);
    return toPlainText(rendered);
  }
}

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
  private lastTypingTime = new Map<string, number>();
  private replyTokens = new ReplyTokenStore();

  constructor(config: LineAdapterConfig) {
    this.client = LineBotClient.fromChannelAccessToken({
      channelAccessToken: config.channelAccessToken,
    });
    this.channelSecret = config.channelSecret;
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
      // A rate-limited init is retryable; pinning channelId to "unknown"
      // would corrupt every thread ID for the process lifetime instead.
      if (error instanceof AdapterRateLimitError) {
        throw error;
      }
      this.logger.error("Failed to fetch bot info", { error });
      this.channelId = "unknown";
    }
  }

  disconnect(): Promise<void> {
    this.chat = null;
    return Promise.resolve();
  }

  channelIdFromThreadId(threadId: string): string {
    return deriveChannelId(this, threadId);
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

    if (!this.chat || !payload.events) {
      return new Response("OK", { status: 200 });
    }

    const channelId = this.channelId ?? payload.destination;

    for (const event of payload.events) {
      if (!isLineEvent(event)) {
        continue;
      }
      if (event.mode !== "active") {
        continue;
      }
      if (event.deliveryContext?.isRedelivery) {
        continue;
      }
      // Webhook-URL verification events are synthetic. Replying to LINE's
      // fake user fails, so drop them before they reach any handler.
      if (DUMMY_REPLY_TOKEN_PATTERN.test(event.replyToken)) {
        continue;
      }

      const sourceId = getSourceIdFromEvent(event);
      if (!sourceId) {
        continue;
      }

      const threadId = encodeThreadId(event.source.type, channelId, sourceId);

      // Reply tokens are single-use and short-lived; the first send for this
      // thread can use the free Reply API instead of metered push.
      this.replyTokens.set(threadId, event.replyToken);

      try {
        if (event.type === "postback") {
          this.processPostbackEvent(event, threadId, options);
        } else {
          const factory = (): Promise<Message<LineEvent>> =>
            Promise.resolve(this.parseMessage(event));

          this.chat.processMessage(this, threadId, factory, options);
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
   * Dispatches a LINE postback event to the Chat SDK's action handlers
   * (`chat.onAction`). Button clicks arrive as postback webhooks, so this
   * is the only path by which flex message buttons become ActionEvents.
   */
  private processPostbackEvent(
    event: LinePostbackEvent,
    threadId: string,
    options?: WebhookOptions
  ): void {
    const data = deserializePostbackData(event.postback.data);
    if (!data) {
      this.logger.debug("Skipping postback with unparseable data", {
        data: event.postback.data,
      });
      return;
    }

    const userId = event.source.userId ?? "unknown";

    this.chat?.processAction(
      {
        actionId: data.id,
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
        value: data.value,
      },
      options
    );
  }

  parseMessage(raw: LineMessageEvent): Message<LineEvent> {
    const sourceId = getSourceIdFromEvent(raw);

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

    const text = raw.message.type === "text" ? (raw.message.text ?? "") : "";

    const attachments: Attachment[] = [];
    if (
      raw.message.type !== "text" &&
      VALID_ATTACHMENT_TYPES.has(raw.message.type)
    ) {
      const messageId = raw.message.id;
      attachments.push({
        fetchData: async () => {
          const stream = await this.callLine(() =>
            this.client.getMessageContent(messageId)
          );
          return readableToBuffer(stream);
        },
        mimeType: getMimeType(raw.message.type),
        name: `${raw.message.type}-${messageId}`,
        type: raw.message.type as Attachment["type"],
      });
    }

    return new Message({
      attachments,
      author,
      formatted: this.converter.toAst(text),
      id: raw.webhookEventId,
      metadata: {
        dateSent: new Date(raw.timestamp),
        edited: false,
      },
      raw,
      text,
      threadId,
    });
  }

  async postMessage(
    threadId: string,
    message: AdapterPostableMessage
  ): Promise<RawMessage<LineEvent>> {
    const { sourceId } = this.decodeThreadId(threadId);

    const card = extractCard(message);
    const files = extractFiles(message);

    if (files.length > 0) {
      this.logger.warn("File attachments are not directly supported in LINE", {
        count: files.length,
      });
    }

    const lineMessages: messagingApi.Message[] = [];

    if (card) {
      const flexMessage = buildFlexMessage(card);
      lineMessages.push(flexMessage);
    } else if (typeof message === "string") {
      lineMessages.push({ text: message, type: "text" });
    } else if ("text" in message && typeof message.text === "string") {
      lineMessages.push({ text: message.text, type: "text" });
    } else if ("markdown" in message && typeof message.markdown === "string") {
      const rendered = this.converter.renderPostable(message);
      lineMessages.push({ text: rendered, type: "text" });
    } else if ("ast" in message && message.ast) {
      const rendered = this.converter.fromAst(message.ast);
      lineMessages.push({ text: toPlainText(rendered), type: "text" });
    }

    if (lineMessages.length === 0) {
      throw new ValidationError("line", "No message content to send");
    }

    const messagesToSend = lineMessages.slice(0, 5);

    const result = await this.sendMessages(threadId, sourceId, messagesToSend);

    return this.buildRawMessage(result, "", threadId);
  }

  /**
   * Sends messages via the free Reply API when a fresh webhook reply token is
   * available for the thread. Uses the quota-metered Push API otherwise:
   * proactive sends, late replies, tokens already consumed, or a reply
   * rejected because the token expired or was used.
   */
  private async sendMessages(
    threadId: string,
    sourceId: string,
    messages: messagingApi.Message[]
  ): Promise<{ sentMessages?: { id: string }[] }> {
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
      // A 429 means LINE never processed the request. Restore the still-valid
      // token for the retry, and don't fall back to push, since the throttle
      // applies to the whole channel and a push would just 429 again.
      const rateLimit = toRateLimitError(error);
      if (rateLimit) {
        this.replyTokens.set(threadId, replyToken);
        throw rateLimit;
      }

      if (!isReplyTokenError(error)) {
        throw error;
      }

      this.logger.warn("Reply token rejected, falling back to push", {
        error,
        threadId,
      });

      return this.pushMessages(sourceId, messages);
    }
  }

  /** Push with LINE 429s mapped to the Chat SDK's rate-limit error. */
  private pushMessages(
    sourceId: string,
    messages: messagingApi.Message[]
  ): Promise<{ sentMessages?: { id: string }[] }> {
    return this.callLine(() =>
      this.client.pushMessage({
        messages,
        to: sourceId,
      })
    );
  }

  /** Runs a LINE API call, mapping 429s to the Chat SDK's rate-limit error. */
  private async callLine<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (error) {
      throw toRateLimitError(error) ?? error;
    }
  }

  async stream(
    threadId: string,
    textStream: AsyncIterable<string | StreamChunk>,
    _options?: StreamOptions
  ): Promise<RawMessage<LineEvent>> {
    const { sourceId } = this.decodeThreadId(threadId);
    let lastResult: RawMessage<LineEvent> | undefined;
    let buffer = "";
    let sentCount = 0;

    for await (const chunk of textStream) {
      const text = extractStreamText(chunk);

      if (!text) {
        continue;
      }

      buffer += text;

      if (buffer.length > 500 && sentCount < 5) {
        const result = await this.sendMessages(threadId, sourceId, [
          { text: buffer, type: "text" },
        ]);
        lastResult = this.buildRawMessage(result, buffer, threadId);
        sentCount += 1;
        buffer = "";
      }
    }

    if (buffer && sentCount < 5) {
      const result = await this.sendMessages(threadId, sourceId, [
        { text: buffer, type: "text" },
      ]);
      lastResult = this.buildRawMessage(result, buffer, threadId);
    }

    if (!lastResult) {
      this.logger.debug("Stream produced no content, skipping send");
      return this.buildEmptyRawMessage(threadId);
    }

    return lastResult;
  }

  private buildRawMessage(
    result: { sentMessages?: { id: string }[] },
    text: string,
    threadId: string
  ): RawMessage<LineEvent> {
    const messageId = result.sentMessages?.[0]?.id ?? "";
    return {
      id: messageId,
      raw: {
        deliveryContext: { isRedelivery: false },
        message: {
          id: messageId,
          text,
          type: "text",
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
    _message: AdapterPostableMessage
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
      // Rate limits are retryable; don't cache a degraded ThreadInfo.
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
      // Rate limits are retryable; don't cache a degraded ThreadInfo.
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

  async startTyping(threadId: string): Promise<void> {
    if (!isDM(threadId)) {
      return;
    }

    const last = this.lastTypingTime.get(threadId);
    if (last && Date.now() - last < 50_000) {
      return;
    }

    const { sourceId } = this.decodeThreadId(threadId);

    try {
      await this.client.acquireChatControl(sourceId);
      this.lastTypingTime.set(threadId, Date.now());
    } catch (error) {
      this.logger.debug("Failed to acquire chat control", { error });
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
