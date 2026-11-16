-- The daily prune of note snapshots (V3 feature 05): keeps the newest 30 per note. Runs in the worker or in tick mode.
INSERT INTO "job_schedules" ("name", "cron", "type", "payload", "queue", "enabled", "next_run_at") VALUES
	('maintenance.prune_note_snapshots', 'daily 03:30 UTC', 'maintenance.prune_note_snapshots', '{}'::jsonb, 'default', true, now())
ON CONFLICT ("name") DO NOTHING;
