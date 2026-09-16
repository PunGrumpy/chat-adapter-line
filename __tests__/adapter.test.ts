/* eslint-disable max-classes-per-file */
import crypto from "node:crypto";
import { Readable } from "node:stream";

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

const makeLifecycleEvent = (
  overrides: Record<string, unknown> = {}
): Record<string, unknown> => ({
  deliveryContext: { isRedelivery: false },
  mode: "active",
  source: { type: "user", userId: "u-123" },
  timestamp: 1_700_000_000_000,
  type: "follow",
  webhookEventId: "evt-lc-1",
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

  describe("onLifecycleEvent", () => {
    let mockChat: {
      processMessage: Mock;
      processAction: Mock;
      getLogger: Mock;
    };

    const deliver = async (
      ...events: Record<string, unknown>[]
    ): Promise<Response> => {
      const body = JSON.stringify({ destination: "ch-123", events });
      const sig = generateSignature(body, validConfig.channelSecret);
      return await adapter.handleWebhook(makeRequest(body, sig));
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

    it.each([
      ["follow", { replyToken: "rt-1", type: "follow" }],
      ["unfollow", { type: "unfollow" }],
      ["join", { replyToken: "rt-1", type: "join" }],
      ["leave", { type: "leave" }],
      [
        "memberJoined",
        {
          joined: { members: [{ type: "user", userId: "u-9" }] },
          replyToken: "rt-1",
          type: "memberJoined",
        },
      ],
      [
        "memberLeft",
        {
          left: { members: [{ type: "user", userId: "u-9" }] },
          type: "memberLeft",
        },
      ],
    ])("delivers a %s event", async (type, overrides) => {
      const handler = vi.fn();
      adapter.onLifecycleEvent(handler);

      const response = await deliver(makeLifecycleEvent(overrides));

      expect(response.status).toBe(200);
      expect(handler).toHaveBeenCalledOnce();
      expect(handler.mock.calls[0][0]).toMatchObject({
        sourceId: "u-123",
        threadId: "line:bot-123:user:u-123",
        type,
        webhookEventId: "evt-lc-1",
      });
    });

    it.each([
      ["user", { type: "user", userId: "u-123" }, "line:bot-123:user:u-123"],
      ["group", { groupId: "g-1", type: "group" }, "line:bot-123:group:g-1"],
      ["room", { roomId: "r-1", type: "room" }, "line:bot-123:room:r-1"],
    ])("resolves a %s source to its thread", async (_l, source, threadId) => {
      const handler = vi.fn();
      adapter.onLifecycleEvent(handler);

      await deliver(makeLifecycleEvent({ source }));

      expect(handler.mock.calls[0][0]).toMatchObject({ threadId });
    });

    it("delivers an event that carries no reply token", async () => {
      const handler = vi.fn();
      adapter.onLifecycleEvent(handler);

      await deliver(makeLifecycleEvent({ type: "unfollow" }));

      expect(handler).toHaveBeenCalledOnce();
      expect(handler.mock.calls[0][0].replyToken).toBeUndefined();
    });

    it("delivers a redelivered event with the flag set", async () => {
      const handler = vi.fn();
      adapter.onLifecycleEvent(handler);

      await deliver(
        makeLifecycleEvent({ deliveryContext: { isRedelivery: true } })
      );

      expect(handler).toHaveBeenCalledOnce();
      expect(handler.mock.calls[0][0].isRedelivery).toBe(true);
    });

    it("delivers a standby-mode event with the mode set", async () => {
      const handler = vi.fn();
      adapter.onLifecycleEvent(handler);

      await deliver(makeLifecycleEvent({ mode: "standby" }));

      expect(handler.mock.calls[0][0].mode).toBe("standby");
    });

    it("never routes a lifecycle event to the message handlers", async () => {
      adapter.onLifecycleEvent(vi.fn());

      await deliver(makeLifecycleEvent({ type: "unfollow" }));

      expect(mockChat.processMessage).not.toHaveBeenCalled();
      expect(mockChat.processAction).not.toHaveBeenCalled();
    });

    it("delivers lifecycle and message events from one payload", async () => {
      const handler = vi.fn();
      adapter.onLifecycleEvent(handler);

      const response = await deliver(
        makeLifecycleEvent({ type: "follow" }),
        makeEvent() as never
      );

      expect(response.status).toBe(200);
      expect(handler).toHaveBeenCalledOnce();
      expect(mockChat.processMessage).toHaveBeenCalledOnce();
    });

    it("gives the follow reply token to the reply-first path", async () => {
      adapter.onLifecycleEvent(vi.fn());
      mocks.replyMessage.mockResolvedValue({
        sentMessages: [{ id: "replied-1" }],
      });

      await deliver(makeLifecycleEvent({ replyToken: "follow-token" }));
      await adapter.postMessage("line:bot-123:user:u-123", "Welcome");

      expect(mocks.replyMessage).toHaveBeenCalledWith({
        messages: [{ text: "Welcome", type: "text" }],
        replyToken: "follow-token",
      });
    });

    it("keeps the follow reply token even with nothing listening", async () => {
      mocks.replyMessage.mockResolvedValue({
        sentMessages: [{ id: "replied-1" }],
      });

      await deliver(makeLifecycleEvent({ replyToken: "follow-token" }));
      await adapter.postMessage("line:bot-123:user:u-123", "Welcome");

      expect(mocks.replyMessage).toHaveBeenCalledWith({
        messages: [{ text: "Welcome", type: "text" }],
        replyToken: "follow-token",
      });
      expect(mocks.pushMessage).not.toHaveBeenCalled();
    });

    it("ignores a dummy reply token from the LINE console verifier", async () => {
      mocks.pushMessage.mockResolvedValue({
        sentMessages: [{ id: "pushed-1" }],
      });

      await deliver(
        makeLifecycleEvent({ replyToken: "00000000000000000000000000000000" })
      );
      await adapter.postMessage("line:bot-123:user:u-123", "Welcome");

      expect(mocks.replyMessage).not.toHaveBeenCalled();
      expect(mocks.pushMessage).toHaveBeenCalledOnce();
    });

    it("reaches every registered handler", async () => {
      const first = vi.fn();
      const second = vi.fn();
      adapter.onLifecycleEvent(first);
      adapter.onLifecycleEvent(second);

      await deliver(makeLifecycleEvent());

      expect(first).toHaveBeenCalledOnce();
      expect(second).toHaveBeenCalledOnce();
    });

    it("stops delivering once a handler unsubscribes", async () => {
      const handler = vi.fn();
      const stop = adapter.onLifecycleEvent(handler);

      await deliver(makeLifecycleEvent());
      stop();
      await deliver(makeLifecycleEvent());

      expect(handler).toHaveBeenCalledOnce();
    });

    it("keeps answering 200 when a handler throws", async () => {
      const failing = vi.fn(() => {
        throw new Error("handler exploded");
      });
      const healthy = vi.fn();
      adapter.onLifecycleEvent(failing);
      adapter.onLifecycleEvent(healthy);

      const response = await deliver(makeLifecycleEvent());

      expect(response.status).toBe(200);
      expect(healthy).toHaveBeenCalledOnce();
    });

    it("keeps answering 200 when a handler rejects", async () => {
      adapter.onLifecycleEvent(() => Promise.reject(new Error("nope")));

      const response = await deliver(makeLifecycleEvent());

      expect(response.status).toBe(200);
    });

    it.each([
      ["an unknown event type", { type: "videoPlayComplete" }],
      ["a missing source", { source: undefined }],
      ["a source with no ID", { source: { type: "user" } }],
      ["a missing webhookEventId", { webhookEventId: undefined }],
    ])("ignores a malformed event with %s", async (_label, overrides) => {
      const handler = vi.fn();
      adapter.onLifecycleEvent(handler);

      const response = await deliver(makeLifecycleEvent(overrides));

      expect(response.status).toBe(200);
      expect(handler).not.toHaveBeenCalled();
    });

    it("delivers to a handler on an adapter with no Chat instance", async () => {
      const standalone = new LineAdapter(validConfig);
      const handler = vi.fn();
      standalone.onLifecycleEvent(handler);

      const body = JSON.stringify({
        destination: "ch-dest",
        events: [makeLifecycleEvent({ type: "unfollow" })],
      });
      const response = await standalone.handleWebhook(
        makeRequest(body, generateSignature(body, validConfig.channelSecret))
      );

      expect(response.status).toBe(200);
      expect(handler).toHaveBeenCalledOnce();
      expect(handler.mock.calls[0][0].threadId).toBe("line:ch-dest:user:u-123");
    });

    it("still verifies the signature", async () => {
      const handler = vi.fn();
      adapter.onLifecycleEvent(handler);

      const body = JSON.stringify({
        destination: "ch-123",
        events: [makeLifecycleEvent()],
      });
      const response = await adapter.handleWebhook(
        makeRequest(body, generateSignature(body, "wrong-secret"))
      );

      expect(response.status).toBe(401);
      expect(handler).not.toHaveBeenCalled();
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

    it("exposes the sticker on a sticker message", () => {
      const event = makeEvent({
        message: {
          id: "stk-1",
          keywords: ["thanks"],
          packageId: "446",
          quoteToken: "qt-stk",
          stickerId: "1988",
          stickerResourceType: "STATIC",
          type: "sticker",
        },
      } as never);
      const message = adapter.parseMessage(event);

      expect(message.sticker).toEqual({
        keywords: ["thanks"],
        packageId: "446",
        resourceType: "STATIC",
        stickerId: "1988",
      });
      expect(message.quoteToken).toBe("qt-stk");
      expect(message.id).toBe("evt-1");
      expect(message.text).toBe("");
      expect(message.attachments).toHaveLength(0);
    });

    it("leaves the sticker unset on a malformed sticker event", () => {
      const event = makeEvent({
        message: { id: "stk-1", packageId: "446", type: "sticker" },
      } as never);

      expect(adapter.parseMessage(event).sticker).toBeUndefined();
    });

    it("leaves the sticker unset on a text message", () => {
      expect(adapter.parseMessage(makeEvent()).sticker).toBeUndefined();
    });

    it.each([
      ["group", { source: { groupId: "g-123", type: "group" as const } }],
      ["room", { source: { roomId: "r-123", type: "room" as const } }],
    ])("reads a sticker from a %s source", (_label, overrides) => {
      const event = makeEvent({
        message: {
          id: "stk-1",
          packageId: "446",
          stickerId: "1988",
          type: "sticker",
        },
        ...overrides,
      } as never);

      expect(adapter.parseMessage(event).sticker).toMatchObject({
        packageId: "446",
        stickerId: "1988",
      });
    });

    it("exposes the place on a location message", () => {
      const event = makeEvent({
        message: {
          address: "1-3 Kioicho, Chiyoda-ku, Tokyo, 102-8282, Japan",
          id: "loc-1",
          latitude: 35.679_66,
          longitude: 139.736_69,
          title: "my location",
          type: "location",
        },
      } as never);
      const message = adapter.parseMessage(event);

      expect(message.location).toEqual({
        address: "1-3 Kioicho, Chiyoda-ku, Tokyo, 102-8282, Japan",
        latitude: 35.679_66,
        longitude: 139.736_69,
        title: "my location",
      });
      expect(message.id).toBe("evt-1");
      expect(message.text).toBe("");
      expect(message.attachments).toHaveLength(0);
    });

    it("leaves the location unset on out-of-range coordinates", () => {
      const event = makeEvent({
        message: {
          id: "loc-1",
          latitude: 91,
          longitude: 139.736_69,
          type: "location",
        },
      } as never);

      expect(adapter.parseMessage(event).location).toBeUndefined();
    });

    it("leaves the location unset on a text message", () => {
      expect(adapter.parseMessage(makeEvent()).location).toBeUndefined();
    });

    it.each([
      ["group", { source: { groupId: "g-123", type: "group" as const } }],
      ["room", { source: { roomId: "r-123", type: "room" as const } }],
    ])("reads a location from a %s source", (_label, overrides) => {
      const event = makeEvent({
        message: {
          id: "loc-1",
          latitude: 35.679_66,
          longitude: 139.736_69,
          type: "location",
        },
        ...overrides,
      } as never);

      expect(adapter.parseMessage(event).location).toEqual({
        latitude: 35.679_66,
        longitude: 139.736_69,
      });
    });

    it("exposes native emoji on a text message", () => {
      const event = makeEvent({
        message: {
          emojis: [
            {
              emojiId: "001",
              index: 13,
              length: 6,
              productId: "5ac1bfd5040ab15980c9b435",
            },
          ],
          id: "msg-1",
          text: "Good morning (love)",
          type: "text",
        },
      } as never);
      const message = adapter.parseMessage(event);

      expect(message.emojis).toEqual([
        {
          emojiId: "001",
          index: 13,
          length: 6,
          productId: "5ac1bfd5040ab15980c9b435",
        },
      ]);
      expect(message.text).toBe("Good morning (love)");
    });

    it("drops a malformed emoji entry without losing the message", () => {
      const event = makeEvent({
        message: {
          emojis: [{ emojiId: "001", index: -1, length: 6, productId: "p" }],
          id: "msg-1",
          text: "Good morning (love)",
          type: "text",
        },
      } as never);
      const message = adapter.parseMessage(event);

      expect(message.emojis).toEqual([]);
      expect(message.text).toBe("Good morning (love)");
    });

    it("reports no emoji on a plain text message", () => {
      expect(adapter.parseMessage(makeEvent()).emojis).toEqual([]);
    });

    /** The message kinds LINE issues a quote token for. */
    const quotable = [
      ["text", { id: "msg-1", text: "hello", type: "text" }],
      ["image", { id: "img-1", type: "image" }],
      ["video", { id: "vid-1", type: "video" }],
      [
        "sticker",
        { id: "stk-1", packageId: "446", stickerId: "1988", type: "sticker" },
      ],
    ] as const;

    it.each(quotable)(
      "exposes the quoted message ID on a %s message",
      (_label, message) => {
        const event = makeEvent({
          message: {
            ...message,
            quoteToken: "qt-1",
            quotedMessageId: "468789532432007169",
          },
        } as never);
        const parsed = adapter.parseMessage(event);

        expect(parsed.quotedMessageId).toBe("468789532432007169");
        expect(parsed.quoteToken).toBe("qt-1");
      }
    );

    it.each(quotable)(
      "leaves it unset on an unquoted %s message",
      (_label, message) => {
        const event = makeEvent({
          message: { ...message, quoteToken: "qt-1" },
        } as never);
        const parsed = adapter.parseMessage(event);

        expect(parsed.quotedMessageId).toBeUndefined();
        expect(parsed.quoteToken).toBe("qt-1");
      }
    );

    it.each([
      ["an empty string", ""],
      ["a number", 468_789_532_432_007_200],
      ["null", null],
      ["an object", { id: "468789532432007169" }],
    ])("omits a quoted message ID that is %s", (_label, quotedMessageId) => {
      const event = makeEvent({
        message: {
          id: "msg-1",
          quoteToken: "qt-1",
          quotedMessageId,
          text: "hello",
          type: "text",
        },
      } as never);
      const parsed = adapter.parseMessage(event);

      expect(parsed.quotedMessageId).toBeUndefined();
      expect(parsed.text).toBe("hello");
      expect(parsed.id).toBe("evt-1");
    });

    it("keeps a quoted message ID on a message with no quote token", () => {
      const event = makeEvent({
        message: {
          id: "msg-1",
          quotedMessageId: "468789532432007169",
          text: "hello",
          type: "text",
        },
      } as never);
      const parsed = adapter.parseMessage(event);

      expect(parsed.quotedMessageId).toBe("468789532432007169");
      expect(parsed.quoteToken).toBeUndefined();
    });

    it("exposes media metadata alongside the attachment", () => {
      const event = makeEvent({
        message: {
          contentProvider: { type: "line" },
          duration: 60_000,
          id: "vid-1",
          type: "video",
        },
      } as never);
      const message = adapter.parseMessage(event);

      expect(message.media).toEqual({
        contentProvider: { type: "line" },
        duration: 60_000,
        kind: "video",
        providerMessageId: "vid-1",
      });
      expect(message.attachments).toHaveLength(1);
      expect(message.attachments[0]).toMatchObject({
        mimeType: "video/mp4",
        type: "video",
      });
    });

    it("names the attachment after the file LINE reported", () => {
      const event = makeEvent({
        message: {
          fileName: "report.pdf",
          fileSize: 138_024,
          id: "file-1",
          type: "file",
        },
      } as never);
      const message = adapter.parseMessage(event);

      expect(message.attachments[0]).toMatchObject({
        name: "report.pdf",
        size: 138_024,
        type: "file",
      });
    });

    it("falls back to a synthetic name when LINE reports none", () => {
      const event = makeEvent({
        message: { id: "img-1", type: "image" },
      } as never);
      const [attachment] = adapter.parseMessage(event).attachments;

      expect(attachment.name).toBe("image-img-1");
      expect(attachment.size).toBeUndefined();
      expect(attachment.url).toBeUndefined();
    });

    it("links the attachment to an externally hosted file", () => {
      const event = makeEvent({
        message: {
          contentProvider: {
            originalContentUrl: "https://example.com/original.jpg",
            previewImageUrl: "https://example.com/preview.jpg",
            type: "external",
          },
          id: "img-1",
          type: "image",
        },
      } as never);

      expect(adapter.parseMessage(event).attachments[0].url).toBe(
        "https://example.com/original.jpg"
      );
    });

    it("leaves the URL unset when LINE hosts the file itself", () => {
      const event = makeEvent({
        message: {
          contentProvider: { type: "line" },
          id: "img-1",
          type: "image",
        },
      } as never);

      expect(adapter.parseMessage(event).attachments[0].url).toBeUndefined();
    });

    it("still fetches content lazily through the LINE client", async () => {
      mocks.getMessageContent.mockResolvedValue(
        Readable.from([Buffer.from("file-bytes")])
      );
      const event = makeEvent({
        message: { fileName: "report.pdf", id: "file-1", type: "file" },
      } as never);
      const [attachment] = adapter.parseMessage(event).attachments;

      expect(mocks.getMessageContent).not.toHaveBeenCalled();

      const data = await attachment.fetchData?.();

      expect(mocks.getMessageContent).toHaveBeenCalledWith("file-1");
      expect(data?.toString()).toBe("file-bytes");
    });

    it("drops the attachment when a media message carries no ID", () => {
      const event = makeEvent({
        message: { id: "", type: "image" },
      } as never);
      const message = adapter.parseMessage(event);

      expect(message.attachments).toHaveLength(0);
      expect(message.media).toBeUndefined();
    });

    it("reports no media on a text message", () => {
      expect(adapter.parseMessage(makeEvent()).media).toBeUndefined();
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

    it("pushes a flex postable verbatim and returns the sent ID", async () => {
      const contents = {
        body: {
          contents: [{ text: "Hi", type: "text" }],
          layout: "vertical",
          type: "box",
        },
        type: "bubble",
      };

      const result = await adapter.postMessage("line:bot-123:user:u-123", {
        flex: { altText: "Bubble", contents },
      } as never);

      expect(mocks.pushMessage).toHaveBeenCalledWith({
        messages: [{ altText: "Bubble", contents, type: "flex" }],
        to: "u-123",
      });
      expect(result.id).toBe("sent-1");
    });

    it("rejects a flex postable with a blank altText before calling LINE", async () => {
      await expect(
        adapter.postMessage("line:bot-123:user:u-123", {
          flex: { altText: "  ", contents: { type: "bubble" } },
        } as never)
      ).rejects.toThrow(ValidationError);

      expect(mocks.pushMessage).not.toHaveBeenCalled();
    });

    it("propagates a provider failure on a flex send", async () => {
      mocks.pushMessage.mockRejectedValueOnce(new Error("LINE is down"));

      await expect(
        adapter.postMessage("line:bot-123:user:u-123", {
          flex: { altText: "Bubble", contents: { type: "bubble" } },
        } as never)
      ).rejects.toThrow("LINE is down");
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

    it("replies with a flex postable when a reply token is available", async () => {
      await seedReplyToken(adapter, { replyToken: "fresh-reply-token" });
      const contents = { contents: [], type: "carousel" };

      const result = await adapter.postMessage("line:bot-123:user:u-123", {
        flex: { altText: "Carousel", contents },
      } as never);

      expect(mocks.replyMessage).toHaveBeenCalledWith({
        messages: [{ altText: "Carousel", contents, type: "flex" }],
        replyToken: "fresh-reply-token",
      });
      expect(mocks.pushMessage).not.toHaveBeenCalled();
      expect(result.id).toBe("replied-1");
    });

    it("falls back to push for a flex postable when the reply token is rejected", async () => {
      await seedReplyToken(adapter, { replyToken: "stale-reply-token" });
      mocks.replyMessage.mockRejectedValueOnce(makeReplyTokenError());
      const contents = { type: "bubble" };

      const result = await adapter.postMessage("line:bot-123:user:u-123", {
        flex: { altText: "Bubble", contents },
      } as never);

      expect(mocks.pushMessage).toHaveBeenCalledWith({
        messages: [{ altText: "Bubble", contents, type: "flex" }],
        to: "u-123",
      });
      expect(result.id).toBe("pushed-1");
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

    const sticker = { packageId: "446", stickerId: "1988" };

    it("sends a native sticker message via push", async () => {
      const result = await adapter.postMessage("line:bot-123:user:u-123", {
        sticker,
      });

      expect(mocks.pushMessage).toHaveBeenCalledWith({
        messages: [{ packageId: "446", stickerId: "1988", type: "sticker" }],
        to: "u-123",
      });
      expect(result.id).toBe("pushed-1");
    });

    it("sends a native sticker message via reply when a token is available", async () => {
      await seedReplyToken(adapter, { replyToken: "fresh-reply-token" });

      const result = await adapter.postMessage("line:bot-123:user:u-123", {
        sticker,
      });

      expect(mocks.replyMessage).toHaveBeenCalledWith({
        messages: [{ ...sticker, type: "sticker" }],
        replyToken: "fresh-reply-token",
      });
      expect(mocks.pushMessage).not.toHaveBeenCalled();
      expect(result.id).toBe("replied-1");
    });

    it("falls back to push for a sticker when the reply token is rejected", async () => {
      await seedReplyToken(adapter, { replyToken: "stale-reply-token" });
      mocks.replyMessage.mockRejectedValueOnce(makeReplyTokenError());

      await adapter.postMessage("line:bot-123:user:u-123", { sticker });

      expect(mocks.pushMessage).toHaveBeenCalledWith({
        messages: [{ ...sticker, type: "sticker" }],
        to: "u-123",
      });
    });

    it("quotes an inbound sticker with a sticker", async () => {
      await adapter.postMessage("line:bot-123:user:u-123", {
        quoteToken: "qt-stk",
        sticker,
      });

      expect(mocks.pushMessage).toHaveBeenCalledWith({
        messages: [{ ...sticker, quoteToken: "qt-stk", type: "sticker" }],
        to: "u-123",
      });
    });

    it.each([
      ["a missing packageId", { stickerId: "1988" }],
      ["a missing stickerId", { packageId: "446" }],
      ["a non-decimal ID", { packageId: "446", stickerId: "cat" }],
      ["a sender-text resource type", { ...sticker, resourceType: "MESSAGE" }],
      ["a non-string resource type", { ...sticker, resourceType: 42 }],
    ])("rejects a sticker with %s before calling LINE", async (_label, bad) => {
      await expect(
        adapter.postMessage("line:bot-123:user:u-123", {
          sticker: bad,
        } as never)
      ).rejects.toBeInstanceOf(ValidationError);

      expect(mocks.pushMessage).not.toHaveBeenCalled();
      expect(mocks.replyMessage).not.toHaveBeenCalled();
    });

    it("propagates provider failures for sticker sends", async () => {
      mocks.pushMessage.mockRejectedValueOnce(new Error("LINE is down"));

      await expect(
        adapter.postMessage("line:bot-123:user:u-123", { sticker })
      ).rejects.toThrow("LINE is down");
    });

    const location = {
      address: "1-3 Kioicho, Chiyoda-ku, Tokyo, 102-8282, Japan",
      latitude: 35.679_66,
      longitude: 139.736_69,
      title: "my location",
    };

    it("sends a native location message via push", async () => {
      const result = await adapter.postMessage("line:bot-123:user:u-123", {
        location,
      });

      expect(mocks.pushMessage).toHaveBeenCalledWith({
        messages: [{ ...location, type: "location" }],
        to: "u-123",
      });
      expect(result.id).toBe("pushed-1");
    });

    it("sends a native location message via reply when a token is available", async () => {
      await seedReplyToken(adapter, { replyToken: "fresh-reply-token" });

      const result = await adapter.postMessage("line:bot-123:user:u-123", {
        location,
      });

      expect(mocks.replyMessage).toHaveBeenCalledWith({
        messages: [{ ...location, type: "location" }],
        replyToken: "fresh-reply-token",
      });
      expect(mocks.pushMessage).not.toHaveBeenCalled();
      expect(result.id).toBe("replied-1");
    });

    it("falls back to push for a location when the reply token is rejected", async () => {
      await seedReplyToken(adapter, { replyToken: "stale-reply-token" });
      mocks.replyMessage.mockRejectedValueOnce(makeReplyTokenError());

      await adapter.postMessage("line:bot-123:user:u-123", { location });

      expect(mocks.pushMessage).toHaveBeenCalledWith({
        messages: [{ ...location, type: "location" }],
        to: "u-123",
      });
    });

    it.each([
      ["an empty title", { ...location, title: "" }],
      ["a missing address", { ...location, address: undefined }],
      ["a latitude past the pole", { ...location, latitude: 91 }],
      ["a longitude past the antimeridian", { ...location, longitude: 181 }],
      ["a NaN latitude", { ...location, latitude: Number.NaN }],
    ])(
      "rejects a location with %s before calling LINE",
      async (_label, bad) => {
        await expect(
          adapter.postMessage("line:bot-123:user:u-123", {
            location: bad,
          } as never)
        ).rejects.toBeInstanceOf(ValidationError);

        expect(mocks.pushMessage).not.toHaveBeenCalled();
        expect(mocks.replyMessage).not.toHaveBeenCalled();
      }
    );

    it("rejects a quote token on a location send before calling LINE", async () => {
      await expect(
        adapter.postMessage("line:bot-123:user:u-123", {
          location,
          quoteToken: "qt-1",
        } as never)
      ).rejects.toBeInstanceOf(ValidationError);

      expect(mocks.pushMessage).not.toHaveBeenCalled();
    });

    it("propagates provider failures for location sends", async () => {
      mocks.pushMessage.mockRejectedValueOnce(new Error("LINE is down"));

      await expect(
        adapter.postMessage("line:bot-123:user:u-123", { location })
      ).rejects.toThrow("LINE is down");
    });

    it("maps a 429 on a location send to AdapterRateLimitError", async () => {
      mocks.pushMessage.mockRejectedValueOnce(makeRateLimitError(3));

      await expect(
        adapter.postMessage("line:bot-123:user:u-123", { location })
      ).rejects.toBeInstanceOf(AdapterRateLimitError);
    });

    const emojis = [
      { emojiId: "001", index: 6, productId: "5ac1bfd5040ab15980c9b435" },
    ];

    it("sends emoji as a textV2 message via push", async () => {
      await adapter.postMessage("line:bot-123:user:u-123", {
        emojis,
        text: "Hello $",
      });

      expect(mocks.pushMessage).toHaveBeenCalledWith({
        messages: [
          {
            substitution: {
              emoji0: {
                emojiId: "001",
                productId: "5ac1bfd5040ab15980c9b435",
                type: "emoji",
              },
            },
            text: "Hello {emoji0}",
            type: "textV2",
          },
        ],
        to: "u-123",
      });
    });

    it("sends emoji to a 1:1 chat, where only mentions are barred", async () => {
      await adapter.postMessage("line:bot-123:user:u-123", {
        emojis,
        text: "Hello $",
      });

      expect(mocks.pushMessage).toHaveBeenCalledOnce();

      await expect(
        adapter.postMessage("line:bot-123:user:u-123", {
          emojis: [
            { emojiId: "001", index: 7, productId: "5ac1bfd5040ab15980c9b435" },
          ],
          mentions: [{ index: 0, length: 6, userId: "U1" }],
          text: "@Alice $",
        })
      ).rejects.toThrow(/1:1 chats/);
    });

    it("sends emoji via reply when a token is available", async () => {
      await seedReplyToken(adapter, { replyToken: "fresh-reply-token" });

      await adapter.postMessage("line:bot-123:user:u-123", {
        emojis,
        text: "Hello $",
      });

      expect(mocks.replyMessage).toHaveBeenCalledWith({
        messages: [expect.objectContaining({ type: "textV2" })],
        replyToken: "fresh-reply-token",
      });
      expect(mocks.pushMessage).not.toHaveBeenCalled();
    });

    it("falls back to push for emoji when the reply token is rejected", async () => {
      await seedReplyToken(adapter, { replyToken: "stale-reply-token" });
      mocks.replyMessage.mockRejectedValueOnce(makeReplyTokenError());

      await adapter.postMessage("line:bot-123:user:u-123", {
        emojis,
        text: "Hello $",
      });

      expect(mocks.pushMessage).toHaveBeenCalledWith({
        messages: [expect.objectContaining({ type: "textV2" })],
        to: "u-123",
      });
    });

    it("rejects an emoji that does not line up with a $ before calling LINE", async () => {
      await expect(
        adapter.postMessage("line:bot-123:user:u-123", {
          emojis,
          text: "Hello there",
        })
      ).rejects.toBeInstanceOf(ValidationError);

      expect(mocks.pushMessage).not.toHaveBeenCalled();
      expect(mocks.replyMessage).not.toHaveBeenCalled();
    });

    it("broadcasts emoji, which LINE renders outside a reply", async () => {
      mocks.broadcastWithHttpInfo.mockResolvedValue(acceptedResponse("req-1"));

      await adapter.broadcastMessages({ emojis, text: "Hello $" });

      expect(mocks.broadcastWithHttpInfo).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: [expect.objectContaining({ type: "textV2" })],
        }),
        undefined
      );
    });

    const media = {
      originalContentUrl: "https://example.com/original.mp4",
      previewImageUrl: "https://example.com/preview.jpg",
    };

    it.each(["image", "video"] as const)(
      "sends a native %s message via push",
      async (type) => {
        const result = await adapter.postMessage("line:bot-123:user:u-123", {
          [type]: media,
        } as never);

        expect(mocks.pushMessage).toHaveBeenCalledWith({
          messages: [{ ...media, type }],
          to: "u-123",
        });
        expect(result.id).toBe("pushed-1");
      }
    );

    it.each(["image", "video"] as const)(
      "sends a native %s message via reply when a token is available",
      async (type) => {
        await seedReplyToken(adapter, { replyToken: "fresh-reply-token" });

        await adapter.postMessage("line:bot-123:user:u-123", {
          [type]: media,
        } as never);

        expect(mocks.replyMessage).toHaveBeenCalledWith({
          messages: [{ ...media, type }],
          replyToken: "fresh-reply-token",
        });
        expect(mocks.pushMessage).not.toHaveBeenCalled();
      }
    );

    it("falls back to push for an image when the reply token is rejected", async () => {
      await seedReplyToken(adapter, { replyToken: "stale-reply-token" });
      mocks.replyMessage.mockRejectedValueOnce(makeReplyTokenError());

      await adapter.postMessage("line:bot-123:user:u-123", { image: media });

      expect(mocks.pushMessage).toHaveBeenCalledWith({
        messages: [{ ...media, type: "image" }],
        to: "u-123",
      });
    });

    it.each([
      [
        "a missing previewImageUrl",
        { originalContentUrl: media.originalContentUrl },
      ],
      [
        "an http URL",
        { ...media, originalContentUrl: "http://example.com/o.mp4" },
      ],
      ["an empty URL", { ...media, previewImageUrl: "" }],
      ["a non-object", "https://example.com/o.mp4"],
    ])("rejects a video with %s before calling LINE", async (_label, bad) => {
      await expect(
        adapter.postMessage("line:bot-123:user:u-123", { video: bad } as never)
      ).rejects.toBeInstanceOf(ValidationError);

      expect(mocks.pushMessage).not.toHaveBeenCalled();
      expect(mocks.replyMessage).not.toHaveBeenCalled();
    });

    it("propagates provider failures for image sends", async () => {
      mocks.pushMessage.mockRejectedValueOnce(new Error("LINE is down"));

      await expect(
        adapter.postMessage("line:bot-123:user:u-123", { image: media })
      ).rejects.toThrow("LINE is down");
    });

    it("maps a 429 on a video send to AdapterRateLimitError", async () => {
      mocks.pushMessage.mockRejectedValueOnce(makeRateLimitError(3));

      await expect(
        adapter.postMessage("line:bot-123:user:u-123", { video: media })
      ).rejects.toBeInstanceOf(AdapterRateLimitError);
    });

    it.each(["image", "video"] as const)(
      "broadcasts and multicasts a %s postable",
      async (type) => {
        mocks.broadcastWithHttpInfo.mockResolvedValue(
          acceptedResponse("req-1")
        );
        mocks.multicastWithHttpInfo.mockResolvedValue(
          acceptedResponse("req-2")
        );

        await adapter.broadcastMessages({ [type]: media } as never);
        await adapter.multicastMessages(["U1234567890abcdef1234567890abcdef"], {
          [type]: media,
        } as never);

        expect(mocks.broadcastWithHttpInfo).toHaveBeenCalledWith(
          expect.objectContaining({ messages: [{ ...media, type }] }),
          undefined
        );
        expect(mocks.multicastWithHttpInfo).toHaveBeenCalledWith(
          expect.objectContaining({ messages: [{ ...media, type }] }),
          undefined
        );
      }
    );

    it("rejects a text over 5000 characters before calling LINE", async () => {
      await expect(
        adapter.postMessage("line:bot-123:user:u-123", "a".repeat(5001))
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
