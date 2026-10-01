# V3 UI/UX Specification — Collaborative Personal Operating System

## 1. Design direction

V3 keeps the calm V1/V2 visual language but adds depth for collaboration and automation.

The interface must not turn into an enterprise admin panel.

## 2. Workspace switcher

Add a workspace/project context control:

```text
Personal
Work
Shared Projects
```

Keep personal content visually distinct from shared content.

## 3. Collaboration indicators

In shared notes show:

- collaborator avatars
- online presence
- typing/cursor indicators
- last edited information

Presence should be subtle and disappear when not useful.

## 4. Comments

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

## 5. Sharing flow

The share dialog should make permissions obvious:

```text
Share "Client Meeting Notes"

Ayush       Owner
Rahul       Editor
Neha        Viewer

[Copy link] [Done]
```

Never expose public links by default.

## 6. Automation builder

The builder should be visual but not overly complex.

```text
WHEN
Task completed

IF
Project is "OZZI"

THEN
Create note

AND
Send Slack notification
```

Each step should have a test/preview action.

## 7. Automation run history

Provide:

- status
- triggered time
- duration
- steps
- failures
- retries
- approval waits

Make failures actionable.

## 8. AI agent interaction

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

## 9. Approval UI

High-risk actions need a clear confirmation card:

```text
The AI wants to:

Send a message to Rahul
Create 2 tasks

[Review] [Approve] [Reject]
```

## 10. Integration center

Settings should include:

- connected apps
- permissions
- last successful sync
- disconnect
- reconnect
- webhook endpoints

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
- connected integrations

Allow one-click sign-out of other devices.

## 13. Mobile behavior

Collaboration, approvals, notifications, and voice capture should work on mobile.

Automation editing may be simplified on mobile but must remain inspectable.

## 14. Accessibility

Maintain WCAG-oriented keyboard, screen-reader, contrast, focus, and reduced-motion behaviors.

For real-time presence and AI streaming, provide accessible status announcements without excessive live-region noise.
