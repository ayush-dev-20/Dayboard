# 0002. Serve emoji data from our own origin

**Status:** Accepted
**Date:** 2026-10-01
**Phase:** V1

## Context
Feature 02 uses `frimousse` for the emoji picker (spec 02 §8). By default it downloads its emoji list from a public CDN each time it is used. That tells a third party when someone opens the picker, breaks the picker offline, and is a request we do not control in a self-hosted product.

## Decision
Copy `emojibase-data` (English `data.json` and `messages.json`) into `public/emojibase/` before `dev` and `build` (`scripts/copy-emoji-data.mjs`) and point `frimousse` at it with `emojibaseUrl`. The copy is git-ignored: it is generated, not source. The Docker build creates it too (`pnpm build` runs `prebuild`).

## Alternatives
- Leave the CDN default: simplest, but a third-party call and no offline support.
- Commit the JSON: no build step, but a large generated file in the repo that drifts from the package.
- A one-grapheme text input (the spec's fallback): works offline but gives no search or browsing.

## Consequences
- No emoji request leaves our origin (an E2E test checks this).
- `pnpm install` must have run before `dev` or `build`; the script says so if not. The Dockerfile build runs it through `prebuild`.
- Updating emoji means bumping `emojibase-data` (pinned).
