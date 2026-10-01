# Architecture decisions (ADRs)

One short file per decision. Write one whenever you change the architecture or choose something different from a spec. Do it **before** you build it.

Filename: `NNNN-short-title.md` (for example `0001-use-better-auth.md`). Numbers go up and are never reused. Do not delete an old ADR; mark it **Superseded by NNNN** and write a new one.

## Index

| # | Title | Status |
|---|---|---|
| [0001](0001-pin-typescript-6.md) | Pin TypeScript to the 6.0 line | Accepted |
| [0002](0002-self-host-emoji-data.md) | Serve emoji data from our own origin | Accepted |

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
