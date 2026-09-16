---
"chat-adapter-line": patch
---

Preserve the metadata LINE sends with an inbound image, video, audio, or file message. `LineMessage.media` now carries `providerMessageId`, `kind`, and, where LINE supplies them, `fileName`, `fileSize`, `duration`, and a `contentProvider` saying whether LINE hosts the file or the sender's own app does. Reading any of it used to mean digging through the raw webhook payload.

The Chat SDK attachment gains what it has slots for, so code that never touches `message.media` benefits too: `name` is the sender's file name rather than the synthetic `image-<id>` it used to be, `size` is the byte count, and `url` points at an externally hosted file. LINE serves its own uploads through an authenticated API rather than a public URL, so `url` stays unset for those. Deferred fetching is unchanged: `fetchData()` still downloads nothing until it is called, and webhook parsing never touches the content.

Optional fields LINE reports in an unusable shape are dropped rather than guessed at or allowed to reject the attachment, so an unparseable file size costs you the size and nothing else. A media message with no ID now yields no attachment at all, because the ID is what the content is fetched by, and an attachment that cannot be fetched is worse than none.

The public exports now include the `LineContentProvider` and `LineMediaMetadata` types and the `parseInboundMedia` helper.
