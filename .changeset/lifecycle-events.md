---
"chat-adapter-line": patch
---

Expose LINE's lifecycle webhook events. `adapter.onLifecycleEvent(handler)` reports `follow`, `unfollow`, `join`, `leave`, `memberJoined`, and `memberLeft`, and returns a function that unsubscribes that handler. The adapter used to drop these events on the floor, because they carry no message and some carry no reply token.

Each event arrives flattened onto one shape with `type`, `threadId`, `sourceType`, `sourceId`, `timestamp`, `webhookEventId`, `mode`, `isRedelivery`, and the untouched `raw` event, plus `userId`, `members`, `isUnblocked`, and `replyToken` where LINE supplies them. Lifecycle events never reach the Chat SDK's message or action handlers and are never turned into synthetic text messages. Every registered handler sees every event, and one that throws or rejects is logged without stopping the others or changing the `200` the webhook returns.

A redelivered or standby-mode lifecycle event is delivered rather than dropped, unlike a message, because a missed `unfollow` cannot be recovered the way a missed message can be resent. Both facts ride on the event as `isRedelivery` and `mode`, and `webhookEventId` identifies a delivery uniquely, so a handler can filter and deduplicate.

LINE issues a reply token with `follow`, `join`, and `memberJoined`. The adapter now stores it for the reply-first path, so a welcome message sent after a follow goes out over the free Reply API rather than the quota-metered Push API. A dummy token from the LINE console's verify button is ignored, as it already is for messages.

The public exports now include the `LineEventSource`, `LineLifecycleEvent`, `LineLifecycleEventType`, `LineLifecycleHandler`, and `LineLifecycleRawEvent` types and the `isLifecycleEvent`, `toLifecycleEvent`, and `sourceIdFrom` helpers.
