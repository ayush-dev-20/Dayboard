# 0005. Modern calm UI direction (Option B)

**Status:** Accepted
**Date:** 2026-10-02
**Phase:** V1

## Context

The built app was clean, consistent and accessible, but read as "a well-made document" rather than a product people would pay for: flat panels only, no cards, a flush-left 880px column that left ~40% of a wide screen empty, five red overdue pills on Today, no motion beyond short fades, and no front door (`/` redirected to `/today`). `DESIGN.md` forbade most of what a modern SaaS look needs (shadows on static content, cards, springs, a centered column), and it still named fonts the app stopped using in ADR 0003. The research is in `docs/research/2026-10-02-ui-modernization.md`; the plan is `specs/v1/features/07-ui-modernization.md`.

## Decision

**Option B, "Paper Daybook, modern calm".** Keep the identity (warm paper, blue-black ink, Inter) and add soft layered depth (four warm shadow levels; border and highlight in dark), cards for one discrete object, a bigger radius scale (4/8/12/16), a generated three-input color system with a contrast guarantee, a "red is rare" rule, an inset main panel with a dimmer collapsible sidebar and a centered column, spring and layout motion under a strict budget with `reducedMotion="user"`, a quiet tinted AI panel (no sparkle, badge or chat sidebar), and a SaaS front door (landing page, split sign-in, three-step onboarding, getting-started checklist, illustrated empty states). `DESIGN.md` was rewritten for this, and the UI spec and `CLAUDE.md` were updated to match.

Defaults taken for the open questions in the feature doc (§2.2 and §15), pending the owner's review: Inter with `opsz` for headings; tinted panel plus "AI-generated" for AI; centered content column; landing copy with no invented proof and no pricing; sample data in onboarding skipped; an in-house SVG brand mark; the landing page is the front door for signed-out visitors.

## Alternatives

- **A. Polish inside the old rules.** Lowest risk, but it keeps the flat, document-like feel the research set out to fix.
- **C. Full re-skin** (new palette, brand and fonts). The most work, and it throws away an identity that tests well and that the owner likes.
- The ui-ux-pro-max skill suggested a teal and orange palette with Plus Jakarta Sans. Rejected: it discards the brand. Its rules (1–2 animations per view, 44px targets, stable hovers, reduced motion, floating nav, real screenshots) were adopted.

## Consequences

- `DESIGN.md` colors are now generated (`pnpm theme:generate`); editing a hex by hand is wrong and is caught by `pnpm theme:generate --check` and the contrast unit test.
- The v1 mockups in `designs/` are stale for visual style (fonts, flat panels, red pills, flush-left layout) until replacements land in `designs/v2/`. They remain right for content and states.
- Adds one runtime dependency (`motion`, already in the approved stack) and one dev dependency (`@axe-core/playwright`, test only), plus a nullable `user_preferences.checklist_dismissed_at` column (migration 0005).
- Every screen's chrome changes, so the visual baselines are new; behavior, server contracts and accessible names do not change.
