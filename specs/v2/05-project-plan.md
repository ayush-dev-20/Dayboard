# V2 Implementation Plan — PWA, Sync, Search, Calendar, and AI

## 1. Build order

V2 should be implemented in vertical slices:

```text
Schema foundation
  -> PWA shell
  -> Local persistence
  -> Sync engine
  -> Attachments
  -> Semantic search
  -> AI workspace
  -> Calendar
  -> Voice capture
  -> Push notifications
  -> Weekly review
  -> Production worker/deployment
```

## 2. Phase 1 — PWA foundation

- service worker
- manifest
- icons
- install UX
- cache strategy
- offline route behavior

Definition of done:

- app installs
- app launches offline after first successful load
- updates do not leave the user on a broken version

## 3. Phase 2 — Local persistence

Implement Dexie-backed repositories for tasks and notes.

Definition of done:

- task creation works offline
- note editing works offline
- refresh does not lose local changes

## 4. Phase 3 — Sync engine

Implement:

- operation queue
- retry
- backoff
- acknowledgements
- conflict records
- manual retry UI

Definition of done:

- offline changes reach the server after reconnect
- duplicate mutations are idempotent
- conflicts are recoverable

## 5. Phase 4 — File storage

- attachment model
- upload intent
- signed upload
- finalization
- download authorization

Definition of done:

- authorized upload/download works
- unauthorized users cannot access another user's attachment

## 6. Phase 5 — Semantic search

- embedding schema
- worker jobs
- indexing
- hybrid ranking
- search UI

Definition of done:

- semantic query can find a related note without exact keyword match
- source links are returned

## 7. Phase 6 — AI assistant

Implement in order:

1. note summarization
2. action extraction
3. grounded workspace Q&A
4. suggested task creation
5. daily planning
6. weekly review

Definition of done:

- AI never accesses data outside the authenticated workspace
- mutations require confirmation
- failures degrade gracefully

## 8. Phase 7 — Calendar

- OAuth connection
- calendar read
- Today integration
- AI availability window
- create event after confirmation

## 9. Phase 8 — Voice

- browser recording
- upload
- transcription
- structured parsing
- confirmation

## 10. Phase 9 — Push notifications

- subscription management
- reminder scheduler
- permission UX
- revoke device

## 11. Phase 10 — Production worker

- worker container
- job retries
- heartbeat
- observability
- deployment pipeline

## 12. V2 definition of done

Product:

- PWA install works
- task/note editing works offline
- sync is reliable and recoverable
- semantic search is useful
- calendar integration is functional
- file attachments work
- voice capture works
- weekly review works

Engineering:

- CI passes
- Docker production build passes
- worker runs independently
- backups/restores are documented and tested
- rollback is documented and tested
