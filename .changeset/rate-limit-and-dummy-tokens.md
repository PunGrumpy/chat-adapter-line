---
"chat-adapter-line": patch
---

Skip LINE's webhook URL verification dummy events so they no longer trigger bot handlers or cache a reply token that LINE will reject.
