/* eslint-disable max-classes-per-file */
import crypto from "node:crypto";
import { readFileSync } from "node:fs";

import { createMemoryState } from "@chat-adapter/state-memory";
import { Chat } from "chat";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { createLineAdapter } from "../src/index.js";
import { isRecord } from "../src/lib/is-record.js";
import type {
  LineEvent,
  LineLifecycleRawEvent,
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

const FIRST_CHAT_VERSION_WITH_HISTORY = { major: 4, minor: 20 };

const readInstalledChatVersion = (): string => {
  const manifest: unknown = JSON.parse(
    readFileSync(
      new URL("../node_modules/chat/package.json", import.meta.url),
      "utf-8"
    )
  );
  if (!isRecord(manifest) || typeof manifest.version !== "string") {
    throw new Error("Could not read the installed chat version");
  }
  return manifest.version;
};

const chatKeepsThreadHistory = (): boolean => {
  const [major = 0, minor = 0] = readInstalledChatVersion()
    .split(".")
    .map(Number);
  return (
    major > FIRST_CHAT_VERSION_WITH_HISTORY.major ||
    (major === FIRST_CHAT_VERSION_WITH_HISTORY.major &&
      minor >= FIRST_CHAT_VERSION_WITH_HISTORY.minor)
  );
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

const GROUP_CHANNEL_ID = `line:${BOT_USER_ID}:group:${GROUP_ID}`;
const NEWCOMER_ID = "Unewcomer000000000000000000000000";
const SECOND_NEWCOMER_ID = "Usecond0000000000000000000000000000";

const makeLifecycleEvent = (
  overrides: Partial<LineLifecycleRawEvent> &
    Pick<LineLifecycleRawEvent, "type">
): LineLifecycleRawEvent => {
  const number = nextEventNumber();
  return {
    deliveryContext: { isRedelivery: false },
    mode: "active",
    replyToken: `reply-token-${number}`,
    source: { groupId: GROUP_ID, type: "group" },
    timestamp: Date.now(),
    webhookEventId: `event-${number}`,
    ...overrides,
  };
};

const makeMemberJoinedEvent = (
  userIds: (string | undefined)[],
  overrides: Partial<LineLifecycleRawEvent> = {}
): LineLifecycleRawEvent =>
  makeLifecycleEvent({
    joined: {
      members: userIds.map((userId) => ({ type: "user", userId })),
    },
    type: "memberJoined",
    ...overrides,
  });

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
  events: (LineEvent | LineLifecycleRawEvent)[],
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

  it("sends a post longer than LINE's text limit as several messages in one reply", async () => {
    const words = Array.from({ length: 2400 }, (_, index) => `w${index}`);
    bot.onNewMention(async (thread) => {
      await thread.post({ markdown: words.join(" ") });
    });
    const event = makeGroupTextEvent(`${BOT_MENTION} summarize`, botMention);

    await postWebhook([event]);

    expect(mocks.replyMessage).toHaveBeenCalledTimes(1);
    const [[{ messages, replyToken }]] = mocks.replyMessage.mock.calls;
    const texts = messages.map((message: { text: string }) => message.text);
    expect(replyToken).toBe(event.replyToken);
    expect(texts).toHaveLength(3);
    expect(texts.every((text: string) => text.length <= 5000)).toBe(true);
    expect(texts.join(" ")).toBe(words.join(" "));
    expect(mocks.pushMessage).not.toHaveBeenCalled();
  });

  it("lets a handler read thread history without an error", async () => {
    const outcomes: string[] = [];
    bot.onNewMention(async (thread) => {
      try {
        await thread.refresh();
        for await (const message of thread.messages) {
          outcomes.push(`saw ${message.id}`);
        }
        outcomes.push("read history");
      } catch (error) {
        outcomes.push(`failed: ${String(error)}`);
      }
    });

    await postWebhook([makeGroupTextEvent(`${BOT_MENTION} hello`, botMention)]);

    expect(outcomes.at(-1)).toBe("read history");
  });

  it.runIf(chatKeepsThreadHistory())(
    "serves earlier group messages, including the bot's own reply, from the history the SDK kept",
    async () => {
      const firstText = `${BOT_MENTION} join us`;
      const followUpText = "a follow-up with no mention";
      const seen: { messages: string[]; recent: string[] }[] = [];
      bot.onNewMention(async (thread) => {
        await thread.subscribe();
        await thread.post("welcome");
      });
      bot.onSubscribedMessage(async (thread) => {
        await thread.refresh();
        const messages: string[] = [];
        for await (const message of thread.messages) {
          messages.push(message.text);
        }
        seen.push({
          messages,
          recent: thread.recentMessages.map((message) => message.text),
        });
      });

      await postWebhook([makeGroupTextEvent(firstText, botMention)]);
      await postWebhook([makeGroupTextEvent(followUpText)]);

      expect(seen).toEqual([
        {
          messages: [followUpText, "welcome", firstText],
          recent: [firstText, "welcome", followUpText],
        },
      ]);
    }
  );
  describe("onMemberJoinedChannel", () => {
    it("fires once per joined member and welcomes them over the free reply", async () => {
      const joined: { channelId: string; userId: string }[] = [];
      bot.onMemberJoinedChannel(async (event) => {
        joined.push({ channelId: event.channelId, userId: event.userId });
        await bot.channel(event.channelId).post("Welcome!");
      });
      const event = makeMemberJoinedEvent([NEWCOMER_ID, SECOND_NEWCOMER_ID]);

      const response = await postWebhook([event]);

      expect(response.status).toBe(200);
      expect(joined).toEqual([
        { channelId: GROUP_CHANNEL_ID, userId: NEWCOMER_ID },
        { channelId: GROUP_CHANNEL_ID, userId: SECOND_NEWCOMER_ID },
      ]);
      expect(mocks.replyMessage).toHaveBeenCalledTimes(1);
      expect(mocks.replyMessage).toHaveBeenCalledWith({
        messages: [{ text: "Welcome!", type: "text" }],
        replyToken: event.replyToken,
      });
      expect(mocks.pushMessage).toHaveBeenCalledTimes(1);
    });

    it("skips a joined member LINE did not identify", async () => {
      const joined: string[] = [];
      bot.onMemberJoinedChannel((event) => {
        joined.push(event.userId);
      });

      await postWebhook([makeMemberJoinedEvent([undefined, NEWCOMER_ID])]);

      expect(joined).toEqual([NEWCOMER_ID]);
    });

    it("fires once with the bot's own ID when the bot joins a group", async () => {
      const joined: { channelId: string; userId: string }[] = [];
      let inviterId: string | undefined = "unset";
      bot.onMemberJoinedChannel(async (event) => {
        joined.push({ channelId: event.channelId, userId: event.userId });
        ({ inviterId } = event);
        await bot.channel(event.channelId).post("Thanks for adding me");
      });
      const event = makeLifecycleEvent({ type: "join" });

      await postWebhook([event]);

      expect(joined).toEqual([
        { channelId: GROUP_CHANNEL_ID, userId: BOT_USER_ID },
      ]);
      expect(inviterId).toBeUndefined();
      expect(mocks.replyMessage).toHaveBeenCalledWith({
        messages: [{ text: "Thanks for adding me", type: "text" }],
        replyToken: event.replyToken,
      });
    });

    it("lets a handler tell the bot's own join from a person's", async () => {
      const people: string[] = [];
      bot.onMemberJoinedChannel((event) => {
        if (event.userId !== event.adapter.botUserId) {
          people.push(event.userId);
        }
      });

      await postWebhook([
        makeLifecycleEvent({ type: "join" }),
        makeMemberJoinedEvent([NEWCOMER_ID]),
      ]);

      expect(people).toEqual([NEWCOMER_ID]);
    });

    it.each([
      ["a redelivered event", { deliveryContext: { isRedelivery: true } }],
      ["a standby-mode event", { mode: "standby" as const }],
    ])("fires nothing for %s", async (_name, overrides) => {
      const joined: string[] = [];
      bot.onMemberJoinedChannel((event) => {
        joined.push(event.userId);
      });

      await postWebhook([
        makeMemberJoinedEvent([NEWCOMER_ID], overrides),
        makeLifecycleEvent({ type: "join", ...overrides }),
      ]);

      expect(joined).toEqual([]);
    });

    it("fires nothing for LINE's webhook verification token", async () => {
      const joined: string[] = [];
      bot.onMemberJoinedChannel((event) => {
        joined.push(event.userId);
      });

      await postWebhook([
        makeMemberJoinedEvent([NEWCOMER_ID], {
          replyToken: "00000000000000000000000000000000",
        }),
      ]);

      expect(joined).toEqual([]);
    });

    it("fires nothing for events that are not joins", async () => {
      const joined: string[] = [];
      bot.onMemberJoinedChannel((event) => {
        joined.push(event.userId);
      });

      await postWebhook([
        makeLifecycleEvent({ replyToken: undefined, type: "leave" }),
        makeLifecycleEvent({
          left: { members: [{ type: "user", userId: NEWCOMER_ID }] },
          replyToken: undefined,
          type: "memberLeft",
        }),
        makeLifecycleEvent({
          source: { type: "user", userId: SENDER_ID },
          type: "follow",
        }),
      ]);

      expect(joined).toEqual([]);
    });

    it("keeps onLifecycleEvent delivering redelivered and standby events", async () => {
      const seen: string[] = [];
      const adapter = bot.getAdapter("line");
      adapter.onLifecycleEvent((event) => {
        seen.push(`${event.type}:${event.mode}:${event.isRedelivery}`);
      });
      bot.onMemberJoinedChannel(() => {});

      await postWebhook([
        makeMemberJoinedEvent([NEWCOMER_ID]),
        makeMemberJoinedEvent([NEWCOMER_ID], {
          deliveryContext: { isRedelivery: true },
        }),
        makeLifecycleEvent({ mode: "standby", type: "join" }),
      ]);

      expect(seen).toEqual([
        "memberJoined:active:false",
        "memberJoined:active:true",
        "join:standby:false",
      ]);
    });
  });
});
