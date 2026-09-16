---
"chat-adapter-line": patch
---

Support native LINE location messages in both directions. An inbound location message now exposes `LineMessage.location` with `latitude`, `longitude`, and the optional `title` and `address`, so a bot can read the place a user shared without inspecting the raw webhook payload. LINE leaves the title and address off a pin the sender did not name, and coordinates that are missing or outside the geographic ranges leave `location` unset rather than arriving as a place that looks valid. Webhook parsing makes no geocoding, map, or tile request.

Outbound, `postMessage()` accepts `{ location: { title, address, latitude, longitude } }` and sends a native LINE location message over the same reply-first, push-fallback path as text. LINE requires all four, so the title and address must be non-blank and at most 100 characters, the latitude must fall between -90 and 90, and the longitude between -180 and 180; anything else throws a `ValidationError` before the adapter calls LINE. A LINE location message cannot carry a quote, so a `quoteToken` or `mentions` throws instead of being dropped, as it already does on a card. Broadcast and multicast accept the new shape too. The public exports now include the `LineLocation` and `LinePostableLocation` types and the `buildLocationMessage` and `parseInboundLocation` helpers.
