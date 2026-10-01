# V2 Product Specification — Offline AI Personal Workspace

## 1. Product vision

V2 evolves the V1 task + notes product into an installable, resilient personal workspace that works across desktop and mobile browsers and remains useful with poor or no connectivity.

The product loop becomes:

`Capture -> Organize -> Understand -> Plan -> Execute -> Review`

V2 should make the user's workspace increasingly intelligent without making the AI the center of the UI.

## 2. V2 goals

1. Make the web app installable as a PWA.
2. Support offline creation/editing of tasks and notes.
3. Synchronize local changes safely when connectivity returns.
4. Add semantic search across tasks and notes.
5. Add an AI workspace assistant that can retrieve and cite relevant user content.
6. Add Google Calendar integration.
7. Add file and attachment support.
8. Add voice capture and transcription.
9. Add AI weekly review and personal planning.
10. Improve notifications and background processing.
11. Preserve the V1 Docker-first deployment model.

## 3. Explicit V2 non-goals

Do not implement yet:

- Team workspaces
- Real-time multi-user editing
- Public publishing/sharing
- Complex workflow automation
- Billing/subscriptions
- Native iOS/Android apps
- Enterprise SSO
- Full external integration marketplace
- Multi-region deployment
- End-to-end encrypted collaboration

## 4. PWA requirements

The app must be installable from a supported browser and have a service worker.

Capabilities:

- app manifest
- install prompt/education UI
- offline app shell
- offline task CRUD
- offline note CRUD
- offline completion/rescheduling
- sync queue
- sync status indicator
- retry failed sync operations
- conflict handling
- push notifications where supported
- update available prompt

The PWA should degrade gracefully if a browser does not support all capabilities.

## 5. Offline-first product behavior

Local state is authoritative while offline for user-initiated edits.

Every mutation must have a durable operation record containing:

- operation id
- entity type
- entity id
- operation type
- client timestamp
- client id/device id
- payload/version
- sync status
- server acknowledgement

The user should be able to continue working without seeing technical sync errors. Technical details belong in a sync diagnostics screen.

## 6. Semantic workspace search

Search should support:

- keyword search
- semantic search
- filters
- exact phrase search
- recent items
- task status filters
- project filters
- date filters

Examples:

> Find the notes where I discussed authentication problems.

> What tasks are related to OTP security?

> Show things I wrote about React Native performance last month.

Search results must link directly to the originating task/note.

## 7. AI workspace assistant

Add an AI assistant scoped to the authenticated workspace.

It should be able to:

- search notes and tasks
- summarize retrieved information
- answer questions grounded in workspace content
- extract action items
- propose task changes
- create tasks only after explicit confirmation
- suggest related notes/tasks
- explain why a result was retrieved

AI responses should cite links/references to the underlying workspace items.

Do not silently mutate user data during conversational answers.

## 8. Calendar integration

Initial integration: Google Calendar.

Capabilities:

- connect/disconnect account
- read calendar events
- show events in Today and planning views
- create an optional task time block
- optionally create calendar events from tasks after confirmation
- use calendar busy windows when AI builds a plan

Do not automatically move calendar events in V2.

## 9. Files and attachments

Users can attach files to notes/tasks/projects.

Initial supported categories:

- images
- PDF
- text files
- common office/document files as metadata + download attachments

Required behavior:

- upload progress
- retry
- file size validation
- secure object keys
- authorization checks on every download
- delete attachment
- attachment metadata

Object storage should be abstracted behind a storage service interface so storage can be changed later.

## 10. Voice capture

Mobile-first voice capture:

`Record -> Transcribe -> Review -> Create Task/Note`

AI should return structured results such as:

- transcript
- detected task
- due date if confidently mentioned
- people/project mentions
- suggested note title

Never create a high-impact task silently from speech. Show a confirmation step.

## 11. AI weekly review

A weekly review should summarize:

- completed tasks
- overdue/carry-forward items
- notes created
- projects with activity
- calendar load
- repeated postponements
- suggested focus areas

The review should distinguish observed facts from AI suggestions.

## 12. Smart notifications

Support:

- task reminders
- calendar-related task reminders
- sync failures
- AI weekly review availability
- overdue summaries

Provide notification preferences by category.

Never use push notifications as a growth mechanic in V2.

## 13. UX principles

- Offline status should be visible but quiet.
- Sync conflicts should be understandable.
- AI actions require confirmation when they mutate data.
- Search should be fast before it is fancy.
- The workspace must remain useful if the AI provider is unavailable.

## 14. V2 success criteria

A daily user should be able to:

1. Install the app.
2. Open it without a network connection.
3. Create/edit a task.
4. Create/edit a note.
5. Reconnect and see changes synchronize.
6. Search semantically for older information.
7. Connect a calendar.
8. Attach a file.
9. Speak a quick capture and convert it into an item.
10. Receive a meaningful weekly AI review.
