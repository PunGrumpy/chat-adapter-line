---
"chat-adapter-line": patch
---

Ship `dist/index.d.ts` again. The build had declaration output turned off, so TypeScript consumers of the published package saw no types for `LineAdapter` or its exports.
