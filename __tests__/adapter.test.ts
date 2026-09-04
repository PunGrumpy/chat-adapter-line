/* eslint-disable max-classes-per-file */
import crypto from "node:crypto";

import {
  AdapterRateLimitError,
  PermissionError,
  ValidationError,
} from "@chat-adapter/shared";
import { deriveChannelId } from "chat";
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
import { LineMessage } from "../src/message.js";
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
  const broadcastWithHttpInfo = vi.fn();
  const multicastWithHttpInfo = vi.fn();

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
    broadcastWithHttpInfo = broadcastWithHttpInfo;
    getBotInfo = getBotInfo;
    getGroupSummary = getGroupSummary;
    getMessageContent = getMessageContent;
    getProfile = getProfile;
    multicastWithHttpInfo = multicastWithHttpInfo;
    pushMessage = pushMessage;
    replyMessage = replyMessage;

    static fromChannelAccessToken = vi.fn(() => new MockLineBotClient());
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).__lineMocks = {
    HTTPFetchError,
    acquireChatControl,
    broadcastWithHttpInfo,
    getBotInfo,
    getGroupSummary,
    getMessageContent,
    getProfile,
    multicastWithHttpInfo,
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
    isMention?: boolean;

    constructor(data: Record<string, unknown>) {
      this.text = data.text as string;
      this.threadId = data.threadId as string;
      this.id = data.id as string;
      this.attachments = data.attachments as unknown[];
      this.formatted = data.formatted;
      this.raw = data.raw;
      this.metadata = data.metadata;
      this.author = data.author;
      this.isMention = data.isMention as boolean | undefined;
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
    parseMarkdown,
    stringifyMarkdown,
  };
});

interface Mocks {
  broadcastWithHttpInfo: Mock;
  multicastWithHttpInfo: Mock;
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

/** Mimics the LINE SDK's `*WithHttpInfo` response for an accepted batch send. */
const acceptedResponse = (requestId?: string) => ({
  body: {},
  httpResponse: new Response(null, {
    headers: requestId ? { "x-line-request-id": requestId } : {},
    status: 200,
  }),
});

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

  describe("channelIdFromThreadId", () => {
    it("parses the channel ID from the thread ID", () => {
      expect(adapter.channelIdFromThreadId("line:bot-123:user:u-1")).toBe(
        "bot-123"
      );
      expect(adapter.channelIdFromThreadId("line:bot-9:group:g-1")).toBe(
        "bot-9"
      );
    });

    it("throws on a malformed thread ID", () => {
      expect(() => adapter.channelIdFromThreadId("slack:C1:T1")).toThrow(
        /Invalid LINE thread ID/
      );
    });

    it("does not recurse when the SDK derives the channel ID", () => {
      expect(deriveChannelId(adapter, "line:bot-123:user:u-1")).toBe("bot-123");
    });
  });

  describe("isDM", () => {
    it.each([
      ["line:bot-123:user:u-1", true],
      ["line:bot-123:group:g-1", false],
      ["line:bot-123:room:r-1", false],
      ["not-a-thread-id", false],
    ])("isDM(%s) is %s", (threadId, expected) => {
      expect(adapter.isDM(threadId)).toBe(expected);
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

    it("sends a raw postable as text", async () => {
      await adapter.postMessage("line:bot-123:user:u-123", { raw: "as-is" });

      expect(mocks.pushMessage).toHaveBeenCalledWith({
        messages: [{ text: "as-is", type: "text" }],
        to: "u-123",
      });
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

  describe("broadcastMessages / multicastMessages", () => {
    const RETRY_KEY = "123e4567-e89b-12d3-a456-426614174000";
    const USER_A = `U${"a".repeat(32)}`;
    const USER_B = `U${"b".repeat(32)}`;

    beforeEach(async () => {
      await adapter.initialize({
        getLogger: vi.fn(() => ({
          debug: vi.fn(),
          error: vi.fn(),
          info: vi.fn(),
          warn: vi.fn(),
        })),
      } as never);
      mocks.broadcastWithHttpInfo.mockResolvedValue(acceptedResponse("req-b"));
      mocks.multicastWithHttpInfo.mockResolvedValue(acceptedResponse("req-m"));
      mocks.pushMessage.mockResolvedValue({ sentMessages: [{ id: "p-1" }] });
      mocks.replyMessage.mockResolvedValue({ sentMessages: [{ id: "r-1" }] });
    });

    it("broadcasts converted messages and returns the request ID", async () => {
      const result = await adapter.broadcastMessages("Hello everyone", {
        retryKey: RETRY_KEY,
      });

      expect(mocks.broadcastWithHttpInfo).toHaveBeenCalledWith(
        { messages: [{ text: "Hello everyone", type: "text" }] },
        RETRY_KEY
      );
      expect(result).toEqual({ messageCount: 1, requestId: "req-b" });
    });

    it("broadcasts several postables in one request", async () => {
      mocks.stringifyMarkdown.mockReturnValueOnce("# Title");

      const result = await adapter.broadcastMessages(
        [
          { markdown: "# Title" },
          { raw: "plain" },
          { card: { children: [], title: "Card", type: "card" } },
        ],
        { notificationDisabled: true }
      );

      expect(mocks.broadcastWithHttpInfo).toHaveBeenCalledWith(
        {
          messages: [
            { text: "Title", type: "text" },
            { text: "plain", type: "text" },
            expect.objectContaining({ type: "flex" }),
          ],
          notificationDisabled: true,
        },
        undefined
      );
      expect(result.messageCount).toBe(3);
    });

    it("returns an undefined request ID when LINE omits the header", async () => {
      mocks.broadcastWithHttpInfo.mockResolvedValueOnce(acceptedResponse());

      const result = await adapter.broadcastMessages("Hi");

      expect(result.requestId).toBeUndefined();
    });

    it("rejects more than five messages instead of truncating", async () => {
      await expect(
        adapter.broadcastMessages(["1", "2", "3", "4", "5", "6"])
      ).rejects.toThrow(/at most 5 messages/);

      expect(mocks.broadcastWithHttpInfo).not.toHaveBeenCalled();
    });

    it("rejects an empty message list", async () => {
      await expect(adapter.broadcastMessages([])).rejects.toBeInstanceOf(
        ValidationError
      );
    });

    it("rejects a retry key that is not a UUID", async () => {
      await expect(
        adapter.broadcastMessages("Hi", { retryKey: "not-a-uuid" })
      ).rejects.toThrow(/retryKey must be a UUID/);

      expect(mocks.broadcastWithHttpInfo).not.toHaveBeenCalled();
    });

    it("does not consume a pending reply token", async () => {
      await seedReplyToken(adapter, { replyToken: "fresh-reply-token" });

      await adapter.broadcastMessages("Announcement");
      await adapter.postMessage("line:bot-123:user:u-123", "Reply");

      expect(mocks.replyMessage).toHaveBeenCalledWith({
        messages: [{ text: "Reply", type: "text" }],
        replyToken: "fresh-reply-token",
      });
      expect(mocks.pushMessage).not.toHaveBeenCalled();
    });

    it("maps a 429 broadcast to AdapterRateLimitError", async () => {
      mocks.broadcastWithHttpInfo.mockRejectedValueOnce(makeRateLimitError(12));

      const promise = adapter.broadcastMessages("Hi");

      await expect(promise).rejects.toBeInstanceOf(AdapterRateLimitError);
      await expect(promise).rejects.toMatchObject({ retryAfter: 12 });
    });

    it("propagates other broadcast failures unchanged", async () => {
      mocks.broadcastWithHttpInfo.mockRejectedValueOnce(new Error("boom"));

      await expect(adapter.broadcastMessages("Hi")).rejects.toThrow("boom");
    });

    it("multicasts to the given user IDs", async () => {
      const result = await adapter.multicastMessages(
        [USER_A, USER_B],
        { text: "Hi both" } as never,
        {
          customAggregationUnits: ["promo_a"],
          notificationDisabled: false,
          retryKey: RETRY_KEY,
        }
      );

      expect(mocks.multicastWithHttpInfo).toHaveBeenCalledWith(
        {
          customAggregationUnits: ["promo_a"],
          messages: [{ text: "Hi both", type: "text" }],
          notificationDisabled: false,
          to: [USER_A, USER_B],
        },
        RETRY_KEY
      );
      expect(result).toEqual({
        messageCount: 1,
        recipientCount: 2,
        requestId: "req-m",
      });
    });

    it.each([
      ["no recipients", []],
      ["a malformed user ID", ["u-123"]],
      ["a non-string entry", [USER_A, 42 as never]],
      ["more than 500 recipients", Array.from({ length: 501 }, () => USER_A)],
    ])("rejects multicast with %s", async (_label, userIds) => {
      await expect(
        adapter.multicastMessages(userIds, "Hi")
      ).rejects.toBeInstanceOf(ValidationError);

      expect(mocks.multicastWithHttpInfo).not.toHaveBeenCalled();
    });

    it.each([
      ["two units", ["a", "b"]],
      ["an empty unit", [""]],
      ["a 31-character unit", ["x".repeat(31)]],
      ["a non-string unit", [7 as never]],
    ])("rejects multicast with %s", async (_label, units) => {
      await expect(
        adapter.multicastMessages([USER_A], "Hi", {
          customAggregationUnits: units,
        })
      ).rejects.toBeInstanceOf(ValidationError);

      expect(mocks.multicastWithHttpInfo).not.toHaveBeenCalled();
    });

    it("accepts exactly 500 recipients", async () => {
      const userIds = Array.from({ length: 500 }, () => USER_A);

      const result = await adapter.multicastMessages(userIds, "Hi");

      expect(result.recipientCount).toBe(500);
    });

    it("maps a 429 multicast to AdapterRateLimitError", async () => {
      mocks.multicastWithHttpInfo.mockRejectedValueOnce(makeRateLimitError());

      await expect(
        adapter.multicastMessages([USER_A], "Hi")
      ).rejects.toBeInstanceOf(AdapterRateLimitError);
    });
  });

  describe("postMessage LINE-native postables", () => {
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
        sentMessages: [{ id: "pushed-1", quoteToken: "sent-qt" }],
      });
      mocks.replyMessage.mockResolvedValue({
        sentMessages: [{ id: "replied-1" }],
      });
    });

    const audio = {
      duration: 12_000,
      originalContentUrl: "https://example.com/audio.m4a",
    };

    it("sends a native audio message via push", async () => {
      const result = await adapter.postMessage("line:bot-123:user:u-123", {
        audio,
      });

      expect(mocks.pushMessage).toHaveBeenCalledWith({
        messages: [
          {
            duration: 12_000,
            originalContentUrl: "https://example.com/audio.m4a",
            type: "audio",
          },
        ],
        to: "u-123",
      });
      expect(result.id).toBe("pushed-1");
      expect(result.raw.type === "message" && result.raw.message.type).toBe(
        "audio"
      );
    });

    it("sends a native audio message via reply when a token is available", async () => {
      await seedReplyToken(adapter, { replyToken: "fresh-reply-token" });

      const result = await adapter.postMessage("line:bot-123:user:u-123", {
        audio,
      });

      expect(mocks.replyMessage).toHaveBeenCalledWith({
        messages: [{ ...audio, type: "audio" }],
        replyToken: "fresh-reply-token",
      });
      expect(mocks.pushMessage).not.toHaveBeenCalled();
      expect(result.id).toBe("replied-1");
    });

    it("falls back to push for audio when the reply token is rejected", async () => {
      await seedReplyToken(adapter, { replyToken: "stale-reply-token" });
      mocks.replyMessage.mockRejectedValueOnce(makeReplyTokenError());

      await adapter.postMessage("line:bot-123:user:u-123", { audio });

      expect(mocks.pushMessage).toHaveBeenCalledWith({
        messages: [{ ...audio, type: "audio" }],
        to: "u-123",
      });
    });

    it.each([
      [
        "http URL",
        { ...audio, originalContentUrl: "http://example.com/a.m4a" },
      ],
      ["empty URL", { ...audio, originalContentUrl: "" }],
      ["non-URL", { ...audio, originalContentUrl: "not a url" }],
      ["zero duration", { ...audio, duration: 0 }],
      ["negative duration", { ...audio, duration: -1 }],
      ["fractional duration", { ...audio, duration: 1.5 }],
      ["infinite duration", { ...audio, duration: Number.POSITIVE_INFINITY }],
      ["NaN duration", { ...audio, duration: Number.NaN }],
    ])("rejects audio with %s before calling LINE", async (_label, bad) => {
      await expect(
        adapter.postMessage("line:bot-123:user:u-123", { audio: bad })
      ).rejects.toBeInstanceOf(ValidationError);

      expect(mocks.pushMessage).not.toHaveBeenCalled();
      expect(mocks.replyMessage).not.toHaveBeenCalled();
    });

    it("propagates provider failures for audio sends", async () => {
      mocks.pushMessage.mockRejectedValueOnce(new Error("LINE is down"));

      await expect(
        adapter.postMessage("line:bot-123:user:u-123", { audio })
      ).rejects.toThrow("LINE is down");
    });

    it("maps a 429 on an audio send to AdapterRateLimitError", async () => {
      mocks.pushMessage.mockRejectedValueOnce(makeRateLimitError(3));

      await expect(
        adapter.postMessage("line:bot-123:user:u-123", { audio })
      ).rejects.toBeInstanceOf(AdapterRateLimitError);
    });

    it("exposes the sent message's quote token on the raw result", async () => {
      const result = await adapter.postMessage(
        "line:bot-123:user:u-123",
        "Hello"
      );

      expect(
        result.raw.type === "message" && result.raw.message.quoteToken
      ).toBe("sent-qt");
    });

    it("carries a quote token on a text send via push", async () => {
      await adapter.postMessage("line:bot-123:user:u-123", {
        quoteToken: "qt-1",
        text: "Quoting you",
      });

      expect(mocks.pushMessage).toHaveBeenCalledWith({
        messages: [{ quoteToken: "qt-1", text: "Quoting you", type: "text" }],
        to: "u-123",
      });
    });

    it("carries a quote token on a text send via reply", async () => {
      await seedReplyToken(adapter, { replyToken: "fresh-reply-token" });

      await adapter.postMessage("line:bot-123:user:u-123", {
        quoteToken: "qt-1",
        text: "Quoting you",
      });

      expect(mocks.replyMessage).toHaveBeenCalledWith({
        messages: [{ quoteToken: "qt-1", text: "Quoting you", type: "text" }],
        replyToken: "fresh-reply-token",
      });
      expect(mocks.pushMessage).not.toHaveBeenCalled();
    });

    it("carries a quote token on markdown and raw sends", async () => {
      mocks.stringifyMarkdown.mockReturnValueOnce("**bold**");

      await adapter.postMessage("line:bot-123:user:u-123", {
        markdown: "**bold**",
        quoteToken: "qt-md",
      });
      await adapter.postMessage("line:bot-123:user:u-123", {
        quoteToken: "qt-raw",
        raw: "raw",
      });

      expect(mocks.pushMessage).toHaveBeenNthCalledWith(1, {
        messages: [{ quoteToken: "qt-md", text: "bold", type: "text" }],
        to: "u-123",
      });
      expect(mocks.pushMessage).toHaveBeenNthCalledWith(2, {
        messages: [{ quoteToken: "qt-raw", text: "raw", type: "text" }],
        to: "u-123",
      });
    });

    it("rejects a quote token on a card instead of sending unquoted", async () => {
      await expect(
        adapter.postMessage("line:bot-123:user:u-123", {
          card: { children: [], title: "Card", type: "card" },
          quoteToken: "qt-1",
        } as never)
      ).rejects.toThrow(/cannot quote/);

      expect(mocks.pushMessage).not.toHaveBeenCalled();
    });

    it("rejects a quote token on audio", async () => {
      await expect(
        adapter.postMessage("line:bot-123:user:u-123", {
          audio,
          quoteToken: "qt-1",
        } as never)
      ).rejects.toBeInstanceOf(ValidationError);

      expect(mocks.pushMessage).not.toHaveBeenCalled();
    });

    it("rejects an empty quote token", async () => {
      await expect(
        adapter.postMessage("line:bot-123:user:u-123", {
          quoteToken: "",
          text: "hi",
        })
      ).rejects.toBeInstanceOf(ValidationError);
    });

    it("encodes mentions as a textV2 message via push", async () => {
      await adapter.postMessage("line:bot-123:group:g-1", {
        mentions: [{ index: 6, length: 6, userId: "U-alice" }],
        text: "Hello @Alice!",
      });

      expect(mocks.pushMessage).toHaveBeenCalledWith({
        messages: [
          {
            substitution: {
              mention0: {
                mentionee: { type: "user", userId: "U-alice" },
                type: "mention",
              },
            },
            text: "Hello {mention0}!",
            type: "textV2",
          },
        ],
        to: "g-1",
      });
    });

    it("encodes mentions via reply and keeps the quote token", async () => {
      await seedReplyToken(adapter, {
        replyToken: "group-reply-token",
        source: { groupId: "g-1", type: "group", userId: "u-123" },
      });

      await adapter.postMessage("line:bot-123:group:g-1", {
        mentions: [{ all: true, index: 0, length: 4 }],
        quoteToken: "qt-1",
        text: "@all look",
      });

      expect(mocks.replyMessage).toHaveBeenCalledWith({
        messages: [
          {
            quoteToken: "qt-1",
            substitution: {
              mention0: { mentionee: { type: "all" }, type: "mention" },
            },
            text: "{mention0} look",
            type: "textV2",
          },
        ],
        replyToken: "group-reply-token",
      });
      expect(mocks.pushMessage).not.toHaveBeenCalled();
    });

    it("rejects mentions in a 1:1 chat before calling LINE", async () => {
      await expect(
        adapter.postMessage("line:bot-123:user:u-123", {
          mentions: [{ index: 0, length: 2, userId: "U-alice" }],
          text: "@A hi",
        })
      ).rejects.toThrow(/1:1 chats/);

      expect(mocks.pushMessage).not.toHaveBeenCalled();
      expect(mocks.replyMessage).not.toHaveBeenCalled();
    });

    it("allows mentions in rooms", async () => {
      await adapter.postMessage("line:bot-123:room:r-1", {
        mentions: [{ index: 0, length: 2, userId: "U-alice" }],
        text: "@A hi",
      });

      expect(mocks.pushMessage).toHaveBeenCalledWith({
        messages: [expect.objectContaining({ type: "textV2" })],
        to: "r-1",
      });
    });

    it("rejects mentions on markdown instead of sending plain text", async () => {
      await expect(
        adapter.postMessage("line:bot-123:group:g-1", {
          markdown: "Hello @Alice",
          mentions: [{ index: 6, length: 6, userId: "U-alice" }],
        } as never)
      ).rejects.toThrow(/cannot encode mentions/);

      expect(mocks.pushMessage).not.toHaveBeenCalled();
    });

    it("rejects mentions on cards and audio", async () => {
      const mentions = [{ index: 0, length: 1, userId: "U-alice" }];

      await expect(
        adapter.postMessage("line:bot-123:group:g-1", {
          card: { children: [], title: "Card", type: "card" },
          mentions,
        } as never)
      ).rejects.toBeInstanceOf(ValidationError);
      await expect(
        adapter.postMessage("line:bot-123:group:g-1", {
          audio,
          mentions,
        } as never)
      ).rejects.toBeInstanceOf(ValidationError);

      expect(mocks.pushMessage).not.toHaveBeenCalled();
    });

    it("rejects a mention that points outside the text", async () => {
      await expect(
        adapter.postMessage("line:bot-123:group:g-1", {
          mentions: [{ index: 10, length: 5, userId: "U-alice" }],
          text: "short",
        })
      ).rejects.toBeInstanceOf(ValidationError);

      expect(mocks.pushMessage).not.toHaveBeenCalled();
    });

    it("still sends plain text when mentions is an empty array", async () => {
      await adapter.postMessage("line:bot-123:user:u-123", {
        mentions: [],
        text: "plain",
      });

      expect(mocks.pushMessage).toHaveBeenCalledWith({
        messages: [{ text: "plain", type: "text" }],
        to: "u-123",
      });
    });

    it("rejects mentions in broadcast and multicast", async () => {
      const postable = {
        mentions: [{ index: 0, length: 2, userId: "U-alice" }],
        text: "@A hi",
      };

      await expect(adapter.broadcastMessages(postable)).rejects.toThrow(
        /not broadcast or multicast/
      );
      await expect(
        adapter.multicastMessages([`U${"a".repeat(32)}`], ["plain", postable])
      ).rejects.toBeInstanceOf(ValidationError);

      expect(mocks.broadcastWithHttpInfo).not.toHaveBeenCalled();
      expect(mocks.multicastWithHttpInfo).not.toHaveBeenCalled();
    });

    it("broadcasts audio alongside text", async () => {
      mocks.broadcastWithHttpInfo.mockResolvedValue(acceptedResponse("req-a"));

      const result = await adapter.broadcastMessages(["Listen", { audio }]);

      expect(mocks.broadcastWithHttpInfo).toHaveBeenCalledWith(
        {
          messages: [
            { text: "Listen", type: "text" },
            { ...audio, type: "audio" },
          ],
        },
        undefined
      );
      expect(result.messageCount).toBe(2);
    });
  });

  describe("parseMessage LINE-native fields", () => {
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

    it("returns a LineMessage carrying the quote token", () => {
      const message = adapter.parseMessage(makeEvent());

      expect(message).toBeInstanceOf(LineMessage);
      expect(message.quoteToken).toBe("qt-1");
      expect(message.mentions).toEqual([]);
      expect(message.isMention).toBe(false);
    });

    it("decodes the mentionees array into mentions", () => {
      const message = adapter.parseMessage(
        makeEvent({
          message: {
            id: "msg-1",
            mention: {
              mentionees: [
                {
                  index: 0,
                  isSelf: false,
                  length: 6,
                  type: "user",
                  userId: "U-alice",
                },
                { index: 7, length: 4, type: "all" },
                { index: 12, length: 4, type: "user" },
              ],
            },
            quoteToken: "qt-2",
            text: "@Alice @All @Bob hi",
            type: "text",
          },
          source: { groupId: "g-1", type: "group", userId: "u-123" },
        })
      );

      expect(message.mentions).toEqual([
        { index: 0, isSelf: false, length: 6, type: "user", userId: "U-alice" },
        { index: 7, length: 4, type: "all" },
        { index: 12, length: 4, type: "user" },
      ]);
      expect(message.isMention).toBe(false);
    });

    it("marks the message as a mention when the bot is mentioned", () => {
      const message = adapter.parseMessage(
        makeEvent({
          message: {
            id: "msg-1",
            mention: {
              mentionees: [{ index: 0, isSelf: true, length: 4, type: "user" }],
            },
            quoteToken: "qt-3",
            text: "@Bot hello",
            type: "text",
          },
          source: { groupId: "g-1", type: "group", userId: "u-123" },
        })
      );

      expect(message.isMention).toBe(true);
      expect(message.mentions[0]?.isSelf).toBe(true);
    });

    it("drops malformed mentionees without failing the message", () => {
      const message = adapter.parseMessage(
        makeEvent({
          message: {
            id: "msg-1",
            mention: {
              mentionees: [
                { index: "0", length: 4, type: "user" },
                null,
                { index: 5, length: 3, type: "unknown" },
                { index: 9, length: 2, type: "user", userId: "U-ok" },
              ] as never,
            },
            text: "@Bot @x @ok",
            type: "text",
          },
        })
      );

      expect(message.mentions).toEqual([
        { index: 9, length: 2, type: "user", userId: "U-ok" },
      ]);
    });

    it("keeps the quote token on media messages and leaves mentions empty", () => {
      const message = adapter.parseMessage(
        makeEvent({
          message: { id: "img-1", quoteToken: "qt-img", type: "image" },
        })
      );

      expect(message.mentions).toEqual([]);
      expect(message.quoteToken).toBe("qt-img");
    });

    it("leaves quoteToken unset when LINE sends none", () => {
      const message = adapter.parseMessage(
        makeEvent({ message: { id: "loc-1", type: "location" } })
      );

      expect(message.quoteToken).toBeUndefined();
    });
  });
});
