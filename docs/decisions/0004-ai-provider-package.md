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

## Update (2026-10-10): model fallback

A model can fail for a reason that is not the request's fault: the free quota is used up (429), the service is overloaded (5xx), it times out, or the model name is no longer available (404). Free-tier limits belong to each model, so another model usually has its own allowance.

**Decision.** Inside `src/lib/ai/providers/sdk.ts` (rules in `fallback.ts`), a call that fails for one of those reasons moves to the next model in a list, and the model that answered is the one recorded in `ai_usage`. Defaults for Gemini: 3.5 Flash, then 3.5 Flash-Lite, 2.5 Flash, 2.5 Flash-Lite (the fast tier: 3.5 Flash-Lite, 2.5 Flash-Lite, 2.5 Flash). Anthropic: Sonnet, then Haiku. `AI_FALLBACK_MODELS` (comma list, or `none`) replaces the list.

- It does **not** move on for a bad request (400) or a refused key (401, 403): another model would fail the same way.
- It moves on **only before anything has reached the person**. A streamed answer or assistant turn that has already shown text, or a person who has stopped the call, is never restarted on another model.
- A model that just failed rests for a while (5 minutes after a quota error, 1 minute after an outage, 1 hour if the model is missing) and goes to the back of the list, so the next calls start with one that works. This is kept in memory per server instance.
- A model that hangs without an error is not covered: only the existing overall timeouts apply.

**Consequence.** One extra thing to watch: a quality or cost difference between models can appear without a code change, so check `ai_usage.model` if answers change character.
