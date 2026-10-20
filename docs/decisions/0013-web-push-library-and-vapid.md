# 0013. Web Push library and VAPID handling

**Status:** Accepted
**Date:** 2026-10-19
**Phase:** V2

## Context

V2 feature 14 sends reminders to a person's devices. That needs Web Push: the server encrypts a payload for a browser's push endpoint and signs the request with VAPID keys. CLAUDE.md lists "Web Push" as a V2-only addition; the feature README reserves this number for the choice of library and how keys are kept.

## Decision

- **`web-push`** (the standard Node library for the Web Push protocol: RFC 8030 delivery, RFC 8291 payload encryption, RFC 8292 VAPID). It is imported in **one file**, `src/lib/notifications/web-push-sender.ts`, behind a `PushSender` interface (`send(subscription, payload, options)`), as the AI, calendar and storage providers are. A `MockPushSender` records calls and is what tests and E2E use (`PUSH_PROVIDER=mock`).
- **VAPID keys** are environment variables: `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` (a `mailto:` or `https:` address). They are generated once with `npx web-push generate-vapid-keys`. The public key reaches the browser through `GET /api/notifications/vapid-key` (it is public by design); the private key is server-only, is never logged, and `pnpm check:bundle` fails the build if its name or value appears in the client bundle. **Changing the key pair invalidates every subscription** (the push service ties a subscription to the public key), so the deployment guide says to keep it.
- **All or none:** with none of the three set, push is off and its UI says so; with some set, startup fails and names the missing ones (production), as calendar does.
- **Subscriptions are per device, per person.** One subscription per (person, push device id); a new endpoint from the same device replaces the old. An endpoint registered by another person is refused, never reassigned, so a shared browser profile cannot deliver to the next person.
- **Payloads carry the minimum:** a title and a short body that the person's setting can make generic, a deep link, a tag and the reminder id. Never note text. The log keeps ids and statuses only.

## Alternatives

- **Implement RFC 8291 encryption ourselves** with Node crypto. Possible, but it is exactly the kind of code that is easy to get subtly wrong, and `web-push` is small, maintained and widely deployed. Rejected.
- **A hosted push or notification service** (OneSignal, FCM wrapper SDKs). Sends private task titles to a third party and adds an account to run. Rejected.
- **Email or SMS reminders.** Out of scope for V2.

## Consequences

- One new production dependency (and its types). It is a server-only import, so the browser bundle does not grow.
- The key pair is a deployment secret that must not be rotated casually. `.env.example` and the deployment notes say so.
- iOS delivers push only to an installed app (16.4+); the Settings page explains that rather than failing silently.
