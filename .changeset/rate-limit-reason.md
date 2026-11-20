---
"chat-adapter-line": patch
---

Say why LINE answered 429. LINE uses 429 both for request throttling and for a channel that has used up its monthly messages, and both used to read `Rate limited by line`. The `AdapterRateLimitError` message now ends with LINE's own reason, for example `Rate limited by line: You have reached your monthly limit.`, and `error.cause` holds the LINE SDK's `HTTPFetchError` with the status, headers, and body.
