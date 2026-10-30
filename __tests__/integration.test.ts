/* eslint-disable max-classes-per-file */
import crypto from "node:crypto";

import { createMemoryState } from "@chat-adapter/state-memory";
import { Chat } from "chat";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { createLineAdapter } from "../src/index.js";
import type {
  LineEvent,
  LineMessageEvent,
  LinePostbackEvent,
} from "../src/types.js";

const mocks = vi.hoisted(() => {
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

  return {
    HTTPFetchError,
    getBotInfo: vi.fn(),
    pushMessage: vi.fn(),
    replyMessage: vi.fn(),
    showLoadingAnimation: vi.fn(),
  };
});

vi.mock("@line/bot-sdk", () => {
  class MockLineBotClient {
    getBotInfo = mocks.getBotInfo;
    pushMessage = mocks.pushMessage;
    replyMessage = mocks.replyMessage;
    showLoadingAnimation = mocks.showLoadingAnimation;

    static fromChannelAccessToken = () => new MockLineBotClient();
  }

  return {
    HTTPFetchError: mocks.HTTPFetchError,
    LineBotClient: MockLineBotClient,
  };
});

const CHANNEL_SECRET = "test-secret";
const BOT_USER_ID = "Ubot00000000000000000000000000000";
const GROUP_ID = "Cgroup0000000000000000000000000000";
const SENDER_ID = "Usender000000000000000000000000000";
const BOT_MENTION = "@linebot";

const botMention: NonNullable<LineMessageEvent["message"]["mention"]> = {
  mentionees: [
    {
      index: 0,
      isSelf: true,
      length: BOT_MENTION.length,
      type: "user",
      userId: BOT_USER_ID,
    },
  ],
};

let eventCount = 0;

const nextEventNumber = (): number => {
  eventCount += 1;
  return eventCount;
};

const makeGroupTextEvent = (
  text: string,
  mention?: LineMessageEvent["message"]["mention"]
): LineMessageEvent => {
  const number = nextEventNumber();
  return {
    deliveryContext: { isRedelivery: false },
    message: { id: `msg-${number}`, mention, text, type: "text" },
    mode: "active",
    replyToken: `reply-token-${number}`,
    source: { groupId: GROUP_ID, type: "group", userId: SENDER_ID },
    timestamp: Date.now(),
    type: "message",
    webhookEventId: `event-${number}`,
  };
};

const makePostbackEvent = (data: string): LinePostbackEvent => {
  const number = nextEventNumber();
  return {
    deliveryContext: { isRedelivery: false },
    mode: "active",
    postback: { data },
    replyToken: `reply-token-${number}`,
    source: { type: "user", userId: SENDER_ID },
    timestamp: Date.now(),
    type: "postback",
    webhookEventId: `event-${number}`,
  };
};

const createBot = () =>
  new Chat({
    adapters: {
      line: createLineAdapter({
        channelAccessToken: "test-token",
        channelSecret: CHANNEL_SECRET,
      }),
    },
    logger: "error",
    state: createMemoryState(),
    userName: "linebot",
  });

let bot: ReturnType<typeof createBot>;

const sign = (body: string, secret: string): string =>
  crypto.createHmac("SHA256", secret).update(body).digest("base64");

// Chat runs handlers after the webhook has answered, so wait for them before
// the caller asserts on what they did.
const postWebhook = async (
  events: LineEvent[],
  signingSecret = CHANNEL_SECRET
): Promise<Response> => {
  const body = JSON.stringify({ destination: BOT_USER_ID, events });
  const pending: Promise<unknown>[] = [];

  const response = await bot.webhooks.line(
    new Request("https://example.com/webhook/line", {
      body,
      headers: {
        "content-type": "application/json",
        "x-line-signature": sign(body, signingSecret),
      },
      method: "POST",
    }),
    {
      waitUntil: (task) => {
        pending.push(task);
      },
    }
  );

  await Promise.all(pending);
  return response;
};

describe("LINE adapter inside a real Chat", () => {
  beforeEach(() => {
    mocks.getBotInfo.mockReset().mockResolvedValue({ userId: BOT_USER_ID });
    mocks.pushMessage
      .mockReset()
      .mockResolvedValue({ sentMessages: [{ id: "sent-1" }] });
    mocks.replyMessage
      .mockReset()
      .mockResolvedValue({ sentMessages: [{ id: "sent-1" }] });
    mocks.showLoadingAnimation.mockReset().mockResolvedValue({});
    bot = createBot();
  });

  it("replies to a group mention with that event's reply token", async () => {
    const mentioned: string[] = [];
    bot.onNewMention(async (thread, message) => {
      mentioned.push(message.text);
      await thread.post("hi");
    });
    const event = makeGroupTextEvent(`${BOT_MENTION} hello`, botMention);

    const response = await postWebhook([event]);

    expect(response.status).toBe(200);
    expect(mentioned).toEqual([`${BOT_MENTION} hello`]);
    expect(mocks.replyMessage).toHaveBeenCalledTimes(1);
    expect(mocks.replyMessage).toHaveBeenCalledWith({
      messages: [{ text: "hi", type: "text" }],
      replyToken: event.replyToken,
    });
    expect(mocks.pushMessage).not.toHaveBeenCalled();
  });

  it("routes an unmentioned message in a subscribed group to onSubscribedMessage", async () => {
    const mentioned: string[] = [];
    const subscribed: string[] = [];
    bot.onNewMention(async (thread, message) => {
      mentioned.push(message.text);
      await thread.subscribe();
    });
    bot.onSubscribedMessage((_thread, message) => {
      subscribed.push(message.text);
    });

    await postWebhook([
      makeGroupTextEvent(`${BOT_MENTION} join us`, botMention),
    ]);
    await postWebhook([makeGroupTextEvent("a follow-up with no mention")]);

    expect(mentioned).toEqual([`${BOT_MENTION} join us`]);
    expect(subscribed).toEqual(["a follow-up with no mention"]);
  });

  it("pushes to the group once the reply token is spent", async () => {
    bot.onNewMention(async (thread) => {
      await thread.post("first");
      await thread.post("second");
    });
    const event = makeGroupTextEvent(`${BOT_MENTION} hello`, botMention);

    await postWebhook([event]);

    expect(mocks.replyMessage).toHaveBeenCalledTimes(1);
    expect(mocks.replyMessage).toHaveBeenCalledWith({
      messages: [{ text: "first", type: "text" }],
      replyToken: event.replyToken,
    });
    expect(mocks.pushMessage).toHaveBeenCalledTimes(1);
    expect(mocks.pushMessage).toHaveBeenCalledWith({
      messages: [{ text: "second", type: "text" }],
      to: GROUP_ID,
    });
  });

  it("routes a postback to onAction with its action ID and value", async () => {
    const actions: {
      actionId: string;
      userId: string;
      value: string | undefined;
    }[] = [];
    bot.onAction("approve", (event) => {
      actions.push({
        actionId: event.actionId,
        userId: event.user.userId,
        value: event.value,
      });
    });

    await postWebhook([makePostbackEvent("id=approve&v=yes")]);

    expect(actions).toEqual([
      { actionId: "approve", userId: SENDER_ID, value: "yes" },
    ]);
  });

  it("answers 401 to a bad signature and runs no handler, then accepts the same event once signed correctly", async () => {
    const mentioned: string[] = [];
    bot.onNewMention(async (thread, message) => {
      mentioned.push(message.text);
      await thread.post("hi");
    });
    const event = makeGroupTextEvent(`${BOT_MENTION} hello`, botMention);

    const rejected = await postWebhook([event], "not-the-channel-secret");

    expect(rejected.status).toBe(401);
    expect(mentioned).toEqual([]);
    expect(mocks.replyMessage).not.toHaveBeenCalled();

    const accepted = await postWebhook([event]);

    expect(accepted.status).toBe(200);
    expect(mentioned).toEqual([`${BOT_MENTION} hello`]);
    expect(mocks.replyMessage).toHaveBeenCalledTimes(1);
  });
});
