---
version: alpha
name: Dayboard
description: A calm personal workspace for tasks, todos, notes and projects. Warm paper, blue-black ink, serif headings over a compact sans, hairlines instead of cards. Light, dark and system themes.

colors:
  # Light: paper ladder (ground < page < raised)
  neutral: "#F3F0E9"
  surface: "#FAF8F2"
  raised: "#FDFCF8"
  hover: "#EDE9E1"
  border: "#E1DCD4"
  outline: "#867F76"
  # Light: ink
  on-surface: "#221D18"
  secondary: "#605A53"
  # Light: the one accent, blue-black fountain-pen ink
  primary: "#1B5687"
  primary-strong: "#083F6C"
  primary-subtle: "#D6E9F7"
  # Light: semantics, derived from the paper/ink family
  error: "#9A322A"
  error-subtle: "#FFE4DF"
  warning: "#805307"
  warning-subtle: "#F9EACA"
  success: "#2E663C"
  scrim: "#221D1852"
  # Dark: warm-tinted, never navy, never pure black (ground < page < raised < overlay)
  dark-neutral: "#0E0C09"
  dark-surface: "#15120E"
  dark-raised: "#1F1B17"
  dark-overlay: "#292420"
  dark-border: "#322D27"
  dark-outline: "#807971"
  dark-on-surface: "#E9E6DF"
  dark-secondary: "#A9A49C"
  dark-primary: "#77B9E8"
  dark-primary-strong: "#96CFF6"
  dark-primary-subtle: "#193043"
  dark-on-primary: "#15120E"
  dark-error: "#ED8C80"
  dark-error-subtle: "#451E1A"
  dark-warning: "#DBB06B"
  dark-warning-subtle: "#3B2B0D"
  dark-success: "#82C38F"
  dark-scrim: "#0A08078F"
  # Project and tag marker colors. One set, tuned to clear 3:1 on every paper and dark surface.
  tag-slate: "#707F8F"
  tag-red: "#BB584F"
  tag-amber: "#AF7A31"
  tag-green: "#4B8B5A"
  tag-teal: "#368986"
  tag-blue: "#4489AE"
  tag-violet: "#886AAA"
  tag-pink: "#B16389"

typography:
  display:
    fontFamily: Newsreader
    fontSize: 40px
    fontWeight: 400
    lineHeight: 1.1
    letterSpacing: -0.02em
    fontVariation: "'opsz' 72"
  headline-lg:
    fontFamily: Newsreader
    fontSize: 30px
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: -0.015em
    fontVariation: "'opsz' 48"
  headline-md:
    fontFamily: Newsreader
    fontSize: 22px
    fontWeight: 600
    lineHeight: 1.28
    letterSpacing: -0.01em
    fontVariation: "'opsz' 24"
  headline-sm:
    fontFamily: Newsreader
    fontSize: 18px
    fontWeight: 600
    lineHeight: 1.3
    fontVariation: "'opsz' 16"
  note-title:
    fontFamily: Newsreader
    fontSize: 36px
    fontWeight: 600
    lineHeight: 1.15
    letterSpacing: -0.02em
    fontVariation: "'opsz' 72"
  note-body:
    fontFamily: Newsreader
    fontSize: 18px
    fontWeight: 400
    lineHeight: 1.65
    fontVariation: "'opsz' 16"
  body-lg:
    fontFamily: IBM Plex Sans
    fontSize: 16px
    fontWeight: 400
    lineHeight: 1.55
  body-md:
    fontFamily: IBM Plex Sans
    fontSize: 14px
    fontWeight: 400
    lineHeight: 1.5
  body-sm:
    fontFamily: IBM Plex Sans
    fontSize: 13px
    fontWeight: 400
    lineHeight: 1.45
    letterSpacing: 0.005em
  label-md:
    fontFamily: IBM Plex Sans
    fontSize: 13px
    fontWeight: 600
    lineHeight: 1.2
  label-caps:
    fontFamily: IBM Plex Sans
    fontSize: 11px
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: 0.08em
    fontFeature: "'case' 1"
  data-md:
    fontFamily: IBM Plex Mono
    fontSize: 13px
    fontWeight: 400
    lineHeight: 1.45
    fontFeature: "'tnum' 1"
  data-sm:
    fontFamily: IBM Plex Mono
    fontSize: 12px
    fontWeight: 400
    lineHeight: 1.4
    fontFeature: "'tnum' 1"
  kbd:
    fontFamily: IBM Plex Mono
    fontSize: 11px
    fontWeight: 400
    lineHeight: 1.3

rounded:
  none: 0px
  sm: 3px
  md: 6px
  lg: 10px
  full: 9999px

spacing:
  xs: 4px
  sm: 8px
  md: 12px
  lg: 16px
  xl: 24px
  2xl: 32px
  3xl: 48px
  gutter: 24px
  margin-desktop: 32px
  margin-mobile: 16px
  row: 36px
  row-touch: 44px
  control: 32px
  sidebar: 240px
  sheet: 480px
  content-max: 880px
  editor-measure: 760px
  command-menu: 640px
  dialog: 440px

components:
  page:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.on-surface}"
    typography: "{typography.body-md}"
  page-dark:
    backgroundColor: "{colors.dark-surface}"
    textColor: "{colors.dark-on-surface}"
    typography: "{typography.body-md}"
  page-title:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.on-surface}"
    typography: "{typography.headline-lg}"
  today-greeting:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.on-surface}"
    typography: "{typography.display}"
  section-header:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.secondary}"
    typography: "{typography.label-caps}"
  text-meta:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.secondary}"
    typography: "{typography.body-sm}"
  text-meta-dark:
    backgroundColor: "{colors.dark-surface}"
    textColor: "{colors.dark-secondary}"
    typography: "{typography.body-sm}"
  divider:
    backgroundColor: "{colors.border}"
    height: 1px
  divider-dark:
    backgroundColor: "{colors.dark-border}"
    height: 1px
  control-rule:
    backgroundColor: "{colors.outline}"
    height: 1px
  control-rule-dark:
    backgroundColor: "{colors.dark-outline}"
    height: 1px
  sidebar:
    backgroundColor: "{colors.neutral}"
    textColor: "{colors.on-surface}"
    typography: "{typography.body-md}"
    width: "{spacing.sidebar}"
  sidebar-dark:
    backgroundColor: "{colors.dark-neutral}"
    textColor: "{colors.dark-on-surface}"
    typography: "{typography.body-md}"
    width: "{spacing.sidebar}"
  nav-item:
    backgroundColor: "{colors.neutral}"
    textColor: "{colors.secondary}"
    typography: "{typography.body-md}"
    rounded: "{rounded.md}"
    height: "{spacing.control}"
    padding: "{spacing.sm}"
  nav-item-hover:
    backgroundColor: "{colors.hover}"
    textColor: "{colors.on-surface}"
  nav-item-active:
    backgroundColor: "{colors.primary-subtle}"
    textColor: "{colors.primary}"
    typography: "{typography.label-md}"
  nav-item-active-dark:
    backgroundColor: "{colors.dark-primary-subtle}"
    textColor: "{colors.dark-primary}"
    typography: "{typography.label-md}"
  top-bar:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.secondary}"
    typography: "{typography.body-sm}"
    height: 48px
  task-row:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.on-surface}"
    typography: "{typography.body-md}"
    height: "{spacing.row}"
    padding: "{spacing.md}"
  task-row-hover:
    backgroundColor: "{colors.hover}"
    textColor: "{colors.on-surface}"
  task-row-selected:
    backgroundColor: "{colors.primary-subtle}"
    textColor: "{colors.on-surface}"
  task-row-completed:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.secondary}"
    typography: "{typography.body-md}"
  task-row-dark-hover:
    backgroundColor: "{colors.dark-raised}"
    textColor: "{colors.dark-on-surface}"
  task-row-dark-selected:
    backgroundColor: "{colors.dark-primary-subtle}"
    textColor: "{colors.dark-on-surface}"
  checkbox-task-checked:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.surface}"
    rounded: "{rounded.sm}"
    size: 18px
  checkbox-todo-checked:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.surface}"
    rounded: "{rounded.full}"
    size: 18px
  checkbox-checked-dark:
    backgroundColor: "{colors.dark-primary}"
    textColor: "{colors.dark-on-primary}"
    rounded: "{rounded.sm}"
    size: 18px
  due-chip:
    backgroundColor: "{colors.neutral}"
    textColor: "{colors.secondary}"
    typography: "{typography.data-sm}"
    rounded: "{rounded.sm}"
    padding: "{spacing.xs}"
  due-chip-overdue:
    backgroundColor: "{colors.error-subtle}"
    textColor: "{colors.error}"
    typography: "{typography.data-sm}"
    rounded: "{rounded.sm}"
    padding: "{spacing.xs}"
  due-chip-overdue-dark:
    backgroundColor: "{colors.dark-error-subtle}"
    textColor: "{colors.dark-error}"
    typography: "{typography.data-sm}"
    rounded: "{rounded.sm}"
    padding: "{spacing.xs}"
  tag-badge:
    backgroundColor: "{colors.neutral}"
    textColor: "{colors.on-surface}"
    typography: "{typography.body-sm}"
    rounded: "{rounded.sm}"
    padding: "{spacing.xs}"
  tag-dot-slate:
    backgroundColor: "{colors.tag-slate}"
    size: 8px
    rounded: "{rounded.full}"
  tag-dot-red:
    backgroundColor: "{colors.tag-red}"
    size: 8px
    rounded: "{rounded.full}"
  tag-dot-amber:
    backgroundColor: "{colors.tag-amber}"
    size: 8px
    rounded: "{rounded.full}"
  tag-dot-green:
    backgroundColor: "{colors.tag-green}"
    size: 8px
    rounded: "{rounded.full}"
  tag-dot-teal:
    backgroundColor: "{colors.tag-teal}"
    size: 8px
    rounded: "{rounded.full}"
  tag-dot-blue:
    backgroundColor: "{colors.tag-blue}"
    size: 8px
    rounded: "{rounded.full}"
  tag-dot-violet:
    backgroundColor: "{colors.tag-violet}"
    size: 8px
    rounded: "{rounded.full}"
  tag-dot-pink:
    backgroundColor: "{colors.tag-pink}"
    size: 8px
    rounded: "{rounded.full}"
  progress-track:
    backgroundColor: "{colors.border}"
    height: 4px
    rounded: "{rounded.full}"
  progress-fill:
    backgroundColor: "{colors.primary}"
    height: 4px
    rounded: "{rounded.full}"
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.surface}"
    typography: "{typography.label-md}"
    rounded: "{rounded.md}"
    height: "{spacing.control}"
    padding: "{spacing.lg}"
  button-primary-hover:
    backgroundColor: "{colors.primary-strong}"
    textColor: "{colors.surface}"
  button-primary-dark:
    backgroundColor: "{colors.dark-primary}"
    textColor: "{colors.dark-on-primary}"
    typography: "{typography.label-md}"
    rounded: "{rounded.md}"
    height: "{spacing.control}"
    padding: "{spacing.lg}"
  button-primary-dark-hover:
    backgroundColor: "{colors.dark-primary-strong}"
    textColor: "{colors.dark-on-primary}"
  button-secondary:
    backgroundColor: "{colors.neutral}"
    textColor: "{colors.on-surface}"
    typography: "{typography.label-md}"
    rounded: "{rounded.md}"
    height: "{spacing.control}"
    padding: "{spacing.lg}"
  button-secondary-dark:
    backgroundColor: "{colors.dark-raised}"
    textColor: "{colors.dark-on-surface}"
    typography: "{typography.label-md}"
    rounded: "{rounded.md}"
    height: "{spacing.control}"
    padding: "{spacing.lg}"
  button-ghost:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.secondary}"
    typography: "{typography.label-md}"
    rounded: "{rounded.md}"
    height: "{spacing.control}"
    padding: "{spacing.md}"
  button-ghost-hover:
    backgroundColor: "{colors.hover}"
    textColor: "{colors.on-surface}"
  button-destructive:
    backgroundColor: "{colors.error}"
    textColor: "{colors.surface}"
    typography: "{typography.label-md}"
    rounded: "{rounded.md}"
    height: "{spacing.control}"
    padding: "{spacing.lg}"
  input:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.on-surface}"
    typography: "{typography.body-md}"
    rounded: "{rounded.md}"
    height: "{spacing.row}"
    padding: "{spacing.md}"
  input-error:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.error}"
    typography: "{typography.body-sm}"
  input-error-dark:
    backgroundColor: "{colors.dark-surface}"
    textColor: "{colors.dark-error}"
    typography: "{typography.body-sm}"
  kbd:
    backgroundColor: "{colors.neutral}"
    textColor: "{colors.secondary}"
    typography: "{typography.kbd}"
    rounded: "{rounded.sm}"
    padding: "{spacing.xs}"
  focus-panel:
    backgroundColor: "{colors.neutral}"
    textColor: "{colors.on-surface}"
    typography: "{typography.headline-md}"
    rounded: "{rounded.md}"
    padding: "{spacing.xl}"
  note-title:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.on-surface}"
    typography: "{typography.note-title}"
  note-body:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.on-surface}"
    typography: "{typography.note-body}"
    width: "{spacing.editor-measure}"
  command-menu:
    backgroundColor: "{colors.raised}"
    textColor: "{colors.on-surface}"
    typography: "{typography.body-lg}"
    rounded: "{rounded.lg}"
    width: "{spacing.command-menu}"
  command-menu-dark:
    backgroundColor: "{colors.dark-raised}"
    textColor: "{colors.dark-on-surface}"
    typography: "{typography.body-lg}"
    rounded: "{rounded.lg}"
    width: "{spacing.command-menu}"
  command-item-active:
    backgroundColor: "{colors.primary-subtle}"
    textColor: "{colors.on-surface}"
    typography: "{typography.body-md}"
    rounded: "{rounded.md}"
  dialog:
    backgroundColor: "{colors.raised}"
    textColor: "{colors.on-surface}"
    typography: "{typography.body-md}"
    rounded: "{rounded.lg}"
    padding: "{spacing.xl}"
    width: "{spacing.dialog}"
  dialog-dark:
    backgroundColor: "{colors.dark-overlay}"
    textColor: "{colors.dark-on-surface}"
    typography: "{typography.body-md}"
    rounded: "{rounded.lg}"
    padding: "{spacing.xl}"
    width: "{spacing.dialog}"
  task-sheet:
    backgroundColor: "{colors.raised}"
    textColor: "{colors.on-surface}"
    typography: "{typography.body-md}"
    rounded: "{rounded.none}"
    width: "{spacing.sheet}"
  scrim:
    backgroundColor: "{colors.scrim}"
  scrim-dark:
    backgroundColor: "{colors.dark-scrim}"
  toast:
    backgroundColor: "{colors.on-surface}"
    textColor: "{colors.surface}"
    typography: "{typography.body-sm}"
    rounded: "{rounded.md}"
    padding: "{spacing.md}"
  tooltip:
    backgroundColor: "{colors.on-surface}"
    textColor: "{colors.surface}"
    typography: "{typography.body-sm}"
    rounded: "{rounded.sm}"
    padding: "{spacing.sm}"
  tooltip-dark:
    backgroundColor: "{colors.dark-on-surface}"
    textColor: "{colors.dark-surface}"
    typography: "{typography.body-sm}"
    rounded: "{rounded.sm}"
    padding: "{spacing.sm}"
  save-state-failed:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.warning}"
    typography: "{typography.body-sm}"
  save-state-failed-dark:
    backgroundColor: "{colors.dark-surface}"
    textColor: "{colors.dark-warning}"
    typography: "{typography.body-sm}"
  status-success:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.success}"
    typography: "{typography.body-sm}"
  status-success-dark:
    backgroundColor: "{colors.dark-surface}"
    textColor: "{colors.dark-success}"
    typography: "{typography.body-sm}"
  banner-conflict:
    backgroundColor: "{colors.warning-subtle}"
    textColor: "{colors.on-surface}"
    typography: "{typography.body-md}"
    rounded: "{rounded.md}"
    padding: "{spacing.md}"
  banner-conflict-dark:
    backgroundColor: "{colors.dark-warning-subtle}"
    textColor: "{colors.dark-on-surface}"
    typography: "{typography.body-md}"
    rounded: "{rounded.md}"
    padding: "{spacing.md}"
  error-state:
    backgroundColor: "{colors.error-subtle}"
    textColor: "{colors.error}"
    typography: "{typography.body-md}"
    rounded: "{rounded.md}"
    padding: "{spacing.lg}"
  ai-panel:
    backgroundColor: "{colors.neutral}"
    textColor: "{colors.on-surface}"
    typography: "{typography.body-md}"
    rounded: "{rounded.md}"
    padding: "{spacing.lg}"
  ai-label:
    backgroundColor: "{colors.neutral}"
    textColor: "{colors.secondary}"
    typography: "{typography.label-caps}"
  ai-source-link:
    backgroundColor: "{colors.neutral}"
    textColor: "{colors.primary}"
    typography: "{typography.body-sm}"
  empty-state:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.secondary}"
    typography: "{typography.body-md}"
---

# Dayboard

## Overview

Dayboard is a personal command center that one person opens many times a day, on a laptop at a desk and on a phone in a queue. It holds their tasks, quick todos, notes and projects, and its promise is: *capture anything, organize when useful, act on what matters.* The screen it is open on most is **Today**, and that screen has to feel like the first page of the day, not a dashboard.

The register is **Paper Daybook**: Warm Analog crossed with Utility Dense. The interface is a well-kept daybook rather than software. Off-white paper, blue-black ink, a serif that reads like a printed date line, and hairline rules that divide the way ruled lines do. Warmth makes the tool feel personal. Density keeps it useful: a task list has to show many rows without feeling cramped, so rows are tight and everything around them is generous.

What this direction gives up, deliberately: **cool, techy polish and loud brand recall.** Dayboard will never look like a glowing dev tool or a colorful consumer app. The trade buys a surface you can look at for hours without fatigue, and an interface that lets your own content, not its chrome, be the interesting thing. Where the UI/UX spec asks for "Apple-like calmness, Notion-like density, Linear-like keyboard-first", this file resolves it as: Apple's *calm* from paper tones and restraint, Notion's *density* from tight rows under generous headers, Linear's *speed* from short motion and visible shortcuts.

The system has three commitments that every screen inherits:

1. **One accent, one job.** Blue-black ink means "this responds to you." Nothing that is not interactive is ever ink blue.
2. **Hairlines, not boxes.** Content is grouped by space and ruled lines. A card exists only for one discrete, comparable object.
3. **AI is a quiet clerk, not a mascot.** It has no color, no glyph and no badge of its own. It appears as ordinary verbs on ordinary buttons and as a plain "AI-generated" label on its output.

Both light and dark themes are first-class, and system-follow is the default. Dark is a separate design, not an inversion.

## Colors

Every color is sampled from a writing desk. That constraint, not preference, set the values.

- **Primary (#1B5687): blue-black fountain-pen ink.** The color of a signature that has dried on cream paper: cool, deep, slightly cyan of true indigo (hue ≈ 248°, deliberately far from the 275–290° indigo-violet default). It is text-safe on every light surface (7.3:1 on paper), so links and controls never need a lighter variant. It carries *all* interaction: primary buttons, links, the checked checkbox, the focus ring, the active nav item, the progress fill. Hover deepens to **Primary-strong (#083F6C)**. **Primary-subtle (#D6E9F7)**, ink diluted to a wash, is the selection tint for the active nav item, the selected task row and the highlighted command-menu result.
- **Surface (#FAF8F2): cream laid paper.** The page. **Neutral (#F3F0E9)** is the desk under the paper: the sidebar, chips and AI panel sit on it. **Raised (#FDFCF8)** is a fresh sheet lying on top: dialogs, the command menu and the task sheet. **Hover (#EDE9E1)** is the pencil-smudge tone for row and nav hover. There is no pure white anywhere; the lightest value is warm.
- **On-surface (#221D18): iron-gall ink, dried.** The near-black for all primary text, carrying a trace of brown, which is why body text looks settled on the paper instead of printed over it (15.7:1).
- **Secondary (#605A53): graphite.** Timestamps, counts, project names, placeholder text, all metadata. It stays ≥ 5.4:1 on every light surface, including hover and selected states, so metadata never dims to illegibility.
- **Border (#E1DCD4): ruled line.** The hairline for dividing rows and sections. Decorative, so it is intentionally quiet. **Outline (#867F76): pencil rule.** Reserved for *control boundaries* (input edges, unchecked checkbox strokes) because WCAG requires 3:1 there, and the ruled-line tone is too faint to meet it (3.7:1 on paper).
- **Error (#9A322A): ledger red ink.** Bookkeepers used red ink for what was overdue or wrong, and Dayboard does the same. It is the color of overdue dates, failed saves that lose data, destructive confirm buttons and inline field errors. **Error-subtle (#FFE4DF)** is the tint behind the overdue chip.
- **Warning (#805307): tobacco ochre.** For "needs attention but nothing is lost": "Not saved, retrying", the note-conflict banner (**Warning-subtle #F9EACA**).
- **Success (#2E663C): baize green.** Extremely scarce: the check glyph beside "Saved" and the occasional inline "Completed" confirmation on paper. It never fills a surface, never appears on the inverted toast (green ink on a dark toast would fail contrast; toast icons take the toast's own text color), and never colors a completed task, since a completed task should simply recede.
- **Info** is not a separate color. Informational messages use Primary-subtle with Primary text, so the palette stays at one hue family plus three earned semantics.

**Project and tag markers (`tag-*`).** The product stores eight named color tokens: slate, red, amber, green, teal, blue, violet, pink. They are pigment-muted (chroma ≈ 0.08–0.13), sit at one lightness (≈ 0.60) so no color outshouts another, and clear 3:1 on every light and dark surface, so one set serves both themes. They are used **only as an 8px dot or 3px bar next to a visible name**, never as text, never as a fill, never as the sole identifier. `tag-blue` is cyan-shifted and lighter than Primary and is a dot, so it cannot be mistaken for a link.

**Dark theme.** Warm charcoal (hue ≈ 70°), never navy, never `#000`. Depth flips: higher means lighter. The ladder is **dark-neutral #0E0C09** (sidebar ground) → **dark-surface #15120E** (page) → **dark-raised #1F1B17** (cards, popovers, command menu, row hover) → **dark-overlay #292420** (dialogs and sheets). Body text drops to **#E9E6DF**, off-white, to avoid halation. Primary lifts to a desaturated sky **#77B9E8** with **dark-on-primary** (#15120E) on it, so buttons keep contrast without going garish. Semantic colors are lightened and softened rather than reused. Every dark pair was recomputed; none carry over from light.

All neutrals are tinted (OKLCH chroma 0.005–0.016, hue 65–90° in light, 70° in dark); no value has R = G = B. Ramps were built in OKLCH and shipped as hex.

**Mapping to shadcn/ui and Tailwind v4.** Adapt shadcn's semantic variables to these tokens; do not leave its default theme in place.

| shadcn variable | Light token | Dark token |
| --- | --- | --- |
| `--background` | surface | dark-surface |
| `--foreground` | on-surface | dark-on-surface |
| `--card`, `--popover` | raised | dark-raised (dialogs/sheets: dark-overlay) |
| `--card-foreground`, `--popover-foreground` | on-surface | dark-on-surface |
| `--muted`, `--secondary` | neutral | dark-neutral |
| `--muted-foreground` | secondary | dark-secondary |
| `--accent` (shadcn's hover highlight, *not* the product accent) | hover | dark-raised |
| `--primary` | primary | dark-primary |
| `--primary-foreground` | surface | dark-on-primary |
| `--border` | border | dark-border |
| `--input` | outline | dark-outline |
| `--ring` | primary | dark-primary |
| `--destructive` | error | dark-error |
| `--warning` | warning | dark-warning |
| `--success` | success | dark-success |
| `--info` | primary | dark-primary |
| `--sidebar` | neutral | dark-neutral |
| `--sidebar-accent` | hover (active item: primary-subtle) | dark-raised (active: dark-primary-subtle) |

The product spec's word "accent" means **primary** in this file. shadcn's `--accent` is a hover surface.

## Typography

Two families split by job, plus a mono for measured things.

**Newsreader** carries the voice: the Today greeting, page titles, section titles, dialog titles, and the *body of notes*. It is a variable serif with a real optical-size axis, so it holds up at 40px without thin-stroke fragility and stays sturdy at 18px reading size. It reads as a printed daybook, which is the point, and it is the reason a note feels like writing rather than filling a form. It is deliberately not Playfair. Fallback: `Newsreader, "Source Serif 4", Georgia, serif`. SIL Open Font License.

**IBM Plex Sans** carries the apparatus: task titles, buttons, labels, nav, form controls. It has engineered warmth, tabular figures, and a large x-height that stays legible at 13–14px, which is the size most of the interface lives at. Fallback: `"IBM Plex Sans", "Helvetica Neue", Arial, sans-serif`. It is deliberately not Inter. SIL Open Font License.

**IBM Plex Mono** carries anything that is a *measurement*: absolute dates ("Sep 18"), times, subtask counts ("1/3"), progress percentages, usage ("12 of 100"), and keyboard shortcuts. Tabular figures are on (`'tnum' 1`), so counts and dates align down a column. Relative words stay in Plex Sans ("Tomorrow", "Yesterday"). Fallback: `"IBM Plex Mono", ui-monospace, SFMono-Regular, monospace`.

The scale is dense-UI (≈ 1.2) from 11px to 18px, then deliberately broken at the top: the jump from 14px body to a 40px display is a *jump*, which is what makes Today feel like a page rather than a list. Tracking is optical: −0.02em at display, −0.01 to −0.015em at headlines, 0 at body, +0.08em on uppercase labels (with the `case` feature on). Line height moves inversely to size: 1.1 at display, 1.5 at UI body, 1.65 in note prose.

Only two weights exist: **400 and 600**. There is no 500 anywhere. Hierarchy comes from family, size and color first; weight is the accent. A task title (14px, on-surface) reads stronger than its metadata (12–13px mono or sans in secondary) through size and ink, not boldness. The one deliberate weight change is the active nav item, which goes to 600, so the active state is never conveyed by color alone.

Mobile rules: all form inputs are **16px** (so iOS does not zoom on focus), and body-lg replaces body-md in list rows at ≤ 767px. Note and body prose is capped at **68 characters (≈ 760px at 18px)**; task lists are capped by `content-max`, not by measure.

## Layout

**Structure follows content.** Dayboard is a working tool, so the shell is the standard three zones (sidebar, main, optional context panel), never a marketing template.

- **Sidebar 240px** on the `neutral` ground: Today, Inbox, Tasks, Notes, Projects, Search, Trash, Settings, with Quick Capture and Create actions above. At 768–1023px it collapses into a sheet. Below 768px it disappears in favor of a bottom nav (Today, Tasks, Notes, Inbox, More) at 56px plus the safe-area inset, and content is padded so the nav never covers it.
- **Main** is **flush-left** with a `content-max` of 880px, and the space to its right is left open for the task-detail sheet (480px) at ≥ 1024px. Content is asymmetric on purpose: when the sheet is closed the right margin is simply quiet; when open, the list stays put and the sheet enters. Centered layouts appear nowhere in the app, with one exception: authentication screens are a single ~400px column centered on the viewport, with text still flush-left inside it.
- **Note editor** is a full page on every screen size, with a single column of `editor-measure` (760px), left-aligned within the main area at ≥ 1280px and full width minus margins below.
- **Top bar 48px:** global search/command trigger (shows the `⌘K` kbd), Quick Capture, account. It is a rule and a row, not a bar with a background fill.

**Spacing runs on a strict 4px base** (`xs 4 · sm 8 · md 12 · lg 16 · xl 24 · 2xl 32 · 3xl 48`). Nothing sits off the scale. Outer margin is 32px on desktop and 16px on mobile.

**Density is intentionally uneven, and that contrast is the primary wayfinding cue.**

- *Index views* (Tasks, Todos, Inbox, Notes list, Trash, Search results) are tight: rows are **36px** on desktop, and **44px** at ≤ 767px for touch. Related rows sit flush with a hairline between; groups are separated by 32px.
- *Record views* (Today's header, a note, a task's detail, a project's summary) are generous: 24–48px around blocks, serif headings, and room to read.
- *Section rhythm varies:* things that belong together sit 8px apart; unrelated groups sit 32–48px apart. Never apply one uniform section gap.

**Breakpoints** (Tailwind): mobile < 768, tablet 768–1023, desktop ≥ 1024, wide ≥ 1280. Design mobile-first; the app must be fully usable at **360px**. Tap targets are ≥ 44px wherever a finger is the input; nothing critical depends on hover.

## Elevation & Depth

Dayboard is **flat by default**. Static content never has a shadow, a card outline or a gradient.

Depth is carried by three devices, in this order of preference:

1. **Space.** Most depth problems are grouping problems. Solve them with the spacing scale first.
2. **Hairline rules.** 1px in `border`, used to *divide* rows and sections, not to wrap content into boxes. Rules run between rows; they do not enclose them.
3. **Tonal layering.** The paper ladder: `neutral` (ground) < `surface` (page) < `raised` (floating sheet). In dark the ladder rises the same way (`dark-neutral` < `dark-surface` < `dark-raised` < `dark-overlay`), and *lighter means higher* in both themes.

**Floating layers are the only things that cast a shadow**: dialogs, popovers, the command menu, the task sheet, toasts. In light mode they use one warm, two-part shadow with a top-down light (no x-offset): `0 1px 2px rgb(34 29 24 / 0.10), 0 8px 24px -4px rgb(34 29 24 / 0.14)`. The color is sampled from `on-surface`, never neutral black. In dark mode there is **no shadow**; floating layers separate by being one step lighter plus a 1px `dark-border` rule. Dialogs sit over a `scrim`; the desktop task sheet uses a lighter scrim so the list stays legible. Static cards, rows, chips and panels never get a shadow.

There is no glassmorphism, no backdrop blur, no glow, no gradient anywhere in the product.

## Shapes

The shape language is **cut paper**: small, hierarchical radii. A single radius applied everywhere is a tell, so each class of object gets its own.

- `sm` **3px**: checkboxes (tasks), chips, tag badges, kbd hints, due chips.
- `md` **6px**: buttons, inputs, nav items, row hover and selected backgrounds, AI panel, banners, toasts.
- `lg` **10px**: floating surfaces only: dialogs, command menu, popovers.
- `full`: only avatars, tag/project dots, progress bars, and **todo checkboxes**.
- `none`: the docked edge of the desktop task sheet.

**Task vs. Todo is legible from shape alone.** A Task's checkbox is a *square* (3px radius): a structured item with weight. A Todo's checkbox is a *circle*: a lightweight tick-off. This is the same distinction the product makes in data, made visible without a label.

Borders are 1px. Control boundaries (inputs, unchecked checkbox strokes) use `outline` (3:1); dividers use `border`. Focus is a **2px ring in `primary`, offset 2px**, on every interactive element, clearing 3:1 on paper and on dark surfaces. Because the component schema has no `borderColor` sub-token, these border values live here and are normative.

## Motion & Interaction

Motion has three jobs: confirm an action, explain a spatial relationship, show that something is arriving. It is never decoration.

- **Durations:** `fast 120ms` for state changes (hover, check, focus), `medium 200ms` for surfaces entering (dialogs, sheets, command menu, list insertion), `slow 300ms` at most for full-page or sheet transitions.
- **Easing:** entering surfaces decelerate `cubic-bezier(0.2, 0, 0, 1)`; leaving surfaces accelerate `cubic-bezier(0.4, 0, 1, 1)`. No springs, no overshoot, no bounce.
- **Task completion:** the checkbox fills instantly; the title's strike-through and dim transition in `fast`. The row does **not** reflow or jump while the 5-second Undo toast is live. The result of an action is always visible before the interface moves.
- **AI output** streams progressively as plain text. A "Generating" state is a static tonal band (`neutral`→`hover`) with a slow 1.4s shimmer that stops under reduced motion.
- **What does not animate:** page-to-page navigation, autosave state changes (text swaps only), list re-sorts after refresh, any scroll-triggered reveal, hover color on rows (instant), and anything the user is trying to read. Fade-up-on-scroll is banned.
- `prefers-reduced-motion` reduces every transition to an instant state change or a simple opacity fade.

Keyboard is a design surface, not an afterthought. Shortcuts are visible where they apply, as small `kbd` chips in the command menu, tooltips and menus. Global single-key shortcuts (`N`, `T`, `C`, `Shift+N`) are disabled while typing. `⌘K` opens the one menu that does Search, Ask and Create.

## Components

**Iconography.** Lucide only, at **16px with 1.5px stroke** (not the default 2px), optically aligned to the 14px text baseline; 20px in the mobile bottom nav. Icons in buttons and rows are outlined and monochrome in the text color of their row. Every icon-only button has an accessible name. There is no icon-in-a-tinted-square anywhere. The system never uses emoji as an icon.

**Emoji on items.** Tasks, todos and notes may carry one *user-chosen* emoji before the title. It is content, not chrome: rendered at 1em, `aria-hidden`, followed by 8px, and it can be removed. Do not add emoji anywhere the user did not choose one.

**Buttons.** One Primary button per view region, in `primary` with `surface` text, `label-md`, 32px tall (44px on touch), 6px radius, 16px horizontal padding, sentence-case ("Save to Inbox", not "SAVE"). Secondary sits on `neutral` with `on-surface` text. Ghost is text-only in `secondary` and takes a `hover` fill on hover. Destructive is `error` fill and appears **only inside a confirm dialog or an overflow menu**, never beside Complete. There is no fourth level: if a screen needs one, it has too many actions. Hover darkens or lightens the fill one step; there is no lift, scale or shadow.

**Task row (`TaskRow`)** is the most-repeated object in the app and must be one shared component. Left to right: square checkbox (18px, with a 36px hit area), emoji + title (`body-md`, on-surface; truncates to one line), then optional metadata pushed to the right: due chip, priority glyph, subtask count ("1/3", `data-sm`), project marker (dot + name), one tag badge. Metadata is progressive: default lists show only what exists, never empty placeholders. Hover or focus reveals the overflow menu; on touch the overflow is always visible. Click the checkbox to complete, click the title to open detail. A completed row keeps its place, dims to `secondary`, and strikes the title through. Overdue is `due-chip-overdue`: `error` text on `error-subtle` **with a clock icon and the date**, never color alone.

**Priority** is never color alone: a three-bar glyph with 1, 2 or 3 bars filled for Low, Medium and High, in `secondary` (High in `on-surface`), plus the word in detail views. `None` renders nothing in a list.

**Todo row (`TodoRow`)** is a *circular* checkbox, emoji, title, optional due chip, overflow. Nothing else. No subtasks, priority, tags or description, because Todos do not have them.

**Tags and projects.** `TagBadge` is a 13px name on `neutral` with an 8px `tag-*` dot; the name is always visible. `ProjectCard` is a hairline-divided row, not a card: dot, name, open-task count in mono, and a 4px progress bar (`progress-track` + `progress-fill`) with a `data-sm` percentage. A project with no items shows "No items yet", never "0%".

**Inputs.** `surface` fill, 1px `outline` boundary, 6px radius, 36px tall, `body-md` (16px on touch). Focus swaps the boundary for the `primary` ring. Error switches the message to `error` **with an icon and a written message**, and the field's `aria-live` region announces it. The inline "Add task" row at the top of a list is borderless with a bottom hairline that becomes `primary` on focus; Enter creates and keeps focus for the next one.

**Command menu (`CommandMenu`).** `raised` panel, 10px radius, 640px wide, placed at about 15% from the viewport top; full-screen sheet on mobile. A single 44px input, then text tabs **Search · Ask · Create** (the active tab is `on-surface` with a 2px `primary` underline; `Tab` cycles). Results are grouped by type with `label-caps` group headings; each shows emoji, title, project marker. The first row when typing is always *Capture "…" to Inbox*, with a `kbd` hint for `⌘↵`. The highlighted result uses `primary-subtle`.

**Sheets and dialogs.** Task detail is a right-docked sheet (480px, `raised`, square docked edge) at ≥ 1024px, and a full page below. Dialogs (`dialog`, 440px, 10px radius) are only for: confirming a destructive action, a small focused form, or AI confirmation before creating several records. Never nest dialogs; never put the whole app in a modal.

**Feedback.** Toasts are the one inversion: `on-surface` fill with `surface` text, bottom-left, short, with an Undo action where feasible. Success toasts appear for user-initiated actions only, **never for autosave**. Tooltips use the same inversion, with a 150ms delay in and none out. In dark mode both invert the other way: `dark-on-surface` fill with `dark-surface` text.

**Empty states** are compact, flush-left, and guide action: a `headline-sm` line, one sentence in `secondary`, and one or two buttons ("Your day is clear. Capture a task or start a note. [New task] [New note]"). No illustration.

### Screen recipes

**Today.** Header: greeting in `display` ("Good evening, Ayush"), the date beneath in `body-lg` `secondary`. Then the **Focus** slot: a `focus-panel` (the one deliberate tonal panel in the app), a `label-caps` "FOCUS" label, the focused task in `headline-md`, and *Change focus* / *Clear* as ghost buttons. Empty: "Pick one thing to focus on." Then, in order: Overdue, Today (then "Scheduled later today"), Todos, Needs planning, Recently updated notes, Completed today (collapsed), each preceded by a `label-caps` header with its mono count (`OVERDUE  2`) and a hairline. Never show every task; each section is capped, with "Show all" links in `primary`. The optional AI line sits below the sections as one quiet sentence, and renders nothing when AI is off. Today must be fully useful without it.

**Tasks / Todos.** A page title, a two-option segmented control **Tasks | Todos** (text tabs, active in `on-surface` with a `primary` underline), a filter row, the inline add row, then groups: Overdue, Today, Upcoming, No date, Completed (collapsed).

**Task detail.** Emoji picker + inline-editable title in `headline-lg`; a single row of status / priority / due / start / repeat / project as ghost-button pickers; Subtasks (one level, inline add); Details (the compact rich-text editor); Related notes as note chips; AI actions as ordinary ghost buttons. Overflow (⋯) holds archive and move to Trash.

**Note editor.** Full page. Header: back or project breadcrumb, save state, "Linked tasks", overflow. Title in `note-title` with the emoji before it; body in `note-body`, 760px measure. A compact formatting toolbar on desktop plus a selection bubble menu; on mobile a horizontally scrollable bottom toolbar above the keyboard. Checklists use square checkboxes; code blocks use IBM Plex Mono on `neutral`; blockquotes get a 2px `border` rule on the left. **Save state** is text only: "Saving…" in `secondary`, "Saved" with a small `success` check that fades after 2s, "Not saved, retrying" in `warning` with an icon. The conflict banner ("This note changed in another window. Load latest / Keep mine") is `banner-conflict` and never blocks typing.

**Projects.** List grouped by status (Active, On hold, Completed; Archived collapsed) as hairline rows. Project detail: editable name and description, progress, then Open tasks, Open todos, Notes, Completed (collapsed), with quick-add for each.

**Inbox.** A single textarea at the top, then open items newest first: text, relative time, and `Convert ▾ / Archive / Delete`. An AI suggestion is a single quiet line beneath the item ("Looks like a task: 'Prepare client call notes'  Create task · Create note · Dismiss"). Converted items collapse under "Recently converted".

**Search and Ask.** Grouped results with `<mark>` snippets rendered as text. In Ask mode the answer streams as plain prose; sources follow as a "Sources" list of `ai-source-link`s. Text quoted directly from the user's own records is set as a blockquote and labelled **From your workspace**; anything synthesized is plain and labelled **AI-generated**. Never invent a source.

**AI panels (`ai-panel`).** A `neutral` block, 6px radius, no border, no icon. States are Ready, Generating, Complete, Failed with **Retry**. It never blocks the page. Anything the AI proposes to create or change is shown as an editable preview in a dialog or inline list, and nothing is written until the user clicks the confirming button ("Create 3 tasks").

**Trash.** Type icon and label, emoji + title, deleted date in mono, **Restore**, overflow → *Delete permanently*, which opens a destructive confirm dialog ("This can't be undone").

**Settings.** Sections as a quiet left list on desktop: Account, Appearance, Productivity, AI, Tags, Danger zone. Danger zone is its own section at the bottom, separated by a hairline and 48px, with the destructive button inside a confirm dialog that requires typing `DELETE`. It is never styled as a banner.

**Authentication.** A single ~400px column: name of the product in `headline-lg`, OAuth buttons (Google, GitHub) as full-width secondary buttons above an "or" hairline divider, then the email form, then the magic-link option. Labels above fields, inline errors, submit disabled while pending. Copy never reveals whether an email exists. **Onboarding** is one screen in the same column: confirm name, timezone (pre-filled), and theme (Light / Dark / System as a three-option segmented control), then a single Primary "Continue".

## Do's and Don'ts

- **Do** reserve ink blue (`primary`) for things that respond to the user: buttons, links, the checked state, the focus ring, the active nav item, progress. **Don't** use it on headings, decorative rules, icons that do nothing, or as a brand wash. Accent covers under 5% of any screen.
- **Don't** add a second accent, a gradient, a glow, glassmorphism or a drop shadow on anything that is not a floating layer. Depth comes from space, hairlines and the paper ladder.
- **Don't** wrap content in a card by default. A list of tasks is a list with hairlines between rows. The only panels in the app are the Today focus slot, the AI panel, and dialogs.
- **Do** keep task titles visually stronger than their metadata by size and ink (`on-surface` vs `secondary`), not by adding bold. **Don't** introduce a third font weight; there is no 500.
- **Do** set every date, time, count, percentage, usage figure and shortcut in IBM Plex Mono with tabular figures. **Don't** set numbers in Newsreader or IBM Plex Sans inside columns.
- **Do** use Newsreader for greetings, page and section titles, dialog titles and all note prose. **Don't** use it for buttons, labels, task titles or metadata.
- **Do** pair every status with an icon or word: overdue = clock icon + date + `error`; priority = bar glyph + label in detail; tag = dot + name; error = icon + message. **Don't** communicate priority, status or project by color alone.
- **Do** make Task checkboxes square and Todo checkboxes circular, everywhere. **Don't** mix the two shapes or use a round checkbox on a Task.
- **Do** keep the AI unremarkable: a normal ghost button with a verb ("Break into subtasks"), output in a `neutral` panel with an "AI-generated" label, and a required confirm before any change is saved. **Don't** add sparkle glyphs, ✨, gradient buttons, animated "thinking" mascots or an AI badge on every screen.
- **Don't** place a destructive action next to a primary one. Destructive buttons live in overflow menus and confirm dialogs, and every deletion offers Undo or a Trash.
- **Do** cap prose at 68 characters and left-align everything. **Don't** center text, except that the auth column itself sits centered on the viewport.
- **Do** keep index views tight (36px rows, 44px on touch) and record views generous. **Don't** apply one uniform density or one uniform section gap across a page.
- **Do** honor `prefers-reduced-motion` and keep motion to 120/200/300ms decelerate-in, accelerate-out. **Don't** add bounce, springs, fade-up-on-scroll, or any animation on autosave, hover color or page navigation.
- **Don't** use pure `#FFFFFF` or `#000000`, navy dark backgrounds, or untinted greys (`R = G = B`) in any theme. Every neutral carries the paper/ink tint.
- **Do** write like a person: "Move to tomorrow", "Create 3 tasks", "Saved", "Retry". **Don't** leak technical language ("mutation failed", "entity not found", "invoke AI") into any user-facing string, and **don't** show a success toast for routine autosave.
- **Do** design for 360px first, keep tap targets ≥ 44px, and let sheets become full pages on small screens. **Don't** rely on hover for anything essential, and **don't** nest modal dialogs.
