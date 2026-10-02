# Making Dayboard look like an industry-standard SaaS app

**Date:** 2026-10-02
**Status:** Research and recommendation. Nothing in the code has been changed yet.
**Question:** How do we make the UI prettier and more modern, add good animation, and make Dayboard feel like a real SaaS product that other people could pay for? How do the best apps do it, and how are they using AI?

## The short answer

Dayboard is already **clean, consistent and accessible**, and the built screens match the original designs. What it lacks is the **polish and personality** that make a product feel "premium": depth, motion, a confident first impression, and AI that is woven into the screens.

The recommended plan, in one line each:

1. **Decide how far to go** (the current `DESIGN.md` forbids several things a "modern SaaS" look needs). Recommended: keep the warm paper look and ink-blue accent, but loosen the rules on depth and motion.
2. **Fix the foundation first**: colors, type, spacing, shadows.
3. **Fix the layout**: use the empty space, calmer sidebar, richer Today screen.
4. **Add purposeful motion** with the Motion library (already in the approved stack, not yet installed).
5. **Build AI the modern way** (inline, in the command menu, with previews), not as a chat box.
6. **Add the "SaaS wrapper"**: landing page, better sign-in, onboarding, empty states.
7. **Check quality** with screenshots, accessibility and reduced-motion tests.

Work one screen at a time, starting with **Today**.

---

## 1. What the app looks like today

I signed in as the demo user and captured the real app at desktop (1440px), dark mode, and phone (390px). I also rendered the original mockup (`designs/Today_and_Inbox.html`) and compared it. Screenshots were taken from a local dev server with demo data, so they are not committed here.

### What is already good

- **Consistent and tidy.** Same header, same row style, same chips everywhere. This is the hard part, and it's done.
- **Matches the design.** The built Today page follows the mockup closely.
- **Dark mode works.** Warm charcoal, readable, not an afterthought.
- **Mobile works.** Bottom nav, bigger tap targets, nothing broken at 390px.
- **Accessibility basics are solid** (contrast checked, focus rings, labels).

### Why it doesn't yet feel like a modern SaaS app

| #   | What I saw                                                                                                                                                                                            | Why it matters                                                                                               |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| 1   | **Flat and low-energy.** One beige tone, almost no depth, no moment that says "this is a quality product".                                                                                            | First impressions are formed in seconds. Today looks like a well-made document, not a product.               |
| 2   | **Wasted space.** The content column stops at 880px and sits on the left. On a 1440px screen about 40% of the width on the right is empty.                                                            | It looks unfinished on wide screens, and it's where a SaaS app would show a summary, calendar or side panel. |
| 3   | **Too much red.** Five red "overdue" pills show at once on Today.                                                                                                                                     | When everything is alarming, nothing is. Linear and Things keep alarm color for the one thing that needs it. |
| 4   | **Projects and Notes pages are sparse.** Projects are thin rows with 0% bars; Notes is three lines and a big empty page.                                                                              | Feels like a table, not a workspace. No preview, no visual identity per project.                             |
| 5   | **The "Focus" box is inert.** A grey panel saying "Pick one thing to focus on."                                                                                                                       | This is meant to be the emotional centre of Today. It currently looks like an empty form field.              |
| 6   | **Sign-in is plain.** A single column on a blank page, no brand, no sense of what the product does. There is also **no landing page**: the home URL just redirects to `/today`.                       | A SaaS needs a front door. Visitors who aren't signed in see nothing about the product.                      |
| 7   | **Motion is minimal.** Only short hover and fade transitions (120ms and 200ms). No list animations, no satisfying "task done" moment, no page transitions. The `motion` library is not installed yet. | Motion is a big part of how "polished" an app feels.                                                         |
| 8   | **Fonts have drifted from the design.** The app uses Inter everywhere (ADR 0003), but the mockups and `DESIGN.md` still show the serif Newsreader headings.                                           | Two sources of truth disagree. Pick one.                                                                     |
| 9   | **AI is not visible yet.** Feature 05 isn't built. The AI line on Today is a plain grey box labelled "AI-generated".                                                                                  | AI is the main differentiator for a new productivity app in 2026.                                            |

_One thing that looks like a bug but isn't:_ the round black "N" button at the bottom-left of the screenshots is Next.js's development indicator. It does not appear in a production build.

---

## 2. What the best apps are doing

### Linear (the benchmark for "calm, fast, modern")

- **March 2026 refresh.** Linear describes it as "a calmer, more consistent interface." Concretely: headers, navigation and view controls are the same across every area; icons were redrawn and resized; and the **sidebar is slightly dimmer so the main content stands out**. ([changelog](https://linear.app/changelog/2026-03-12-ui-refresh))
- **Earlier redesign (2024), the design thinking behind it.** They replaced HSL with the **LCH color space** (so equal lightness steps look equal) and cut each theme from **98 variables to 3**: a base color, an accent color and a contrast level. They used **Inter Display for headings** and regular Inter for body, aligned labels and icons obsessively, made text and neutral icons slightly darker (light mode) or lighter (dark mode), and reduced visual noise while increasing density. The whole refresh took about six weeks, with a designer and engineer pairing each afternoon. ([Linear: how we redesigned the UI](https://linear.app/now/how-we-redesigned-the-linear-ui))
- **On AI.** Linear says a chat box is "a very weak and generic form" for AI and that it doesn't fit into existing workflows. Their model is a **workbench**: AI works _inside_ a purpose-built interface, with humans reviewing and approving the output. ([Linear: Design for the AI age](https://linear.app/now/design-for-the-ai-age)) In 2026 their AI features are spread through the product (automatic triage, semantic search, assigning work to agents) rather than being one assistant. ([summary](https://www.eesel.ai/blog/linear-ai))

### How AI shows up in good SaaS products (2026 patterns)

From industry write-ups (these are agency and trade blogs, so treat them as trend summaries, not hard evidence):

- **AI as infrastructure, not a feature.** Suggestions appear inline where you're working, content is auto-classified when you save, and natural-language commands replace complicated filter screens. AI drafts are **starting points**, not finished outputs. ([Orbix](https://www.orbix.studio/blogs/ai-driven-ux-patterns-saas))
- **Contextual help**, such as Figma noticing you're stuck, and **content tools**, such as Notion AI writing and transforming text in place. ([same source](https://www.orbix.studio/blogs/ai-driven-ux-patterns-saas))
- **Progressive disclosure.** Show the one thing that answers "is everything okay?" first; keep power features hidden until needed. ([SaaS UI trends](https://www.saasui.design/blog/7-saas-ui-design-trends-2026))

**What this means for Dayboard:** the spec already follows the right idea (AI inside Today, Inbox, tasks and notes, with confirmation before anything changes). The gap is that it should _feel_ integrated and alive, not like grey boxes.

### Motion: what "good animation" means in 2026

- The consensus is "**micro-delight**": small, purposeful animations that confirm actions, guide attention, and show new content arriving. Not decoration. ([trend roundup](https://www.designstudiouiux.com/blog/top-saas-design-trends/))
- **Springs for things you touch** (dragging, resizing, a sheet opening) because they carry momentum and can be interrupted smoothly. **Timed tweens for state changes** where exact timing matters. ([guide](https://dev.to/bishopz/motion-motionreact-in-production-layout-animations-and-accessible-motion-patterns-16ln))
- **Animate only `transform` and `opacity`** for smoothness. Avoid animating large containers that re-render often, and be careful in long lists. ([guide](https://www.pkgpulse.com/guides/best-react-animation-libraries-2026))
- **Reduced motion is built in.** In Motion, `<MotionConfig reducedMotion="user">` automatically turns off movement and layout animation for people who ask for less motion, while keeping gentle fades. ([Motion docs](https://motion.dev/docs/react-accessibility))
- Motion's layout animations handle the hard cases (items reordering, appearing and disappearing in a list) well. That fits a task list perfectly.

### Task apps specifically (Todoist, Things)

Todoist is praised for details: it even tweaked its dark theme so its empty-state animations "blend seamlessly instead of looking like they're floating in the void." Things 3 wins on clarity and intentional design. Both polish with small touches, not big redesigns. ([Todoist 2026 changelog](https://www.todoist.com/help/todoist/product-updates/2026-changelog-HD3jJAtLd), [comparison](https://www.morgen.so/blog-posts/todoist-vs-things-3))

### Using AI to do the redesign itself

- **Claude Design** (launched April 2026) makes designs and prototypes from a conversation and inline comments. **Figma Make** and **v0** do similar things. Figma also has a two-way link with Claude Code (design to code, and running UI back into editable Figma layers). ([overview](https://www.geeky-gadgets.com/claude-design-ai-tool-review/), [Figma + Claude](https://www.xda-developers.com/connected-claude-to-figma-improved-design-workflow/))
- **Animated, copy-paste component sets** (Magic UI, Motion Primitives) are built on Tailwind and Motion and follow the shadcn "copy the code in" approach. ([comparison](https://www.pkgpulse.com/guides/aceternity-ui-vs-magic-ui-vs-shadcn-animated-react-2026)) Many of their effects are marketing-style (neon gradients, glowing grids) and **don't suit a calm productivity app**, so use them sparingly, mostly for the landing page.

**What I could not do:** I could not open Notion, Superhuman or Things directly, so claims about them come only from the sources above. I also couldn't open the full Linear 2024 article beyond the extracted points.

---

## 3. A decision to make first: the design rules conflict with "modern SaaS"

`DESIGN.md` is very deliberate, and several of its rules directly block what you're asking for:

| Current rule in DESIGN.md                                   | What "modern SaaS" usually wants                       |
| ----------------------------------------------------------- | ------------------------------------------------------ |
| "Flat by default. No shadows on static content."            | Subtle depth on cards and panels                       |
| "No gradients, no glow, no glassmorphism."                  | Soft gradients on hero areas, glass on floating layers |
| "No bounce, no springs. Motion: 120/200/300ms tweens only." | Spring physics, list and layout animation              |
| "Don't wrap content in cards. Hairlines only."              | Cards for projects, notes, insights                    |
| "AI has no color, glyph or badge."                          | A recognizable, subtle AI identity                     |
| "Content flush-left, max 880px."                            | Uses the full screen, side panels                      |

The product spec (§13) and UI spec (§20) also say "avoid excessive gradients, aggressive animation, AI badges everywhere." So the spirit is **restrained**, which is good: modern doesn't have to mean loud (Linear is the proof).

### Three options

- **A. Polish inside the current rules.** Fix spacing, hierarchy, empty states and the red overload; add a little motion. _Lowest risk, smallest change; will still feel like "a nice document"._
- **B. Modern calm SaaS (recommended).** Keep the warm palette and ink-blue accent. Add soft layered depth, cards where they earn their place, spring and list motion, a richer Today, a recognizable but quiet AI style, and a real landing page. Update `DESIGN.md` to allow this. _Best balance of "premium" and "still calm"._
- **C. Full re-skin.** New palette, new brand, new fonts. _Biggest change and most time; only worth it if you want a different identity._

**Recommendation: B.** It needs an update to `DESIGN.md` and the UI spec (and an ADR in `docs/decisions/`), because agents are told to treat `DESIGN.md` as read-only unless you ask. Telling an agent to "update DESIGN.md for option B" is the authorization.

---

## 4. Step by step (in simple terms)

Do these in order. Each step leaves the app working.

### Step 0: Decide and write it down (about an hour)

1. Choose A, B or C above. (B is recommended.)
2. Decide the heading font: keep Inter everywhere, or use **Inter Display** for headings like Linear, or bring back the serif (Newsreader). Make `DESIGN.md`, the mockups and the code agree.
3. Update `DESIGN.md` and add an ADR (`docs/decisions/0004-...`) explaining what changed and why.

### Step 1: Fix the foundation (the colors, type and shadows everything else uses)

1. **Simplify the color system** the Linear way: a base, an accent and a contrast level, and derive the rest. This also makes future theming easy.
2. Add **two or three shadow levels** (soft, medium, floating) with a warm tint, plus a slightly bigger radius scale for cards and sheets.
3. Make **red rare**: show the overdue color only on the most overdue item or as small text, not five loud pills.
4. Tighten the type scale: bigger, more confident page titles; clearer gap between title, section label and row text.
5. Put all of this in the design tokens (`src/styles/globals.css`) so one change updates every screen.

### Step 2: Fix the layout and shell

1. **Use the width.** Center the content column on wide screens, or add a right-hand panel (day summary, calendar, upcoming).
2. **Dim the sidebar** slightly so the content stands out (Linear did exactly this), give it a collapse button, and group items (Workspace, Library).
3. Make **page headers identical** on every screen (title, count, actions in the same place).
4. Check icon size and alignment: icons and text on one baseline.

### Step 3: Rebuild the key screens, one at a time

1. **Today (first, because it's the emotional centre):** a bigger greeting, a _day progress_ element ("3 of 7 done"), a real Focus card that looks like a hero (large title, quick actions), and a calmer overdue section.
2. **Tasks:** richer hover state, quick actions on hover, subtle group headers, a satisfying completion moment (Step 4).
3. **Projects:** cards with a color header, a progress ring, "next task" preview and member/updated info.
4. **Notes:** list/grid toggle with a short preview of each note.
5. **Inbox, Search, Trash, Settings:** same header and spacing rules, friendly empty states.

### Step 4: Add motion (use the `motion` library, already in the approved stack)

1. Install `motion` and wrap the app in `<MotionConfig reducedMotion="user">` so reduced-motion users are respected automatically.
2. Define a small set of **motion tokens** in one place: quick (120ms), medium (200ms), plus one or two spring settings.
3. Add, in this order of value: **task complete** (checkbox fills, title strikes through, row eases away), **list add/remove/reorder** (layout animation), **side panel and dialogs** (spring in, quick out), **skeleton loaders** instead of blank loading, **page transitions** (subtle).
4. Only animate `transform` and `opacity`; test long lists (200+ tasks) for smoothness.
5. Keep "what does not animate": text the user is reading, autosave, and anything that would delay an action.

### Step 5: Do AI the modern way (this is feature 05, planned already)

1. **No chat sidebar.** Put AI where the work happens: a "Break into subtasks" button on a task, "Summarize" on a note, suggestions on Inbox items, and **Ask** inside the ⌘K menu.
2. Show AI output as a **preview you accept or reject** (a clear "Add 3 subtasks" button), streamed as it's written. This already matches your spec and Linear's "humans stay in the loop".
3. Give AI a **recognizable but quiet style** (a small consistent marker and soft tint), so users can tell what's AI-written without it shouting.
4. Make the **Today AI line** feel alive: one sentence plus one helpful action ("Reschedule overdue tasks").

### Step 6: Add the "SaaS wrapper" so it can be used as a product

1. **Landing page** at `/`: what Dayboard is, a product screenshot, how it works, and a sign-up button. (Today `/` just redirects.)
2. **Better sign-in and sign-up:** split layout with a product preview on one side, trust line, social buttons first.
3. **Onboarding:** a short checklist ("Create your first task", "Capture a thought", "Try ⌘K") and optional sample data, so a new user never sees a blank app.
4. **Empty states** with a small illustration or animation, plus a clear action.
5. Smaller things people notice: favicon and share image, a nicer 404 page, styled emails, "Help" and "Keyboard shortcuts" in one place.
6. **Pricing and billing** are explicitly _out of scope for V1_ (they belong to V3). Build the pages so a pricing section can be added later.

### Step 7: Check quality before calling it done

1. Take **screenshots of every screen** (desktop, dark, phone) before and after, and compare. Playwright is already set up; I did this for this research.
2. Run **contrast** checks on any new color, and test **reduced motion**.
3. Check **360px** phone width and keyboard use.
4. Run the existing automated tests (`pnpm test`, `pnpm test:integration`, `pnpm test:e2e`) so the redesign doesn't break behavior.

### Step 8: Use AI tools to speed up the design work

1. **Explore in Claude Design** (or Figma Make or v0): ask for 2 or 3 versions of the Today screen using your tokens. Pick one.
2. Hand the chosen version to **Claude Code** to build in the real app, one screen at a time, checking against screenshots after each change.
3. Keep `DESIGN.md` as the single source of truth and update it as decisions are made.
4. Note: connecting Claude Design to Claude Code here needs a one-time `/design-login` in an interactive terminal session (not possible from the extension).

---

## 5. Cautions

- **V1 scope.** Billing, teams and plans are listed as non-goals for V1. "SaaS-ready" in this plan means polish plus a front door, not payments.
- **Third-party animated libraries.** `CLAUDE.md` says shadcn/ui is the only component library. Copy-pasted snippets from Magic UI or Motion Primitives are not a library, but adopting them should still get an ADR, and most of their effects are too loud for this product.
- **Don't redesign everything at once.** Linear's own refresh was scoped to the "chrome" (navigation and headers) and done in about six weeks with tight designer and engineer pairing. A good first milestone for Dayboard is **shell + Today**.
- **Evidence quality.** Linear's own posts are primary sources. Trend articles on AI patterns and SaaS design are secondary and often marketing; I used them for direction only.

## 6. Questions for the owner

1. Which option: **A**, **B** (recommended) or **C**?
2. Heading font: Inter only, Inter Display, or the serif back?
3. Is a **landing page and onboarding** wanted in this round, or only the in-app screens?
4. Should AI have a **visible brand color**, or stay neutral?
5. Do you want to start with **Today and the shell** as the first milestone?

## Sources

- Linear: [UI refresh (March 2026)](https://linear.app/changelog/2026-03-12-ui-refresh), [How we redesigned the Linear UI (part II)](https://linear.app/now/how-we-redesigned-the-linear-ui), [Design for the AI age](https://linear.app/now/design-for-the-ai-age)
- [Linear AI features overview (eesel)](https://www.eesel.ai/blog/linear-ai)
- [10 AI UX patterns in SaaS (Orbix)](https://www.orbix.studio/blogs/ai-driven-ux-patterns-saas), [7 SaaS UI trends 2026](https://www.saasui.design/blog/7-saas-ui-design-trends-2026), [12 SaaS design trends 2026](https://www.designstudiouiux.com/blog/top-saas-design-trends/)
- Motion: [accessibility and reduced motion](https://motion.dev/docs/react-accessibility), [Motion in production](https://dev.to/bishopz/motion-motionreact-in-production-layout-animations-and-accessible-motion-patterns-16ln), [React animation libraries 2026](https://www.pkgpulse.com/guides/best-react-animation-libraries-2026)
- Task apps: [Todoist 2026 changelog](https://www.todoist.com/help/todoist/product-updates/2026-changelog-HD3jJAtLd), [Todoist vs Things 3](https://www.morgen.so/blog-posts/todoist-vs-things-3)
- AI design tools: [Claude Design review](https://www.geeky-gadgets.com/claude-design-ai-tool-review/), [Claude and Figma](https://www.xda-developers.com/connected-claude-to-figma-improved-design-workflow/)
- Animated components: [Aceternity vs Magic UI vs shadcn](https://www.pkgpulse.com/guides/aceternity-ui-vs-magic-ui-vs-shadcn-animated-react-2026)
- Project files reviewed: `DESIGN.md`, `designs/Today_and_Inbox.html`, `src/styles/globals.css`, `package.json`, `docs/decisions/0003-use-inter-everywhere.md`
