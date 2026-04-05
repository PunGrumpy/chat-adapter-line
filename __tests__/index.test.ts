import { ValidationError } from "@chat-adapter/shared";
import { describe, expect, it, vi } from "vite-plus/test";

import { createLineAdapter } from "../src/index.js";

vi.mock("@line/bot-sdk", () => ({
  LineBotClient: {
    fromChannelAccessToken: vi.fn(() => ({})),
  },
}));

const createAdapterWithEmptySecret = () =>
  createLineAdapter({
    channelAccessToken: "test-token",
    channelSecret: "",
  });

describe("createLineAdapter", () => {
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

    const adapter = createLineAdapter();
    expect(adapter.name).toBe("line");

    vi.unstubAllEnvs();
  });

  it("reads channelSecret from env var", () => {
    vi.stubEnv("LINE_CHANNEL_ACCESS_TOKEN", "env-token");
    vi.stubEnv("LINE_CHANNEL_SECRET", "env-secret");

    const adapter = createLineAdapter();
    expect(adapter.name).toBe("line");

    vi.unstubAllEnvs();
  });

  it("prefers explicit config over env vars", () => {
    vi.stubEnv("LINE_CHANNEL_ACCESS_TOKEN", "env-token");
    vi.stubEnv("LINE_CHANNEL_SECRET", "env-secret");

    const adapter = createLineAdapter({
      channelAccessToken: "explicit-token",
      channelSecret: "explicit-secret",
    });

    expect(adapter.name).toBe("line");

    vi.unstubAllEnvs();
  });

  it("throws when only channelAccessToken is in env", () => {
    vi.stubEnv("LINE_CHANNEL_ACCESS_TOKEN", "env-token");

    expect(() => createLineAdapter()).toThrow(ValidationError);
    expect(() => createLineAdapter()).toThrow("channelSecret");

    vi.unstubAllEnvs();
  });

  it("throws when only channelSecret is in env", () => {
    vi.stubEnv("LINE_CHANNEL_SECRET", "env-secret");

    expect(() => createLineAdapter()).toThrow(ValidationError);
    expect(() => createLineAdapter()).toThrow("channelAccessToken");

    vi.unstubAllEnvs();
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
