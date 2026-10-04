---
"chat-adapter-line": patch
---

Keep the adapter working when `getBotInfo` fails during initialization. A `429` used to be rethrown, and the Chat SDK keeps a failed initialization and replays it to every later webhook, so one rate-limited call at startup failed every webhook, for every adapter, until the process restarted. Any other failure pinned the channel ID to `"unknown"`, so thread IDs read `line:unknown:…` for the life of the process and changed after the next healthy start, orphaning the subscriptions and thread state stored under them.

Initialization now never throws and never guesses. The adapter takes the bot's user ID from the first webhook's `destination`, which LINE sets to the same value. Until a webhook arrives, `encodeThreadId()` throws a `ValidationError` instead of encoding `unknown`.
