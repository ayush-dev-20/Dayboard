# V2 UI/UX Specification — Installable, Offline-First Workspace

## 1. Design goal

V2 should feel like a native productivity app even though it is still a web application.

Retain the V1 visual language:

- calm
- crisp
- keyboard-friendly
- low visual noise
- strong typography

Add:

- offline clarity
- sync feedback
- installability
- AI citations
- richer search
- calendar context

## 2. New navigation

Desktop:

```text
Today
Inbox
Tasks
Notes
Projects
Calendar
Search

----------------
AI Review
Settings
```

Mobile:

```text
Today | Inbox | Tasks | Notes | More
```

The AI assistant should not consume a permanent bottom-nav tab on mobile. Use a contextual action or command surface.

## 3. Offline indicator

Use a small status indicator:

- Online
- Offline
- Syncing
- Changes saved locally
- Sync issue

Do not use large warning banners unless data is genuinely at risk.

Example:

`✓ Saved locally`

then:

`↻ Syncing 3 changes`

## 4. Install experience

Provide a lightweight install card after the user has demonstrated value.

Example:

> Keep this workspace one tap away.
>
> Install the app for faster access and offline use.
>
> [Install] [Maybe later]

Do not show the install prompt immediately after login.

## 5. Search experience

Command palette/search overlay:

```text
Search your workspace...

⌘K

Recent

Semantic results
Tasks
Notes
Projects
```

Allow filters such as:

`type:note`
`project:ozzi`
`after:2026-08-01`
`status:open`

Natural-language search should also work.

## 6. AI citations

AI responses must show source chips:

`React Native Performance`  `Fix list rendering task`

Clicking a chip opens the original item.

Avoid long citation footnotes that resemble a research paper.

## 7. AI confirmation UX

When AI proposes changes:

```text
AI suggested 3 tasks

☐ Review API logs
☐ Update Jira
☐ Send report

[Create 3 tasks] [Edit]
```

Never hide destructive mutations behind a generic "Apply" button without preview.

## 8. Calendar UI

Today should optionally show:

```text
09:00  Team standup
10:00  Focus — API work
12:30  Lunch
14:00  Client call
```

Clearly distinguish calendar events from app-created task blocks.

## 9. Files UI

Attachment cards should show:

- file name
- file type
- size
- upload/sync state
- preview when supported
- download
- remove

Drag-and-drop is expected on desktop.

## 10. Voice capture UI

Mobile-first flow:

```text
[ Hold to record ]

00:17

Transcribing...

Detected:
Task: Review production logs
Due: Tomorrow, 10:00

[Save Task] [Save as Note] [Edit]
```

## 11. Weekly review UI

Provide a focused review page, not a dashboard full of charts.

Sections:

- What you completed
- What carried over
- Where time went
- What is blocked
- Suggested next focus

Charts should be limited to where they add insight.

## 12. Accessibility

V2 must retain:

- keyboard navigability
- visible focus states
- semantic controls
- reduced-motion support
- accessible labels
- screen-reader-friendly dialogs
- sufficient contrast

## 13. Responsive behavior

All core actions must remain usable at approximately 320px viewport width.

Offline, sync, AI, attachment, and calendar states must not break the primary task/note editing workflows.
