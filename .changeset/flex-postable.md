---
"chat-adapter-line": patch
---

Support arbitrary Flex Messages in `postMessage`. A `{ flex: { altText, contents } }` postable sends a LINE `bubble` or `carousel` container through untouched, so callers can use hero images, carousels, URI and datetime-picker actions, colors, and custom layout that the `card` model cannot express.

The adapter rejects a blank `altText` and one longer than 400 characters. It rejects a quote token or mentions on a `flex` postable, as it already does on a card. Reply, push, broadcast, and multicast all take the new shape. The public exports now include the `LinePostableFlex` type and the `buildNativeFlexMessage` helper.
