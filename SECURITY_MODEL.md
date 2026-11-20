# Security model

This file describes who and what chat-adapter-line trusts, so security reviews and scans judge findings against it. To report a vulnerability, see `.github/SECURITY.md`.

## System overview

chat-adapter-line is a LINE Messaging API adapter for the Chat SDK, published to npm. It verifies LINE webhooks, turns events into Chat SDK messages and sends replies and pushes.

## Components

| Component         | Code                  | Distribution surface |
| ----------------- | --------------------- | -------------------- |
| chat-adapter-line | `src/`                | npm package          |
| CI/release        | `.github/workflows/*` | npm package          |

## Assets

- LINE messages and user data of the downstream bots.
- The channel secret and access token held by the downstream app.
- Integrity of the published package and its release workflow.

Critical assets across the maintainer's projects, in the maintainer's words: secrets in CI of action users (Cursor API key, `GITHUB_TOKEN`); root privileges and network config on Macs running Peony; integrity of published npm packages and releases; pigo API availability; and the data of downstream apps that use the libraries (logs, vectors, LINE messages).

## Trust boundaries and entry points

- **LINE webhook → adapter**: the HMAC-SHA256 signature over the raw body, checked with `timingSafeEqual` in `adapter.ts`, is the only authentication.
- **Inbound media**: downloads content from LINE into memory.
- **Outbound**: reply tokens, thread-ID encoding and Flex payload passthrough.

## Attackers that matter

- Anyone on the internet who can reach the downstream bot's webhook URL, including forged webhooks.
- LINE users sending messages and media to the bot.
- A supply-chain attacker targeting the release workflow or npm publish.

## Existing controls

- Constant-time signature comparison that handles length mismatch.

## Out of scope

- None beyond the portfolio-wide exclusions.
- Across the maintainer's projects: docs and marketing sites, and bench and video packages.
