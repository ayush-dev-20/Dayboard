# 0001. Pin TypeScript to the 6.0 line

**Status:** Accepted
**Date:** 2026-10-01
**Phase:** V1

## Context
`CLAUDE.md` fixes the stack as TypeScript (strict) with no version. When feature 01 was built, `npm` offered TypeScript 7.0, the native-compiler rewrite. `typescript-eslint` (used by `eslint-config-next`) declares support for `>=4.8.4 <6.1.0`, so ESLint's type-aware rules cannot be relied on with 7.x.

## Decision
Pin `typescript` to `6.0.3` (exact) and `eslint` to the 9.x line. Revisit when `typescript-eslint` supports TypeScript 7 and Next.js documents it.

## Alternatives
- **TypeScript 7.0:** newest and faster, but unsupported by the linter we depend on; failures would be confusing and tied to tooling, not our code.
- **TypeScript 5.9:** supported, but 6.0 is also inside the supported range and is the newer line.
- **ESLint 10:** `eslint-plugin-react` and related plugins in `eslint-config-next` list ESLint 9 as their ceiling.

## Consequences
We stay on the maintained 6.0 line. Do not "upgrade" TypeScript or ESLint as a drive-by change; check `pnpm why typescript` peer ranges first. The pin lives in `package.json` and `pnpm-lock.yaml`.
