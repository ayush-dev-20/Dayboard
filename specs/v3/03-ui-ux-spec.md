# V3 UI/UX Specification — Collaborative Personal Operating System

## 1. Design direction

V3 keeps the calm V1/V2 visual language but adds depth for collaboration and automation.

The interface must not turn into an enterprise admin panel.

## 2. Canvas

The first V3 feature ([features/01-canvas-with-ai-diagrams.md](features/01-canvas-with-ai-diagrams.md) holds the full UI breakdown).

- **Canvases list** (`/canvases`): sidebar tab **Canvases** in the Library group (Notes, Journal, Canvases, Projects, Templates, Assistant) that folds like Projects and lists the latest five canvases, and a row in the phone's More page. Header with **New canvas** (primary) and **Draw with AI** (secondary, an ordinary button with a verb, no sparkle). A hairline list of emoji, title, project marker, element count and updated time; archived canvases collapse below. Empty state: "No canvases yet. Sketch an idea, or describe a system and let AI draw it."
- **Canvas page** (`/canvases/[id]`): the drawing fills the whole main area. A slim header holds back, editable title, save state text, project picker, **Draw with AI**, **Add note or task** (drops a card) and a `…` menu (Archive, Move to Trash, Export PNG, SVG or Excalidraw file, Outline). The drawing area keeps Excalidraw's own look and icons (an exception recorded in ADR 0017) and follows the app's light or dark theme.
- **Draw with AI dialog:** describe, drawing (with Stop), then a read-only preview with counts, any warnings, the line "AI-generated reference diagram. Check it before relying on it.", and **Create canvas**, **Regenerate**, **Discard** (**Add to this canvas** when launched from inside a canvas). Nothing is saved before Create.
- **Refine with AI:** one instruction, a summary of the change before it applies, new parts in an **Additions** frame beside the diagram, and **Arrange again** with Undo.
- **Outline:** a plain list of sections, boxes with their technology, and connections. It is the accessible route to a diagram's content because the drawing library's own screen reader support is limited.
- **Phone:** the list and the dialog work at 360 px; the canvas page supports touch pan, zoom and drawing but is for viewing and light edits.
- **Linked tasks:** a **Tasks** button with a count in the canvas header opens the tasks linked to the canvas (popover on desktop, bottom sheet on a phone) with a search to link another and an unlink control. The task detail has a **Canvases** section next to its linked notes.
- Cards for notes, tasks and projects open the item in the same tab. Canvases are private to their owner and show no collaborator or presence indicators.

## 3. Workspace switcher

Add a workspace/project context control:

```text
Personal
Work
Shared Projects
```

Keep personal content visually distinct from shared content.

## 4. Collaboration indicators

In shared notes show:

- collaborator avatars
- online presence
- typing/cursor indicators
- last edited information

Presence should be subtle and disappear when not useful.

## 5. Comments

Comments should attach to:

- note blocks
- task descriptions
- project items

Thread UI:

```text
Comment
  ├─ Reply
  ├─ Resolve
  └─ Mention
```

## 6. Sharing flow

The share dialog should make permissions obvious:

```text
Share "Client Meeting Notes"

Ayush       Owner
Rahul       Editor
Neha        Viewer

[Copy link] [Done]
```

Never expose public links by default.

## 7. Automation builder

The builder should be visual but not overly complex.

```text
WHEN
Task completed

IF
Project is "OZZI"

THEN
Create note
```

Each step should have a test/preview action.

## 8. Automation run history

Provide:

- status
- triggered time
- duration
- steps
- failures
- retries
- approval waits

Make failures actionable.

## 9. AI agent interaction

Do not present the agent as a blank chat page only.

Use an execution timeline:

```text
Preparing your Friday review

✓ Found 8 related notes
✓ Found 5 open tasks
✓ Checked calendar
→ Drafting briefing note

Waiting for approval

[Create briefing note + 3 tasks]
```

Users should be able to inspect what the agent did.

## 10. Approval UI

High-risk actions need a clear confirmation card:

```text
The AI wants to:

Archive 3 old notes
Create 2 tasks

[Review] [Approve] [Reject]
```

## 11. Memory center

A dedicated Memory page:

```text
What the app remembers

Preferred working hours
Primary project naming style
Important recurring contacts
...

Source: 3 notes

[Edit] [Forget]
```

Users should understand and control memory.

## 12. Account/device center

Display:

- current sessions
- recent devices
- push-enabled devices

Allow one-click sign-out of other devices.

## 13. Mobile behavior

Collaboration, approvals, notifications, voice capture, and the canvas list and AI dialog should work on mobile.

Automation editing may be simplified on mobile but must remain inspectable.

## 14. Accessibility

Maintain WCAG-oriented keyboard, screen-reader, contrast, focus, and reduced-motion behaviors.

The canvas Outline gives keyboard and screen-reader users the same content as the drawing, and the canvas works with reduced motion (the AI preview does not animate drawing in).

For real-time presence and AI streaming, provide accessible status announcements without excessive live-region noise.
