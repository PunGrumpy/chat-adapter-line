import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vite-plus/test";

import { ReplyTokenStore } from "../../src/lib/reply-token-store.js";

describe("ReplyTokenStore", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns undefined when no token is stored", () => {
    const store = new ReplyTokenStore();
    expect(store.take("thread-1")).toBeUndefined();
  });

  it("stores and takes a token", () => {
    const store = new ReplyTokenStore();
    store.set("thread-1", "token-1");

    expect(store.take("thread-1")).toBe("token-1");
  });

  it("consumes the token on take (single use)", () => {
    const store = new ReplyTokenStore();
    store.set("thread-1", "token-1");

    expect(store.take("thread-1")).toBe("token-1");
    expect(store.take("thread-1")).toBeUndefined();
  });

  it("keeps tokens scoped per thread", () => {
    const store = new ReplyTokenStore();
    store.set("thread-1", "token-1");
    store.set("thread-2", "token-2");

    expect(store.take("thread-1")).toBe("token-1");
    expect(store.take("thread-2")).toBe("token-2");
  });

  it("replaces an older token for the same thread", () => {
    const store = new ReplyTokenStore();
    store.set("thread-1", "old");
    store.set("thread-1", "new");

    expect(store.take("thread-1")).toBe("new");
    expect(store.take("thread-1")).toBeUndefined();
  });

  it("expires tokens after the configured TTL", () => {
    const store = new ReplyTokenStore(55_000);
    store.set("thread-1", "token-1");

    vi.advanceTimersByTime(55_001);

    expect(store.take("thread-1")).toBeUndefined();
  });

  it("returns the token before the TTL elapses", () => {
    const store = new ReplyTokenStore(55_000);
    store.set("thread-1", "token-1");

    vi.advanceTimersByTime(54_999);

    expect(store.take("thread-1")).toBe("token-1");
  });

  it("evicts the oldest entry when the bound is exceeded", () => {
    const store = new ReplyTokenStore(60_000, 2);
    store.set("thread-1", "token-1");
    store.set("thread-2", "token-2");
    store.set("thread-3", "token-3");

    expect(store.take("thread-1")).toBeUndefined();
    expect(store.take("thread-2")).toBe("token-2");
    expect(store.take("thread-3")).toBe("token-3");
  });
});
