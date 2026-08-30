/* eslint-disable max-classes-per-file */
import crypto from "node:crypto";

import {
  AdapterRateLimitError,
  PermissionError,
  ValidationError,
} from "@chat-adapter/shared";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vite-plus/test";
import type { Mock } from "vite-plus/test";

import { LineAdapter, LineFormatConverter } from "../src/adapter.js";
import type { LineMessageEvent, LinePostbackEvent } from "../src/types.js";

// Mock @line/bot-sdk - factory is self-contained
vi.mock("@line/bot-sdk", () => {
  const pushMessage = vi.fn();
  const replyMessage = vi.fn();
  const getBotInfo = vi.fn();
  const getProfile = vi.fn();
  const getGroupSummary = vi.fn();
  const acquireChatControl = vi.fn();
  const getMessageContent = vi.fn();

  class HTTPFetchError extends Error {
    status: number;
    body: string;
    headers: Headers;

    constructor(
      message: string,
      status: number,
      body: string,
      headers?: Headers
    ) {
      super(message);
      this.name = "HTTPFetchError";
      this.status = status;
      this.body = body;
      this.headers = headers ?? new Headers();
    }
  }

  class MockLineBotClient {
    acquireChatControl = acquireChatControl;
    getBotInfo = getBotInfo;
    getGroupSummary = getGroupSummary;
    getMessageContent = getMessageContent;
    getProfile = getProfile;
    pushMessage = pushMessage;
    replyMessage = replyMessage;

    static fromChannelAccessToken = vi.fn(() => new MockLineBotClient());
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).__lineMocks = {
    HTTPFetchError,
    acquireChatControl,
    getBotInfo,
    getGroupSummary,
    getMessageContent,
    getProfile,
    pushMessage,
    replyMessage,
  };

  return { HTTPFetchError, LineBotClient: MockLineBotClient };
});

// Mock chat - factory is self-contained
vi.mock("chat", async (importOriginal) => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const actual = await (importOriginal as any)();

  const MockConsoleLogger = class ConsoleLogger {
    debug = vi.fn();
    error = vi.fn();
    info = vi.fn();
    warn = vi.fn();
  };

  const MockMessage = class Message {
    text: string;
    threadId: string;
    id: string;
    attachments: unknown[];
    formatted: unknown;
    raw: unknown;
    metadata: unknown;
    author: unknown;

    constructor(data: Record<string, unknown>) {
      this.text = data.text as string;
      this.threadId = data.threadId as string;
      this.id = data.id as string;
      this.attachments = data.attachments as unknown[];
      this.formatted = data.formatted;
      this.raw = data.raw;
      this.metadata = data.metadata;
      this.author = data.author;
    }
  };

  const parseMarkdown = vi.fn();
  const stringifyMarkdown = vi.fn();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).__chatMocks = { parseMarkdown, stringifyMarkdown };

  return {
    ...actual,
    ConsoleLogger: MockConsoleLogger,
    Message: MockMessage,
    deriveChannelId: vi.fn(
      (_adapter: unknown, threadId: string) => threadId.split(":")[1] ?? ""
    ),
    parseMarkdown,
    stringifyMarkdown,
  };
});

interface Mocks {
  pushMessage: Mock;
  replyMessage: Mock;
  getBotInfo: Mock;
  getProfile: Mock;
  getGroupSummary: Mock;
  acquireChatControl: Mock;
  getMessageContent: Mock;
  parseMarkdown: Mock;
  stringifyMarkdown: Mock;
}

const getMocks = (): Mocks => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const g = globalThis as any;
  return { ...g.__lineMocks, ...g.__chatMocks };
};

// Set default implementations for the chat mocks (used by LineFormatConverter tests)
const chatMocks = getMocks();
chatMocks.parseMarkdown.mockImplementation((text: string) => ({
  children: [],
  text,
  type: "root",
}));
chatMocks.stringifyMarkdown.mockImplementation(
  (ast: { text?: string }) => ast?.text ?? ""
);

const validConfig = {
  channelAccessToken: "test-token",
  channelSecret: "test-secret",
};

const generateSignature = (body: string, channelSecret: string): string =>
  crypto.createHmac("SHA256", channelSecret).update(body).digest("base64");

const makeEvent = (
  overrides: Partial<LineMessageEvent> = {}
): LineMessageEvent => ({
  deliveryContext: { isRedelivery: false },
  message: { id: "msg-1", quoteToken: "qt-1", text: "hello", type: "text" },
  mode: "active",
  replyToken: "reply-1",
  source: { type: "user", userId: "u-123" },
  timestamp: Date.now(),
  type: "message",
  webhookEventId: "evt-1",
  ...overrides,
});

const makePostbackEvent = (
  overrides: Partial<LinePostbackEvent> = {}
): LinePostbackEvent => ({
  deliveryContext: { isRedelivery: false },
  mode: "active",
  postback: { data: "id=btn-1&v=order-42" },
  replyToken: "reply-1",
  source: { type: "user", userId: "u-123" },
  timestamp: Date.now(),
  type: "postback",
  webhookEventId: "evt-pb-1",
  ...overrides,
});

const makeRequest = (body: string, signature?: string | null): Request =>
  new Request("https://example.com/webhook", {
    body,
    headers: signature ? { "x-line-signature": signature } : {},
    method: "POST",
  });

// Reusable async generators for stream tests
const helloWorldChunks = async function* helloWorldChunks() {
  yield "Hello ";
  yield "world";
};

const emptyChunks = async function* emptyChunks() {
  yield "";
};

const markdownTextChunk = async function* markdownTextChunk() {
  yield { text: "Hello", type: "markdown_text" as const };
};

const createRepeatedChunks = async function* createRepeatedChunksGen(
  text: string,
  count: number
): AsyncGenerator<string> {
  for (let i = 0; i < count; i += 1) {
    yield text;
  }
};

const createSingleChunk = async function* createSingleChunkGen(
  text: string
): AsyncGenerator<string> {
  yield text;
};

const createNonTextChunk = async function* createNonTextChunkGen<T>(
  chunk: T
): AsyncGenerator<T> {
  yield chunk;
};

const makeReplyTokenError = (): Error => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { HTTPFetchError } = (globalThis as any).__lineMocks;
  return new HTTPFetchError(
    "400 - Bad Request",
    400,
    JSON.stringify({ message: "Invalid reply token" })
  ) as Error;
};

const makeRateLimitError = (retryAfterSeconds?: number): Error => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { HTTPFetchError } = (globalThis as any).__lineMocks;
  const headers = new Headers(
    retryAfterSeconds === undefined
      ? undefined
      : { "retry-after": String(retryAfterSeconds) }
  );
  return new HTTPFetchError(
    "429 - Too Many Requests",
    429,
    "",
    headers
  ) as Error;
};

/** Delivers a webhook event to seed the reply-token store for a thread. */
const seedReplyToken = async (
  adapter: LineAdapter,
  overrides: Partial<LineMessageEvent> = {}
): Promise<void> => {
  const payload = {
    destination: "ch-123",
    events: [makeEvent(overrides)],
  };
  const body = JSON.stringify(payload);
  const sig = generateSignature(body, validConfig.channelSecret);
  const request = makeRequest(body, sig);

  await adapter.handleWebhook(request);
};

describe("LineFormatConverter", () => {
  it("converts text to AST", () => {
    const converter = new LineFormatConverter();
    const ast = converter.toAst("hello");
    expect(ast).toBeDefined();
  });

  it("converts AST to text", () => {
    const converter = new LineFormatConverter();
    const text = converter.fromAst({
      children: [],
      text: "hello",
      type: "root",
    } as never);
    expect(text).toBe("hello");
  });

  it("renderPostable returns plain text", () => {
    const converter = new LineFormatConverter();
    const result = converter.renderPostable("hello **world**");
    expect(result).toBe("hello world");
  });
});

describe("LineAdapter", () => {
  let adapter: LineAdapter;
  let mocks: Mocks;

  beforeEach(() => {
    mocks = getMocks();
    vi.clearAllMocks();
    mocks.getBotInfo.mockResolvedValue({ userId: "bot-123" });
    mocks.parseMarkdown.mockImplementation((text: string) => ({
      children: [],
      text,
      type: "root",
    }));
    mocks.stringifyMarkdown.mockImplementation(
      (ast: { text?: string }) => ast?.text ?? ""
    );
    adapter = new LineAdapter(validConfig);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe("constructor", () => {
    it("sets name to line", () => {
      expect(adapter.name).toBe("line");
    });

    it("uses default userName", () => {
      expect(adapter.userName).toBe("line-bot");
    });

    it("uses custom userName", () => {
      const customAdapter = new LineAdapter({
        ...validConfig,
        userName: "my-bot",
      });
      expect(customAdapter.userName).toBe("my-bot");
    });
  });

  describe("initialize", () => {
    it("fetches bot info and sets channelId", async () => {
      const mockChat = {
        getLogger: vi.fn(() => ({
          debug: vi.fn(),
          error: vi.fn(),
          info: vi.fn(),
          warn: vi.fn(),
        })),
      };

      await adapter.initialize(mockChat as never);

      expect(mocks.getBotInfo).toHaveBeenCalledOnce();
      expect(adapter.channelIdFromThreadId("line:bot-123:user:u-1")).toBe(
        "bot-123"
      );
    });

    it("falls back to unknown channelId on failure", async () => {
      mocks.getBotInfo.mockRejectedValue(new Error("API error"));
      const mockChat = {
        getLogger: vi.fn(() => ({
          debug: vi.fn(),
          error: vi.fn(),
          info: vi.fn(),
          warn: vi.fn(),
        })),
      };

      await adapter.initialize(mockChat as never);

      expect(adapter.channelIdFromThreadId("line:unknown:user:u-1")).toBe(
        "unknown"
      );
    });

    it("rethrows a 429 instead of pinning channelId to unknown", async () => {
      mocks.getBotInfo.mockRejectedValue(makeRateLimitError(10));
      const mockChat = {
        getLogger: vi.fn(() => ({
          debug: vi.fn(),
          error: vi.fn(),
          info: vi.fn(),
          warn: vi.fn(),
        })),
      };

      await expect(
        adapter.initialize(mockChat as never)
      ).rejects.toBeInstanceOf(AdapterRateLimitError);
    });
  });

  describe("disconnect", () => {
    it("resolves successfully", async () => {
      await expect(adapter.disconnect()).resolves.toBeUndefined();
    });
  });

  describe("encodeThreadId", () => {
    it("throws when adapter not initialized", () => {
      expect(() =>
        adapter.encodeThreadId({
          channelId: "ch-1",
          sourceId: "u-1",
          sourceType: "user",
        })
      ).toThrow(ValidationError);
    });

    it("encodes thread ID after initialization", async () => {
      await adapter.initialize({
        getLogger: vi.fn(() => ({
          debug: vi.fn(),
          error: vi.fn(),
          info: vi.fn(),
          warn: vi.fn(),
        })),
      } as never);

      const encoded = adapter.encodeThreadId({
        channelId: "ch-1",
        sourceId: "u-1",
        sourceType: "user",
      });

      expect(encoded).toBe("line:bot-123:user:u-1");
    });
  });

  describe("decodeThreadId", () => {
    it("decodes a valid thread ID", () => {
      const result = adapter.decodeThreadId("line:ch-123:user:u-abc");
      expect(result).toEqual({
        channelId: "ch-123",
        sourceId: "u-abc",
        sourceType: "user",
      });
    });

    it("throws on invalid thread ID", () => {
      expect(() => adapter.decodeThreadId("invalid")).toThrow();
    });
  });

  describe("handleWebhook", () => {
    let mockChat: {
      processMessage: Mock;
      processAction: Mock;
      getLogger: Mock;
    };

    beforeEach(async () => {
      mockChat = {
        getLogger: vi.fn(() => ({
          debug: vi.fn(),
          error: vi.fn(),
          info: vi.fn(),
          warn: vi.fn(),
        })),
        processAction: vi.fn(),
        processMessage: vi.fn(),
      };

      await adapter.initialize(mockChat as never);
    });

    it("returns 401 for invalid signature", async () => {
      const body = JSON.stringify({
        destination: "ch-123",
        events: [],
      });
      const wrongSig = generateSignature(body, "wrong-secret");
      const request = makeRequest(body, wrongSig);

      const response = await adapter.handleWebhook(request);

      expect(response.status).toBe(401);
    });

    it("returns 400 for invalid JSON with valid signature", async () => {
      const body = "not-json";
      const sig = generateSignature(body, validConfig.channelSecret);
      const request = makeRequest(body, sig);

      const response = await adapter.handleWebhook(request);

      expect(response.status).toBe(400);
    });

    it("returns 200 for empty events", async () => {
      const body = JSON.stringify({
        destination: "ch-123",
        events: [],
      });
      const sig = generateSignature(body, validConfig.channelSecret);
      const request = makeRequest(body, sig);

      const response = await adapter.handleWebhook(request);

      expect(response.status).toBe(200);
    });

    it("processes valid message events", async () => {
      const payload = {
        destination: "ch-123",
        events: [makeEvent()],
      };
      const body = JSON.stringify(payload);
      const sig = generateSignature(body, validConfig.channelSecret);
      const request = makeRequest(body, sig);

      const response = await adapter.handleWebhook(request);

      expect(response.status).toBe(200);
      expect(mockChat.processMessage).toHaveBeenCalledOnce();
    });

    it("dispatches postback events as actions", async () => {
      const payload = {
        destination: "ch-123",
        events: [makePostbackEvent()],
      };
      const body = JSON.stringify(payload);
      const sig = generateSignature(body, validConfig.channelSecret);
      const request = makeRequest(body, sig);

      const response = await adapter.handleWebhook(request);

      expect(response.status).toBe(200);
      expect(mockChat.processAction).toHaveBeenCalledOnce();
      expect(mockChat.processMessage).not.toHaveBeenCalled();

      const [[actionEvent]] = mockChat.processAction.mock.calls;
      expect(actionEvent).toMatchObject({
        actionId: "btn-1",
        messageId: "evt-pb-1",
        threadId: "line:bot-123:user:u-123",
        value: "order-42",
      });
      expect(actionEvent.adapter).toBe(adapter);
      expect(actionEvent.user).toMatchObject({ userId: "u-123" });
    });

    it("skips postback events with unparseable data", async () => {
      const payload = {
        destination: "ch-123",
        events: [makePostbackEvent({ postback: { data: "garbage" } })],
      };
      const body = JSON.stringify(payload);
      const sig = generateSignature(body, validConfig.channelSecret);
      const request = makeRequest(body, sig);

      const response = await adapter.handleWebhook(request);

      expect(response.status).toBe(200);
      expect(mockChat.processAction).not.toHaveBeenCalled();
      expect(mockChat.processMessage).not.toHaveBeenCalled();
    });

    it("dispatches postback without value as action without value", async () => {
      const payload = {
        destination: "ch-123",
        events: [makePostbackEvent({ postback: { data: "id=btn-2" } })],
      };
      const body = JSON.stringify(payload);
      const sig = generateSignature(body, validConfig.channelSecret);
      const request = makeRequest(body, sig);

      await adapter.handleWebhook(request);

      const [[actionEvent]] = mockChat.processAction.mock.calls;
      expect(actionEvent.actionId).toBe("btn-2");
      expect(actionEvent.value).toBeUndefined();
    });

    it("skips non-message events", async () => {
      const payload = {
        destination: "ch-123",
        events: [
          { source: { type: "user" }, timestamp: Date.now(), type: "follow" },
        ],
      };
      const body = JSON.stringify(payload);
      const sig = generateSignature(body, validConfig.channelSecret);
      const request = makeRequest(body, sig);

      const response = await adapter.handleWebhook(request);

      expect(response.status).toBe(200);
      expect(mockChat.processMessage).not.toHaveBeenCalled();
    });

    it("skips standby mode events", async () => {
      const payload = {
        destination: "ch-123",
        events: [makeEvent({ mode: "standby" })],
      };
      const body = JSON.stringify(payload);
      const sig = generateSignature(body, validConfig.channelSecret);
      const request = makeRequest(body, sig);

      const response = await adapter.handleWebhook(request);

      expect(response.status).toBe(200);
      expect(mockChat.processMessage).not.toHaveBeenCalled();
    });

    it("skips redelivery events", async () => {
      const payload = {
        destination: "ch-123",
        events: [
          makeEvent({
            deliveryContext: { isRedelivery: true },
          }),
        ],
      };
      const body = JSON.stringify(payload);
      const sig = generateSignature(body, validConfig.channelSecret);
      const request = makeRequest(body, sig);

      const response = await adapter.handleWebhook(request);

      expect(response.status).toBe(200);
      expect(mockChat.processMessage).not.toHaveBeenCalled();
    });

    it("uses destination as channelId when bot info not fetched", async () => {
      const adapter2 = new LineAdapter(validConfig);
      const mockChat2 = {
        getLogger: vi.fn(() => ({
          debug: vi.fn(),
          error: vi.fn(),
          info: vi.fn(),
          warn: vi.fn(),
        })),
        processMessage: vi.fn(),
      };

      await adapter2.initialize(mockChat2 as never);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (adapter2 as any).channelId = null;

      const payload = {
        destination: "ch-dest",
        events: [makeEvent()],
      };
      const body = JSON.stringify(payload);
      const sig = generateSignature(body, validConfig.channelSecret);
      const request = makeRequest(body, sig);

      const response = await adapter2.handleWebhook(request);

      expect(response.status).toBe(200);
      expect(mockChat2.processMessage).toHaveBeenCalledOnce();
      const [, threadId] = (mockChat2.processMessage as Mock).mock.calls[0] as [
        unknown,
        string,
      ];
      expect(threadId).toContain("ch-dest");
    });
  });

  describe("parseMessage", () => {
    beforeEach(async () => {
      await adapter.initialize({
        getLogger: vi.fn(() => ({
          debug: vi.fn(),
          error: vi.fn(),
          info: vi.fn(),
          warn: vi.fn(),
        })),
      } as never);
    });

    it("parses a text message", () => {
      const event = makeEvent();
      const message = adapter.parseMessage(event);

      expect(message.text).toBe("hello");
      expect(message.threadId).toBe("line:bot-123:user:u-123");
      expect(message.id).toBe("evt-1");
    });

    it("throws when adapter not initialized", () => {
      const uninitAdapter = new LineAdapter(validConfig);
      expect(() => uninitAdapter.parseMessage(makeEvent())).toThrow(
        ValidationError
      );
    });

    it("handles non-text messages with empty text", () => {
      const event = makeEvent({
        message: { id: "img-1", type: "image" },
      } as never);
      const message = adapter.parseMessage(event);

      expect(message.text).toBe("");
      expect(message.attachments).toHaveLength(1);
    });

    it("creates attachment for image messages", () => {
      const event = makeEvent({
        message: { id: "img-1", type: "image" },
      } as never);
      const message = adapter.parseMessage(event);

      expect(message.attachments[0]).toMatchObject({
        mimeType: "image/jpeg",
        name: "image-img-1",
        type: "image",
      });
    });

    it("creates attachment for video messages", () => {
      const event = makeEvent({
        message: { id: "vid-1", type: "video" },
      } as never);
      const message = adapter.parseMessage(event);

      expect(message.attachments[0]).toMatchObject({
        mimeType: "video/mp4",
        type: "video",
      });
    });

    it("creates attachment for audio messages", () => {
      const event = makeEvent({
        message: { id: "aud-1", type: "audio" },
      } as never);
      const message = adapter.parseMessage(event);

      expect(message.attachments[0]).toMatchObject({
        mimeType: "audio/mp4",
        type: "audio",
      });
    });

    it("handles group source type", () => {
      const event = makeEvent({
        source: { groupId: "g-123", type: "group" },
      });
      const message = adapter.parseMessage(event);

      expect(message.threadId).toBe("line:bot-123:group:g-123");
    });

    it("handles room source type", () => {
      const event = makeEvent({
        source: { roomId: "r-123", type: "room" },
      });
      const message = adapter.parseMessage(event);

      expect(message.threadId).toBe("line:bot-123:room:r-123");
    });
  });

  describe("postMessage", () => {
    beforeEach(async () => {
      await adapter.initialize({
        getLogger: vi.fn(() => ({
          debug: vi.fn(),
          error: vi.fn(),
          info: vi.fn(),
          warn: vi.fn(),
        })),
      } as never);
      mocks.pushMessage.mockResolvedValue({
        sentMessages: [{ id: "sent-1" }],
      });
    });

    it("sends a text string message", async () => {
      await adapter.postMessage("line:bot-123:user:u-123", "Hello");

      expect(mocks.pushMessage).toHaveBeenCalledWith({
        messages: [{ text: "Hello", type: "text" }],
        to: "u-123",
      });
    });

    it("sends a message object with text", async () => {
      const message = { text: "Hi" } as never;
      await adapter.postMessage("line:bot-123:user:u-123", message);

      expect(mocks.pushMessage).toHaveBeenCalledWith({
        messages: [{ text: "Hi", type: "text" }],
        to: "u-123",
      });
    });

    it("sends a markdown message as plain text", async () => {
      mocks.stringifyMarkdown.mockReturnValueOnce("# Hello **world**");

      const message = {
        markdown: "# Hello **world**",
      } as never;
      await adapter.postMessage("line:bot-123:user:u-123", message);

      expect(mocks.pushMessage).toHaveBeenCalledWith({
        messages: [{ text: "Hello world", type: "text" }],
        to: "u-123",
      });
    });

    it("sends an AST message as plain text", async () => {
      await adapter.postMessage("line:bot-123:user:u-123", {
        ast: { children: [], text: "hello", type: "root" },
      } as never);

      expect(mocks.pushMessage).toHaveBeenCalledWith({
        messages: [{ text: "hello", type: "text" }],
        to: "u-123",
      });
    });

    it("throws when no message content", async () => {
      await expect(
        adapter.postMessage("line:bot-123:user:u-123", {} as never)
      ).rejects.toThrow(ValidationError);
    });

    it("limits to 5 messages", async () => {
      mocks.pushMessage.mockResolvedValue({
        sentMessages: [{ id: "sent-1" }],
      });

      await adapter.postMessage("line:bot-123:user:u-123", "msg1");

      expect(mocks.pushMessage).toHaveBeenCalledOnce();
    });

    it("returns RawMessage with sent message ID", async () => {
      const result = await adapter.postMessage(
        "line:bot-123:user:u-123",
        "Hello"
      );

      expect(result.id).toBe("sent-1");
      expect(result.threadId).toBe("line:bot-123:user:u-123");
    });
  });

  describe("reply-first sending", () => {
    let mockChat: {
      processMessage: Mock;
      processAction: Mock;
      getLogger: Mock;
    };

    beforeEach(async () => {
      mockChat = {
        getLogger: vi.fn(() => ({
          debug: vi.fn(),
          error: vi.fn(),
          info: vi.fn(),
          warn: vi.fn(),
        })),
        processAction: vi.fn(),
        processMessage: vi.fn(),
      };

      await adapter.initialize(mockChat as never);
      mocks.pushMessage.mockResolvedValue({
        sentMessages: [{ id: "pushed-1" }],
      });
      mocks.replyMessage.mockResolvedValue({
        sentMessages: [{ id: "replied-1" }],
      });
    });

    it("uses reply API when a webhook reply token is available", async () => {
      await seedReplyToken(adapter, {
        replyToken: "fresh-reply-token",
        webhookEventId: "evt-seed",
      });

      const result = await adapter.postMessage(
        "line:bot-123:user:u-123",
        "Hello"
      );

      expect(mocks.replyMessage).toHaveBeenCalledWith({
        messages: [{ text: "Hello", type: "text" }],
        replyToken: "fresh-reply-token",
      });
      expect(mocks.pushMessage).not.toHaveBeenCalled();
      expect(result.id).toBe("replied-1");
    });

    it("consumes the reply token after one send", async () => {
      await seedReplyToken(adapter, { replyToken: "fresh-reply-token" });

      await adapter.postMessage("line:bot-123:user:u-123", "first");
      await adapter.postMessage("line:bot-123:user:u-123", "second");

      expect(mocks.replyMessage).toHaveBeenCalledOnce();
      expect(mocks.pushMessage).toHaveBeenCalledWith({
        messages: [{ text: "second", type: "text" }],
        to: "u-123",
      });
    });

    it("falls back to push when no reply token is stored", async () => {
      await adapter.postMessage("line:bot-123:user:u-123", "Hello");

      expect(mocks.replyMessage).not.toHaveBeenCalled();
      expect(mocks.pushMessage).toHaveBeenCalledWith({
        messages: [{ text: "Hello", type: "text" }],
        to: "u-123",
      });
    });

    it("falls back to push when the reply token is rejected", async () => {
      await seedReplyToken(adapter, { replyToken: "stale-reply-token" });
      mocks.replyMessage.mockRejectedValueOnce(makeReplyTokenError());

      const result = await adapter.postMessage(
        "line:bot-123:user:u-123",
        "Hello"
      );

      expect(mocks.replyMessage).toHaveBeenCalledOnce();
      expect(mocks.pushMessage).toHaveBeenCalledWith({
        messages: [{ text: "Hello", type: "text" }],
        to: "u-123",
      });
      expect(result.id).toBe("pushed-1");
    });

    it("does not retry push when a 400 has another error message", async () => {
      await seedReplyToken(adapter, { replyToken: "fresh-reply-token" });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { HTTPFetchError } = (globalThis as any).__lineMocks;
      mocks.replyMessage.mockRejectedValueOnce(
        new HTTPFetchError(
          "400 - Bad Request",
          400,
          JSON.stringify({ message: "The request body has 2 error(s)" })
        )
      );

      await expect(
        adapter.postMessage("line:bot-123:user:u-123", "Hello")
      ).rejects.toThrow("400");

      expect(mocks.pushMessage).not.toHaveBeenCalled();
    });

    it("keeps reply tokens scoped per thread", async () => {
      await seedReplyToken(adapter, {
        replyToken: "token-user-a",
        source: { type: "user", userId: "u-a" },
        webhookEventId: "evt-a",
      });
      await seedReplyToken(adapter, {
        replyToken: "token-user-b",
        source: { type: "user", userId: "u-b" },
        webhookEventId: "evt-b",
      });

      await adapter.postMessage("line:bot-123:user:u-a", "Hello A");

      expect(mocks.replyMessage).toHaveBeenCalledWith({
        messages: [{ text: "Hello A", type: "text" }],
        replyToken: "token-user-a",
      });
      expect(mocks.pushMessage).not.toHaveBeenCalled();
    });

    it("streams the first message via reply API and the rest via push", async () => {
      await seedReplyToken(adapter, { replyToken: "fresh-reply-token" });

      await adapter.stream(
        "line:bot-123:user:u-123",
        createRepeatedChunks("a".repeat(501), 2)
      );

      expect(mocks.replyMessage).toHaveBeenCalledExactlyOnceWith({
        messages: [{ text: "a".repeat(501), type: "text" }],
        replyToken: "fresh-reply-token",
      });
      expect(mocks.pushMessage).toHaveBeenCalledExactlyOnceWith({
        messages: [{ text: "a".repeat(501), type: "text" }],
        to: "u-123",
      });
    });

    it("seeds the reply token from postback events too", async () => {
      const payload = {
        destination: "ch-123",
        events: [makePostbackEvent({ replyToken: "postback-reply-token" })],
      };
      const body = JSON.stringify(payload);
      const sig = generateSignature(body, validConfig.channelSecret);
      const request = makeRequest(body, sig);

      await adapter.handleWebhook(request);

      await adapter.postMessage("line:bot-123:user:u-123", "Hello");

      expect(mocks.replyMessage).toHaveBeenCalledWith({
        messages: [{ text: "Hello", type: "text" }],
        replyToken: "postback-reply-token",
      });
    });

    it.each([
      ["all-zero", "00000000000000000000000000000000"],
      ["all-f", "ffffffffffffffffffffffffffffffff"],
    ])("skips LINE's %s verification dummy events", async (_label, token) => {
      await seedReplyToken(adapter, {
        replyToken: token,
        webhookEventId: "evt-verify",
      });

      // The synthetic event must not reach handlers or the token store.
      expect(mockChat.processMessage).not.toHaveBeenCalled();

      await adapter.postMessage("line:bot-123:user:u-123", "Hello");

      expect(mocks.replyMessage).not.toHaveBeenCalled();
      expect(mocks.pushMessage).toHaveBeenCalledOnce();
    });

    it.each([
      ["with Retry-After", 30, 30],
      ["without Retry-After", undefined, undefined],
    ])(
      "maps a 429 push %s to AdapterRateLimitError",
      async (_label, retryAfterHeader, expectedRetryAfter) => {
        mocks.pushMessage.mockRejectedValueOnce(
          makeRateLimitError(retryAfterHeader)
        );

        const promise = adapter.postMessage("line:bot-123:user:u-123", "Hello");

        await expect(promise).rejects.toBeInstanceOf(AdapterRateLimitError);
        await expect(promise).rejects.toMatchObject({
          retryAfter: expectedRetryAfter,
        });
      }
    );

    it("does not fall back to push when the reply attempt is rate limited", async () => {
      await seedReplyToken(adapter, {
        replyToken: "fresh-reply-token",
        webhookEventId: "evt-seed-429",
      });
      mocks.replyMessage.mockRejectedValueOnce(makeRateLimitError(7));

      // The whole channel is throttled, so a push would burn quota just to
      // 429 again. The rate limit propagates instead.
      const promise = adapter.postMessage("line:bot-123:user:u-123", "Hello");

      await expect(promise).rejects.toBeInstanceOf(AdapterRateLimitError);
      await expect(promise).rejects.toMatchObject({ retryAfter: 7 });
      expect(mocks.pushMessage).not.toHaveBeenCalled();
    });

    it("keeps the reply token when the reply attempt is rate limited", async () => {
      await seedReplyToken(adapter, {
        replyToken: "fresh-reply-token",
        webhookEventId: "evt-seed-keep",
      });
      mocks.replyMessage.mockRejectedValueOnce(makeRateLimitError(7));

      await expect(
        adapter.postMessage("line:bot-123:user:u-123", "Hello")
      ).rejects.toBeInstanceOf(AdapterRateLimitError);

      // LINE never consumed the token, so the retry still gets the free
      // Reply API instead of degrading to metered push.
      await adapter.postMessage("line:bot-123:user:u-123", "Hello");

      expect(mocks.replyMessage).toHaveBeenLastCalledWith({
        messages: [{ text: "Hello", type: "text" }],
        replyToken: "fresh-reply-token",
      });
      expect(mocks.pushMessage).not.toHaveBeenCalled();
    });
  });

  describe("stream", () => {
    beforeEach(async () => {
      await adapter.initialize({
        getLogger: vi.fn(() => ({
          debug: vi.fn(),
          error: vi.fn(),
          info: vi.fn(),
          warn: vi.fn(),
        })),
      } as never);
      mocks.pushMessage.mockResolvedValue({
        sentMessages: [{ id: "sent-1" }],
      });
    });

    it("sends buffered text when stream ends", async () => {
      const result = await adapter.stream(
        "line:bot-123:user:u-123",
        helloWorldChunks()
      );

      expect(mocks.pushMessage).toHaveBeenCalledWith({
        messages: [{ text: "Hello world", type: "text" }],
        to: "u-123",
      });
      expect(result.id).toBe("sent-1");
    });

    it("sends chunks when buffer exceeds 500 chars", async () => {
      const longText = "a".repeat(501);

      await adapter.stream(
        "line:bot-123:user:u-123",
        createSingleChunk(longText)
      );

      expect(mocks.pushMessage).toHaveBeenCalledWith({
        messages: [{ text: longText, type: "text" }],
        to: "u-123",
      });
    });

    it("limits to 5 stream messages", async () => {
      await adapter.stream(
        "line:bot-123:user:u-123",
        createRepeatedChunks("a".repeat(501), 10)
      );

      expect(mocks.pushMessage).toHaveBeenCalledTimes(5);
    });

    it("returns empty raw message when stream has no content", async () => {
      const result = await adapter.stream(
        "line:bot-123:user:u-123",
        emptyChunks()
      );

      expect(result.id).toBe("");
      expect(mocks.pushMessage).not.toHaveBeenCalled();
    });

    it("handles StreamChunk objects", async () => {
      await adapter.stream("line:bot-123:user:u-123", markdownTextChunk());

      expect(mocks.pushMessage).toHaveBeenCalledWith({
        messages: [{ text: "Hello", type: "text" }],
        to: "u-123",
      });
    });

    it("ignores non-text StreamChunk types", async () => {
      const nonTextChunk = {
        id: "task-1",
        status: "in_progress" as const,
        title: "thinking",
        type: "task_update" as const,
      };

      const result = await adapter.stream(
        "line:bot-123:user:u-123",
        createNonTextChunk(nonTextChunk) as AsyncIterable<string>
      );

      expect(result.id).toBe("");
      expect(mocks.pushMessage).not.toHaveBeenCalled();
    });
  });

  describe("editMessage", () => {
    it("throws PermissionError", () => {
      expect(() =>
        adapter.editMessage("thread-1", "msg-1", "new text")
      ).toThrow(PermissionError);
    });
  });

  describe("deleteMessage", () => {
    it("throws PermissionError", () => {
      expect(() => adapter.deleteMessage("thread-1", "msg-1")).toThrow(
        PermissionError
      );
    });
  });

  describe("addReaction", () => {
    it("throws PermissionError", () => {
      expect(() => adapter.addReaction("thread-1", "msg-1", "👍")).toThrow(
        PermissionError
      );
    });
  });

  describe("removeReaction", () => {
    it("throws PermissionError", () => {
      expect(() => adapter.removeReaction("thread-1", "msg-1", "👍")).toThrow(
        PermissionError
      );
    });
  });

  describe("fetchMessages", () => {
    it("throws PermissionError", () => {
      expect(() => adapter.fetchMessages("thread-1")).toThrow(PermissionError);
    });
  });

  describe("fetchThread", () => {
    beforeEach(async () => {
      await adapter.initialize({
        getLogger: vi.fn(() => ({
          debug: vi.fn(),
          error: vi.fn(),
          info: vi.fn(),
          warn: vi.fn(),
        })),
      } as never);
    });

    it("fetches user thread info", async () => {
      mocks.getProfile.mockResolvedValue({ displayName: "John Doe" });

      const result = await adapter.fetchThread("line:bot-123:user:u-123");

      expect(result.isDM).toBe(true);
      expect(result.metadata).toEqual({ displayName: "John Doe" });
    });

    it("handles user fetch failure gracefully", async () => {
      mocks.getProfile.mockRejectedValue(new Error("Not found"));

      const result = await adapter.fetchThread("line:bot-123:user:u-123");

      expect(result.isDM).toBe(true);
      expect(result.metadata).toEqual({});
    });

    it("fetches group thread info", async () => {
      mocks.getGroupSummary.mockResolvedValue({ groupName: "My Group" });

      const result = await adapter.fetchThread("line:bot-123:group:g-123");

      expect(result.isDM).toBe(false);
      expect(result.channelName).toBe("My Group");
      expect(result.metadata).toEqual({ groupName: "My Group" });
    });

    it("handles group fetch failure gracefully", async () => {
      mocks.getGroupSummary.mockRejectedValue(new Error("Not found"));

      const result = await adapter.fetchThread("line:bot-123:group:g-123");

      expect(result.isDM).toBe(false);
      expect(result.channelName).toBeUndefined();
    });

    it("rethrows a 429 instead of caching a degraded user thread", async () => {
      mocks.getProfile.mockRejectedValueOnce(makeRateLimitError(5));

      await expect(
        adapter.fetchThread("line:bot-123:user:u-429")
      ).rejects.toBeInstanceOf(AdapterRateLimitError);

      // The failure must not be cached: once the throttle clears, the next
      // lookup fetches the real profile.
      mocks.getProfile.mockResolvedValue({ displayName: "John Doe" });
      const result = await adapter.fetchThread("line:bot-123:user:u-429");

      expect(result.metadata).toEqual({ displayName: "John Doe" });
    });

    it("rethrows a 429 instead of caching a degraded group thread", async () => {
      mocks.getGroupSummary.mockRejectedValueOnce(makeRateLimitError(5));

      await expect(
        adapter.fetchThread("line:bot-123:group:g-429")
      ).rejects.toBeInstanceOf(AdapterRateLimitError);
    });

    it("handles room thread without API call", async () => {
      const result = await adapter.fetchThread("line:bot-123:room:r-123");

      expect(result.isDM).toBe(false);
      expect(result.metadata).toEqual({ sourceType: "room" });
      expect(mocks.getProfile).not.toHaveBeenCalled();
      expect(mocks.getGroupSummary).not.toHaveBeenCalled();
    });

    it("caches thread info for 5 minutes", async () => {
      mocks.getProfile.mockResolvedValue({ displayName: "John" });

      const result1 = await adapter.fetchThread("line:bot-123:user:u-123");
      const result2 = await adapter.fetchThread("line:bot-123:user:u-123");

      expect(result1).toBe(result2);
      expect(mocks.getProfile).toHaveBeenCalledOnce();
    });
  });

  describe("startTyping", () => {
    beforeEach(async () => {
      await adapter.initialize({
        getLogger: vi.fn(() => ({
          debug: vi.fn(),
          error: vi.fn(),
          info: vi.fn(),
          warn: vi.fn(),
        })),
      } as never);
    });

    it("acquires chat control for user threads", async () => {
      mocks.acquireChatControl.mockResolvedValue(null as never);

      await adapter.startTyping("line:bot-123:user:u-123");

      expect(mocks.acquireChatControl).toHaveBeenCalledWith("u-123");
    });

    it("skips non-user threads", async () => {
      await adapter.startTyping("line:bot-123:group:g-123");

      expect(mocks.acquireChatControl).not.toHaveBeenCalled();
    });

    it("respects 50s cooldown", async () => {
      mocks.acquireChatControl.mockResolvedValue(null as never);

      await adapter.startTyping("line:bot-123:user:u-123");
      await adapter.startTyping("line:bot-123:user:u-123");

      expect(mocks.acquireChatControl).toHaveBeenCalledOnce();
    });

    it("handles acquire failure gracefully", async () => {
      mocks.acquireChatControl.mockRejectedValue(new Error("Rate limited"));

      await expect(
        adapter.startTyping("line:bot-123:user:u-123")
      ).resolves.toBeUndefined();
    });
  });

  describe("getLineClient / getClient", () => {
    it("returns the underlying LINE client", () => {
      const client = adapter.getLineClient();
      expect(client).toBeDefined();
    });

    it("getClient returns same client as getLineClient", () => {
      expect(adapter.getClient()).toBe(adapter.getLineClient());
    });
  });

  describe("renderFormatted", () => {
    it("converts AST to markdown string", () => {
      const result = adapter.renderFormatted({
        children: [],
        text: "hello",
        type: "root",
      } as never);

      expect(result).toBe("hello");
    });
  });
});
