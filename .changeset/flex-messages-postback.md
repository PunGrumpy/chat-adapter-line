---
"chat-adapter-line": minor
---

Add support for translating Chat SDK JSX cards to LINE Flex Messages and handling postback events. Postback button clicks now dispatch to Chat SDK `onAction` handlers via `processAction`.
