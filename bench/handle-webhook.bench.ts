import crypto from "node:crypto";

import { bench, describe } from "vite-plus/test";

import { LineAdapter } from "../src/adapter.js";

const CHANNEL_SECRET = "benchmark-channel-secret";
const adapter = new LineAdapter({
  channelAccessToken: "benchmark-token",
  channelSecret: CHANNEL_SECRET,
});

const WEBHOOK_BODY = JSON.stringify({
  destination: "benchmark-destination",
  events: [
    {
      deliveryContext: { isRedelivery: false },
      message: { id: "msg-1", text: "hello", type: "text" },
      mode: "active",
      replyToken: "reply-1",
      source: { type: "user", userId: "u-123" },
      timestamp: 1_700_000_000_000,
      type: "message",
      webhookEventId: "evt-1",
    },
  ],
});

const VALID_SIGNATURE = crypto
  .createHmac("SHA256", CHANNEL_SECRET)
  .update(WEBHOOK_BODY)
  .digest("base64");

const INVALID_SIGNATURE = VALID_SIGNATURE.endsWith("A")
  ? `${VALID_SIGNATURE.slice(0, -1)}B`
  : `${VALID_SIGNATURE.slice(0, -1)}A`;

const makeRequest = (signature: string): Request =>
  new Request("https://example.com/webhook", {
    body: WEBHOOK_BODY,
    headers: { "x-line-signature": signature },
    method: "POST",
  });

describe("handleWebhook", () => {
  bench("rejects invalid signature", async () => {
    const response = await adapter.handleWebhook(
      makeRequest(INVALID_SIGNATURE)
    );
    if (response.status !== 401) {
      throw new Error(`Unexpected status: ${response.status}`);
    }
  });

  bench("valid signature and JSON parsing", async () => {
    const response = await adapter.handleWebhook(makeRequest(VALID_SIGNATURE));
    if (response.status !== 200) {
      throw new Error(`Unexpected status: ${response.status}`);
    }
  });
});
