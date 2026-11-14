---
"chat-adapter-line": patch
---

Ignore spaces and newlines around `channelSecret` and `channelAccessToken`, so a value copied from the LINE console or read from a `.env` file with a trailing newline no longer makes every webhook fail with `401 Invalid signature`. A webhook whose signature does not match now logs a warning that points at the channel secret.
