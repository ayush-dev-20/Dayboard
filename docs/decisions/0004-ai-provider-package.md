# 0004. Anthropic through the Vercel AI SDK, plus a mock

**Status:** Accepted
**Date:** 2026-10-02
**Phase:** V1

## Context

Feature 05 needs one provider adapter. `CLAUDE.md` §2 fixes the stack as the Vercel AI SDK (`ai`) plus **one** provider package, used only inside the adapter. The feature doc lists `AI_PROVIDER=anthropic|openai|mock`, but adding both `@ai-sdk/anthropic` and `@ai-sdk/openai` would be two provider packages, and `CLAUDE.md` forbids packages that are not used.

## Decision

Install `ai` and `@ai-sdk/anthropic` only. `AI_PROVIDER` accepts `anthropic` and `mock`. The SDK is imported in one file, `src/lib/ai/providers/sdk.ts`; everything else talks to the `AIProvider` interface in `src/lib/ai/provider.ts`. `AI_BASE_URL` points the Anthropic client at a proxy or gateway. Default models: `claude-sonnet-5-5` (`AI_MODEL`) and `claude-haiku-4-5-20251001` (`AI_MODEL_FAST`).

## Alternatives

- Both Anthropic and OpenAI packages: matches the env list in the feature doc, but ships an unused package and a second code path nobody tests.
- `@ai-sdk/openai-compatible` with `AI_BASE_URL`: one package for many vendors, but loses Anthropic-specific behaviour and was not asked for.

## Consequences

- Adding OpenAI later is a new `providers/openai.ts` plus one enum value; no feature code changes.
- `AI_PROVIDER=openai` from the feature doc is **not** accepted. The env check fails at startup with a clear message rather than silently using the mock.
- Tests and CI always use the mock (`E2E=true` forces it), so they make no paid calls.

## Update (2026-10-03): Gemini added

The owner wants to start on Google's free tier, so `@ai-sdk/google` was added and `AI_PROVIDER=gemini` is accepted (defaults `gemini-3.5-flash` and `gemini-3.5-flash-lite`). This is a second provider package, approved by the owner's request; it is still used only inside `src/lib/ai/providers/sdk.ts`. Gemini's free tier may use prompts to improve Google's products, so Settings → AI says so when it is the provider. `openai` is still not wired.
