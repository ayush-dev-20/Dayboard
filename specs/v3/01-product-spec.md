# V3 Product Specification — Connected Personal Operating System

## 1. Product vision

V3 evolves the personal workspace into a connected operating system for personal work: tasks, notes, calendar, files, AI, integrations, collaboration, and automation all operate from one permissioned data model.

Core loop:

`Capture -> Understand -> Decide -> Plan -> Execute -> Automate -> Review`

V3 should feel like a mature product rather than a collection of features.

## 2. V3 goals

1. Support optional collaboration on selected spaces/projects.
2. Add real-time collaborative note editing.
3. Add controlled sharing and permissions.
4. Add automation/workflows.
5. Add integrations such as GitHub, Slack, email, and webhooks.
6. Add richer AI agents that can perform multi-step workflows with approval boundaries.
7. Add cross-device reliability and account/device management.
8. Add usage/admin observability required for a growing production product.
9. Prepare the architecture for billing without forcing monetization into the core UX.
10. Introduce scalable infrastructure patterns while preserving local Docker development.

## 3. Explicit V3 non-goals

Avoid in V3 unless product demand clearly requires them:

- generic enterprise ERP/project-management breadth
- dozens of low-value integrations
- unrestricted autonomous AI actions
- unrestricted public social/community features
- custom programming language or workflow engine
- multi-cloud deployment by default

## 4. Collaboration

Users can share a project or selected note with another authenticated user.

Roles:

- owner
- editor
- commenter
- viewer

Permissions must be explicit and inherited carefully.

Private items stay private by default.

## 5. Real-time editing

Selected notes should support collaborative editing with cursors/presence.

The collaboration system should be limited to note documents and comments, not every entity in the database.

## 6. Comments and mentions

Users can comment on notes/tasks and mention collaborators.

Capabilities:

- thread comments
- resolve comment
- mention user
- notification
- link to block/task

## 7. Automation

Users can define trigger/action workflows.

Example:

```text
Trigger: task moved to Done
        ↓
Condition: project = OZZI
        ↓
Action: create review note
        ↓
Action: notify Slack
```

Automation must show a human-readable preview before activation.

## 8. Integrations

Prioritize integrations that interact with the product's core model.

Potential V3 integrations:

- GitHub
- Slack
- Gmail/Outlook email
- generic webhooks
- calendar providers beyond Google

Do not create one-off logic for each provider. Build a common integration contract.

## 9. AI agent layer

V3 AI can perform multi-step operations, but actions must be bounded by permissions and user-defined approval settings.

Example:

> Prepare my Friday client meeting.

Agent may:

1. retrieve relevant notes
2. inspect open tasks
3. inspect calendar
4. draft a briefing note
5. propose preparation tasks
6. ask for approval before creating/updating items

High-impact actions such as sending messages, deleting records, or changing external systems require explicit approval.

## 10. Personal memory

The workspace may build a user-controlled memory layer from explicitly selected information.

Users should be able to:

- inspect memories
- edit memories
- delete memories
- disable memory categories
- see where a memory was learned from

Do not make memory opaque or irreversible.

## 11. Unified command center

One command bar should support:

- search
- navigation
- task creation
- note creation
- AI commands
- integration actions
- automation actions

The same command model should work on desktop and mobile.

## 12. Account/device management

Support:

- active sessions
- devices
- sign out other devices
- notification devices
- connected integrations
- AI provider settings where applicable

## 13. Billing readiness

Do not make billing a V3 user requirement.

Prepare for:

- entitlements
- usage limits
- feature flags
- plan metadata

Keep billing provider code isolated.

## 14. V3 success criteria

A mature daily user should be able to:

1. collaborate on a selected project/note,
2. discuss work through comments,
3. connect multiple external services,
4. automate repetitive actions,
5. ask AI to prepare multi-step work,
6. approve selected external mutations,
7. manage devices/integrations,
8. understand and control their stored AI memory.
