import crypto from "node:crypto";

import { ValidationError } from "@chat-adapter/shared";
import { LineBotClient } from "@line/bot-sdk";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vite-plus/test";

import { createLineAdapter } from "../src/index.js";
import type { LineAdapter } from "../src/index.js";

vi.mock("@line/bot-sdk", () => ({
  LineBotClient: {
    fromChannelAccessToken: vi.fn(() => ({})),
  },
}));

/** The status a webhook signed with `secret` gets from `adapter`. */
const webhookStatus = async (
  adapter: LineAdapter,
  secret: string
): Promise<number> => {
  const body = JSON.stringify({ destination: "Ubot", events: [] });
  const signature = crypto
    .createHmac("SHA256", secret)
    .update(body)
    .digest("base64");
  const response = await adapter.handleWebhook(
    new Request("https://example.com/webhook", {
      body,
      headers: { "x-line-signature": signature },
      method: "POST",
    })
  );
  return response.status;
};

const createAdapterWithEmptySecret = () =>
  createLineAdapter({
    channelAccessToken: "test-token",
    channelSecret: "",
  });

describe("createLineAdapter", () => {
  // Credentials exported in the shell running the tests must not leak in.
  // The factory treats an empty variable as unset.
  beforeEach(() => {
    vi.stubEnv("LINE_CHANNEL_ACCESS_TOKEN", "");
    vi.stubEnv("LINE_CHANNEL_SECRET", "");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("creates adapter with explicit config", () => {
    const adapter = createLineAdapter({
      channelAccessToken: "test-token",
      channelSecret: "test-secret",
    });

    expect(adapter.name).toBe("line");
  });

  it("creates adapter with optional userName", () => {
    const adapter = createLineAdapter({
      channelAccessToken: "test-token",
      channelSecret: "test-secret",
      userName: "my-bot",
    });

    expect(adapter.userName).toBe("my-bot");
  });

  it("throws ValidationError when channelAccessToken is missing", () => {
    expect(() =>
      createLineAdapter({
        channelSecret: "test-secret",
      })
    ).toThrow(ValidationError);

    expect(() =>
      createLineAdapter({
        channelSecret: "test-secret",
      })
    ).toThrow("channelAccessToken");
  });

  it("throws ValidationError when channelSecret is missing", () => {
    expect(() =>
      createLineAdapter({
        channelAccessToken: "test-token",
      })
    ).toThrow(ValidationError);

    expect(() =>
      createLineAdapter({
        channelAccessToken: "test-token",
      })
    ).toThrow("channelSecret");
  });

  it("throws ValidationError when both are missing", () => {
    expect(() => createLineAdapter({})).toThrow(ValidationError);
    expect(() => createLineAdapter({})).toThrow("channelAccessToken");
    expect(() => createLineAdapter({})).toThrow("channelSecret");
  });

  it("throws ValidationError when called with no config and no env vars", () => {
    expect(() => createLineAdapter()).toThrow(ValidationError);
  });

  it("reads channelAccessToken from env var", () => {
    vi.stubEnv("LINE_CHANNEL_ACCESS_TOKEN", "env-token");
    vi.stubEnv("LINE_CHANNEL_SECRET", "env-secret");

    createLineAdapter();

    expect(LineBotClient.fromChannelAccessToken).toHaveBeenLastCalledWith({
      channelAccessToken: "env-token",
    });
  });

  it("reads channelSecret from env var", async () => {
    vi.stubEnv("LINE_CHANNEL_ACCESS_TOKEN", "env-token");
    vi.stubEnv("LINE_CHANNEL_SECRET", "env-secret");

    const adapter = createLineAdapter();

    await expect(webhookStatus(adapter, "env-secret")).resolves.toBe(200);
    await expect(webhookStatus(adapter, "other-secret")).resolves.toBe(401);
  });

  it("prefers explicit config over env vars", async () => {
    vi.stubEnv("LINE_CHANNEL_ACCESS_TOKEN", "env-token");
    vi.stubEnv("LINE_CHANNEL_SECRET", "env-secret");

    const adapter = createLineAdapter({
      channelAccessToken: "explicit-token",
      channelSecret: "explicit-secret",
    });

    expect(LineBotClient.fromChannelAccessToken).toHaveBeenLastCalledWith({
      channelAccessToken: "explicit-token",
    });
    await expect(webhookStatus(adapter, "explicit-secret")).resolves.toBe(200);
    await expect(webhookStatus(adapter, "env-secret")).resolves.toBe(401);
  });

  it("throws when only channelAccessToken is in env", () => {
    vi.stubEnv("LINE_CHANNEL_ACCESS_TOKEN", "env-token");

    expect(() => createLineAdapter()).toThrow(ValidationError);
    expect(() => createLineAdapter()).toThrow("channelSecret");
  });

  it("throws when only channelSecret is in env", () => {
    vi.stubEnv("LINE_CHANNEL_SECRET", "env-secret");

    expect(() => createLineAdapter()).toThrow(ValidationError);
    expect(() => createLineAdapter()).toThrow("channelAccessToken");
  });

  it("throws when explicit config has empty strings", () => {
    expect(() =>
      createLineAdapter({
        channelAccessToken: "",
        channelSecret: "test-secret",
      })
    ).toThrow(ValidationError);

    expect(() => createAdapterWithEmptySecret()).toThrow(ValidationError);
  });

  it("exports LineAdapter and LineFormatConverter", async () => {
    const { LineAdapter, LineFormatConverter } =
      await import("../src/index.js");
    expect(LineAdapter).toBeDefined();
    expect(LineFormatConverter).toBeDefined();
  });

  it("exports utility functions", async () => {
    const { decodeThreadId, encodeThreadId, isDM, toPlainText } =
      await import("../src/index.js");
    expect(decodeThreadId).toBeDefined();
    expect(encodeThreadId).toBeDefined();
    expect(isDM).toBeDefined();
    expect(toPlainText).toBeDefined();
  });
});
