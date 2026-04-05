/* eslint-disable max-classes-per-file, class-methods-use-this */
import crypto from "node:crypto";

import {
  extractCard,
  extractFiles,
  PermissionError,
  ValidationError,
} from "@chat-adapter/shared";
import { LineBotClient } from "@line/bot-sdk";
import type { messagingApi } from "@line/bot-sdk";
import type {
  Adapter,
  AdapterPostableMessage,
  Attachment,
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

import { decodeThreadId, encodeThreadId, isDM } from "./lib/thread-id.js";
import { toPlainText } from "./lib/to-plain-text.js";
import type {
  LineAdapterConfig,
  LineMessageEvent,
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

const getSourceIdFromEvent = (event: LineMessageEvent): string | undefined => {
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

const isLineMessageEvent = (
  event: LineMessageEvent | Record<string, unknown>
): event is LineMessageEvent =>
  event.type === "message" &&
  typeof event.source === "object" &&
  event.source !== null &&
  typeof (event.source as Record<string, unknown>).type === "string" &&
  typeof event.timestamp === "number" &&
  typeof event.replyToken === "string" &&
  typeof event.message === "object" &&
  event.message !== null &&
  typeof (event.message as Record<string, unknown>).type === "string" &&
  typeof (event.message as Record<string, unknown>).id === "string";

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

export class LineAdapter implements Adapter<LineThreadId, LineMessageEvent> {
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
      const botInfo = await this.client.getBotInfo();
      this.channelId = botInfo.userId;
      this.logger.info("LINE adapter initialized", { botId: botInfo.userId });
    } catch (error) {
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
      if (!isLineMessageEvent(event)) {
        continue;
      }
      if (event.mode !== "active") {
        continue;
      }
      if (event.deliveryContext?.isRedelivery) {
        continue;
      }

      const sourceId = getSourceIdFromEvent(event);
      if (!sourceId) {
        continue;
      }

      const threadId = encodeThreadId(event.source.type, channelId, sourceId);

      const factory = (): Promise<Message<LineMessageEvent>> =>
        Promise.resolve(this.parseMessage(event));

      try {
        this.chat.processMessage(this, threadId, factory, options);
      } catch (error) {
        this.logger.error("processMessage failed", {
          error,
          threadId,
        });
      }
    }

    return new Response("OK", { status: 200 });
  }

  parseMessage(raw: LineMessageEvent): Message<LineMessageEvent> {
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
    const text = raw.message.type === "text" ? (raw.message.text ?? "") : "";
    const threadId = encodeThreadId(raw.source.type, this.channelId, sourceId);

    const attachments: Attachment[] = [];
    if (
      raw.message.type !== "text" &&
      VALID_ATTACHMENT_TYPES.has(raw.message.type)
    ) {
      const messageId = raw.message.id;
      attachments.push({
        fetchData: async () => {
          const stream = await this.client.getMessageContent(messageId);
          return readableToBuffer(stream);
        },
        mimeType: getMimeType(raw.message.type),
        name: `${raw.message.type}-${messageId}`,
        type: raw.message.type as Attachment["type"],
      });
    }

    return new Message({
      attachments,
      author: {
        fullName: "",
        isBot: false,
        isMe: false,
        userId,
        userName: userId,
      },
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
  ): Promise<RawMessage<LineMessageEvent>> {
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
      const rendered = this.converter.renderPostable({ card });
      lineMessages.push({ text: rendered, type: "text" });
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

    const result = await this.client.pushMessage({
      messages: messagesToSend,
      to: sourceId,
    });

    return this.buildRawMessage(result, "", threadId);
  }

  async stream(
    threadId: string,
    textStream: AsyncIterable<string | StreamChunk>,
    _options?: StreamOptions
  ): Promise<RawMessage<LineMessageEvent>> {
    const { sourceId } = this.decodeThreadId(threadId);
    let lastResult: RawMessage<LineMessageEvent> | undefined;
    let buffer = "";
    let sentCount = 0;

    for await (const chunk of textStream) {
      const text = extractStreamText(chunk);

      if (!text) {
        continue;
      }

      buffer += text;

      if (buffer.length > 500 && sentCount < 5) {
        const result = await this.client.pushMessage({
          messages: [{ text: buffer, type: "text" }],
          to: sourceId,
        });
        lastResult = this.buildRawMessage(result, buffer, threadId);
        sentCount += 1;
        buffer = "";
      }
    }

    if (buffer && sentCount < 5) {
      const result = await this.client.pushMessage({
        messages: [{ text: buffer, type: "text" }],
        to: sourceId,
      });
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
  ): RawMessage<LineMessageEvent> {
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

  private buildEmptyRawMessage(threadId: string): RawMessage<LineMessageEvent> {
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
  ): Promise<RawMessage<LineMessageEvent>> {
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
  ): Promise<FetchResult<LineMessageEvent>> {
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
      const profile = await this.client.getProfile(sourceId);
      return {
        channelId,
        channelName: undefined,
        id: threadId,
        isDM: true,
        metadata: { displayName: profile.displayName },
      };
    } catch {
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
      const summary = await this.client.getGroupSummary(sourceId);
      return {
        channelId,
        channelName: summary.groupName,
        id: threadId,
        isDM: false,
        metadata: { groupName: summary.groupName },
      };
    } catch {
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
