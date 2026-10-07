# Architecture decisions (ADRs)

One short file per decision. Write one whenever you change the architecture or choose something different from a spec. Do it **before** you build it.

Filename: `NNNN-short-title.md` (for example `0001-use-better-auth.md`). Numbers go up and are never reused. Do not delete an old ADR; mark it **Superseded by NNNN** and write a new one.

## Index

| #                                        | Title                                            | Status   |
| ---------------------------------------- | ------------------------------------------------ | -------- |
| [0001](0001-pin-typescript-6.md)         | Pin TypeScript to the 6.0 line                   | Accepted |
| [0002](0002-self-host-emoji-data.md)     | Serve emoji data from our own origin             | Accepted |
| [0003](0003-use-inter-everywhere.md)     | Use Inter for all interface text                 | Accepted |
| [0004](0004-ai-provider-package.md)      | Anthropic through the Vercel AI SDK, plus a mock | Accepted |
| [0005](0005-modern-calm-ui-direction.md) | Modern calm UI direction (Option B)              | Accepted |
| [0008](0008-drag-and-drop-library.md)    | Drag and drop with dnd-kit (core and sortable)   | Accepted |

## Template

```markdown
# NNNN. Title

**Status:** Proposed | Accepted | Superseded by NNNN
**Date:** YYYY-MM-DD
**Phase:** V1 | V2 | V3

## Context

What problem or situation forced a decision? Include the relevant spec section.

## Decision

What we chose, in one or two sentences.

## Alternatives

Other options considered, and why they lost.

## Consequences

What gets easier, what gets harder, and what we must now watch for.
```
