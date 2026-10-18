---
"chat-adapter-line": patch
---

Require `chat` 4.17.0 or a later 4.x release. The peer range allowed every 4.x release, but the adapter imports `isTableNode` and `tableToAscii`, which `chat` first exports in 4.16.0, so the package failed to load on anything older. It also relies on `BaseFormatConverter.renderList()` and the `StreamChunk` type from 4.17.0, so on 4.16 rendering a Markdown list threw. CI now runs the tests against `chat` 4.17.0 as well as the locked version.
