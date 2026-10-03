# Feature: UI modernization (Option B, modern calm)

**Phase:** V1
**Status:** Done (owner sign-off on the §2.2 / §15 defaults still open)
**Date:** 2026-10-03

## What was built

- **M0–M1 foundation:** `DESIGN.md` rewritten for "Paper Daybook, modern calm" (lints 0/0); UI spec, `CLAUDE.md` and ADR 0005 updated. Colors are **generated** from three inputs by `pnpm theme:generate` (`src/lib/theme/`), which refuses any pair under 4.5:1 / 3:1; four shadow levels (`--elevation-*`, border + top highlight in dark), radii 4/8/12/16, Inter `opsz` headings, and "red is rare" in the shared `DueChip`.
- **M2 shell:** inset main panel (`#main-panel` scrolls; sidebar doesn't), grouped sidebar with up to five active projects, collapsible to a 56px rail (cookie `sidebar_collapsed`, `⌘\`), account block at its bottom, centered columns (`PageContainer`: 960 / 1200 / 760), one sticky `PageHeader`.
- **M3 screens:** Today rebuilt (progress ring, focus hero with suggestions, AI brief, collapsible Overdue, right rail with checklist); task row quick actions; Projects card grid; Notes list/grid (`?view=grid`); per-route skeletons.
- **M4 motion:** `motion` 14.0.0 behind `MotionProvider` (`reducedMotion="user"`), tokens in `src/lib/motion.ts`, row add/remove/reorder, tick draw, sheet spring, route fade (`(app)/template.tsx`), counter crossfade, dialog/command scale, streaming caret.
- **M5–M6:** tinted AI panels, previews as forms (Enter/Esc, Select all), ⌘K "Ask your workspace" row, split auth with official Simple Icons marks, 3-step onboarding, derived getting-started checklist (migration `0005`, `dismissChecklist`), seven in-house illustrations + `EmptyState` v2, brand mark/icons/manifest/OG/sitemap/robots, table-based emails, new not-found.
- **M7 landing** at `/` (static; the proxy sends a session cookie to `/today`), real screenshots from `pnpm capture:marketing`, draft Privacy/Terms. **M8:** `e2e/a11y.spec.ts` (axe, light+dark), `reduced-motion.spec.ts`, `responsive.spec.ts` (360–1920), `visual.spec.ts` (48 baselines), contrast + motion unit tests.

## Why

The app was correct but read as a document, not a product (research note `docs/research/2026-10-02-ui-modernization.md`). Option B keeps the brand and adds depth, motion and a front door without changing behavior, density or contracts.

## What was deferred

- Owner decisions §2.2 / §15: built on the defaults (Option B, Inter `opsz`, no sample data, no pricing claim, landing as the front door, in-house mark, drafted legal text). `designs/v2/` mockups were not commissioned; built from `DESIGN.md` and the spec.
- Sample data in onboarding (D5) and "Remove sample data": skipped (default).
- Visual baselines are macOS only; CI (feature 06) needs its own Linux set and a job for `pnpm check:bundle` and `pnpm theme:check`.

## Deviations from the feature doc

- **Previews keep their verbs** ("Create 3 tasks", "Add 3 subtasks", "Apply 2") instead of "Accept selected (N)"; "Select all/none" and Enter/Esc give the diff feel. Existing AI E2E relies on the names.
- **Focus "Mark done"** is the card's square checkbox (no second control). Empty copy: title "Pick your focus" plus the old line, which E2E reads.
- **Z-index:** popovers stay on the dialog layer (50), not 30, so pickers inside dialogs open above them. Command 70, toast 60, sheet 40, header 20, sidebar 10.
- **Sidebar projects:** "Show all (N)" only when there are more than five (an always-on "All projects" would collide with E2E's `/Projects/` name match).
- **Quick actions** are hidden below 768px (overflow menu instead) so 360px titles aren't squeezed; visible on touch-only tablets.
- **Rail notes heading** stays "Recently updated notes" (E2E region name), not "Recent notes".
- **Data:** `getTodayData` gained exact progress counts and the two newest inbox items; `nextDueTasks()` and `checklistCounts()` are new read queries. No action or route contract changed.
- **Images** are stored as PNG in `public/marketing/`; `next/image` serves AVIF/WebP. Sizes are generated into `components/marketing/image-sizes.ts`.
- **Reduced-motion test** samples `transform`, `scale` and `translate` and asserts they never change (dialogs keep a static −50% translate), treating identity matrices as none. Dialog and command zoom are `motion-safe:` only.
- **Expanded task panel** fills the inset panel (1190px at 1440), not window − sidebar.
- **Test edits:** `projects.spec` (two link lookups scoped to `main`), `tasks.spec` (expand width measured from `#main-panel`), `auth.spec` (theme is on onboarding step 2), `search.spec` (Tab cycle, from feature 05).

## Related files

- `src/lib/theme/{color,generate}.ts`, `scripts/generate-theme.ts`: the palette generator and contrast guarantee.
- `src/components/layout/`: `app-shell`, `sidebar-nav`, `sidebar-state` (cookie), `page-header`, `page-container`, `skeletons`, `empty-state`, `brand`.
- `src/components/today/`: `day-progress`, `focus-hero`, `today-rail`, `checklist`, `collapsible-section`.
- `src/lib/motion.ts`, `src/components/motion/`; `src/components/marketing/`; `src/components/illustrations/`.
- `scripts/capture-screens.ts` (before/after), `scripts/capture-marketing.ts` (landing images).

## Hand-off notes

- Change a color by changing the recipe in `generate.ts`, then `pnpm theme:generate` (it runs Prettier itself). The contrast test fails on any hand edit.
- Re-run `pnpm capture:marketing` (seeded demo user, mock AI, a build on :3200) whenever the UI changes; it also rewrites `image-sizes.ts`. If a `public/marketing/*.png` is missing, `/_next/image` answers 400; `FrameImage` then shows a same-size placeholder instead of a broken-image icon (the auth panel briefly showed one before the images were first generated).
- Screenshots: `docs/research/ui-modernization/before/` and `after/`.
- `today.spec` "Scheduled later today" fails between 23:30 and 06:00 IST: its 23:30 task is already overdue then. Time-dependent test, not a regression.
- Lists animate rows with `layout="position"`; a list re-centering when the task panel closes glides rows to their new place (intended).
