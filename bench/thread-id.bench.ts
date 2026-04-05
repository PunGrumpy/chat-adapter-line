import { bench, describe } from "vite-plus/test";

import { decodeThreadId, encodeThreadId } from "../src/lib/thread-id.js";

const CHANNEL_ID = "bot-1234567890";
const SIMPLE_SOURCE_ID = "u-abc123";
const COMPLEX_SOURCE_ID = "u:with:colon:segments:for:line";
const ENCODED_SIMPLE = encodeThreadId("user", CHANNEL_ID, SIMPLE_SOURCE_ID);
const ENCODED_COMPLEX = encodeThreadId("group", CHANNEL_ID, COMPLEX_SOURCE_ID);

describe("thread-id", () => {
  bench("encode simple thread id", () => {
    encodeThreadId("user", CHANNEL_ID, SIMPLE_SOURCE_ID);
  });

  bench("encode thread id with colon-rich source", () => {
    encodeThreadId("group", CHANNEL_ID, COMPLEX_SOURCE_ID);
  });

  bench("decode simple thread id", () => {
    decodeThreadId(ENCODED_SIMPLE);
  });

  bench("decode colon-rich thread id", () => {
    decodeThreadId(ENCODED_COMPLEX);
  });
});
