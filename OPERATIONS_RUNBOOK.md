# Linki Operations Runbook

Practical procedures for running Linki on the single 8 GB VPS. All commands assume the deploy directory `/opt/linki` and the compose service name `linki`.

Quick health commands used throughout:
```bash
docker compose ps
docker inspect --format '{{.State.Health.Status}}' $(docker compose ps -q linki)
curl -fsS "http://127.0.0.1:${PORT:-3456}/api/health?ready=1"
docker compose logs --tail=200 linki
docker stats --no-stream
df -h / ; free -h ; du -sh /opt/linki/data
```

## Application crash

Symptom: container exited or restarting; `/api/health` unreachable.
1. `docker compose ps` and `docker compose logs --tail=200 linki` to see the exit reason.
2. If the log shows an environment error (for example a missing `NEXTAUTH_SECRET`), fix `.env.local` and `docker compose up -d`. The app fails fast by design on missing required variables.
3. Otherwise `docker compose up -d` (restart policy `unless-stopped` will also auto-restart). Confirm `healthy` and readiness `db:up`.

## Worker crash

Note: workers run inside the same process as the app; there is no separate worker container. A "worker crash" is an app crash. Follow the application-crash steps. On restart, leased jobs recover automatically:
- Expired-lease jobs return to `pending`.
- Jobs caught mid-provider-handoff become `uncertain` (see stuck jobs below).

## Chromium crash

Symptom: LinkedIn actions failing; logs show Playwright/Chromium errors; possible orphaned processes.
1. Check memory first: `docker stats --no-stream`. A Chromium crash is often an OOM symptom.
2. `docker compose restart linki`. The session layer reaps dead browsers and relaunches on next tick.
3. Do not change Chromium flags, the pinned version, or the fingerprint. If Chromium repeatedly SIGTRAPs, verify the image is the pinned build and has not been rebuilt against a newer Chromium.
4. If a LinkedIn session was invalidated, see "Expired LinkedIn session".

## Out-of-memory event

Symptom: OOM kill in `dmesg` or the container restarting under load; Chromium dying.
1. `free -h` and `docker stats` to confirm.
2. Restart to clear: `docker compose restart linki`.
3. If recurring, ensure no `mem_limit` is set too tightly (see DEPLOYMENT.md). Chromium plus the app can transiently need 2 to 2.5 GB, plus roughly 150 to 300 MB for each LinkedIn account context open at once.
4. Lower `LINKEDIN_ACCOUNT_CONCURRENCY` (default 4; `1` restores one account at a time) in `.env` and restart. Fewer accounts are then worked in parallel; no LinkedIn limit changes.
5. As an emergency backstop only, enable host swap. This is not a fix; reduce concurrent load and keep at least ~1 GB free.

## Full disk

Symptom: writes failing; `df -h /` near 100 percent.
1. Identify the consumer: `du -sh /opt/linki/data`, `docker system df`.
2. Reclaim Docker space safely: `docker image prune -f` and `docker builder prune -f`. Never `docker volume prune` or `docker compose down -v`.
3. Container logs are capped at 50 MB by config; if they were not, they are the likely culprit before the cap took effect.
4. If the SQLite database is large, prune high-growth tables (see "Database growth").

## Database unavailable

Symptom: readiness returns `db:"down"` (503); app errors referencing SQLite.
1. `curl "http://127.0.0.1:${PORT}/api/health?ready=1"` to confirm.
2. Check disk (a full disk makes WAL writes fail) and file permissions on `/opt/linki/data` (the container runs as the non-root `node` user).
3. `docker compose restart linki`.
4. If the database file is corrupt, restore from the latest backup (DEPLOYMENT.md, Restore) using the same `NEXTAUTH_SECRET`.

## Queue unavailable

There is no external queue; the queue is the `email_jobs` table plus in-process loops. "Queue unavailable" means either the DB is down (see above) or the loops are not running (app crashed). Restart and confirm jobs progress:
```bash
docker compose exec linki node -e "process.exit(0)"   # container reachable
docker compose logs --tail=100 linki | grep -i runner
```

## Stuck jobs

Symptom: jobs sitting in `leased`, `sending`, or `uncertain`.
- `leased` past its lease is auto-requeued to `pending` by `recoverStaleEmailJobs()` on the next tick.
- `sending` past its lease becomes `uncertain` on recovery. This is deliberate: the provider may or may not have accepted the message, so it is not auto-retried to avoid a double-send.
- Reconcile `uncertain` jobs manually. Inspect and decide per job:
```bash
docker compose exec linki node -e "const {getDb}=require('./.next/server/chunks/…'); " # not stable; prefer the DB directly:
sqlite3 /opt/linki/data/linki.db "SELECT id, recipient, subject, last_error, updated_at FROM email_jobs WHERE status='uncertain';"
```
  For each, check the recipient inbox or the `sent_messages` table for a matching send. If it was not sent, requeue by setting `status='pending', available_at=datetime('now'), lease_owner=NULL`. If it was sent, mark `status='sent'`. Only do this after confirming, and back up first.

### Uncertain LinkedIn actions

LinkedIn connect/message/InMail/visit actions are claimed in `linkedin_actions` before the browser is driven (one row per run, track and step). A row left in `sending` (step watchdog timeout, crash, page closed mid-send) becomes `uncertain` and is never resent automatically: the runner moves the track on, sets the track `error_message`, and logs a `warn` "Delivery of the ... is uncertain". Reconcile by checking the LinkedIn conversation/invitations for that contact:
```bash
sqlite3 /opt/linki/data/linki.db "SELECT id, type, target_id, run_id, last_error, updated_at FROM linkedin_actions WHERE status='uncertain' ORDER BY updated_at DESC;"
```
If it went out, set `status='sent'`. If it did not, send it by hand (the track has already moved on). Daily LinkedIn caps count `sending`, `sent` and `uncertain` rows on the account's local day.

### Stuck imports and track claims

- A `list_imports` row in `running` whose `heartbeat_at` is older than 15 minutes (or missing) is requeued as `scheduled` at runner boot and before every import pass; one with a pending cancel is closed as `canceled`. It no longer blocks agent import sources.
- Imports run inside the owning LinkedIn account's worker (never alongside that account's outreach), at most 4 pages / about 6 minutes per pass; the remainder is chained as a new batch later the same day while the workspace quota lasts, else the next day. The daily import cap is per workspace (`app_settings` key `daily_import_cap:<workspace_id>`, falling back to the old global `daily_import_cap`).
- `run_profile_tracks.claimed_by/claimed_at` mark the worker executing a track. A claim older than 15 minutes is treated as abandoned and taken over automatically; no manual action is needed.

### LinkedIn account workers and bulk enrichment

- Each 30 s LinkedIn pass works up to `LINKEDIN_ACCOUNT_CONCURRENCY` accounts in parallel (default 4). Within one account the order is fixed and sequential: due campaign steps (8 to 20 s apart), one import pass, a few needs-data profile reads, one bulk-enrichment slice. Signal discovery and CRM connector sync run after all account workers finish.
- If a phase hits its watchdog, the account is skipped by later passes ("still has work in flight from an earlier pass") until the abandoned browser work really ends. If it repeats for one account, check that account's session (see "Expired LinkedIn session") and Chromium health. Signal discovery is deferred while any account is in this state.
- "Enrich list" requests are queued, not run immediately: `app_settings` keys `bulk_enrich:<account_id>:<list_id>`. The account worker reads up to 10 profiles per pass, charged to the account's daily `profile_view` budget, and removes the key when every unenriched profile has been read once. A budget stop or a LinkedIn pause keeps the list queued until it can continue. To cancel a queued list: `sqlite3 /opt/linki/data/linki.db "DELETE FROM app_settings WHERE key LIKE 'bulk_enrich:%:<list_id>';"`

## Repeated failed jobs

Symptom: jobs in `failed` with a repeating error.
```bash
sqlite3 /opt/linki/data/linki.db "SELECT last_error, COUNT(*) FROM email_jobs WHERE status='failed' GROUP BY last_error ORDER BY 2 DESC;"
```
- Permanent errors (invalid credentials, suppressed recipient) should not be retried; fix the underlying cause (reconnect the mailbox, correct the address).
- Transient patterns that exhausted `max_attempts` can be requeued after fixing the cause.

## Expired LinkedIn session

Symptom: LinkedIn actions failing with auth/redirect errors; account flagged as needing re-auth.
1. Do not attempt to bypass any security challenge.
2. In the app, re-authenticate the affected account (cookie paste or the login flow). This is an operator action.
3. Confirm the pinned Chromium was not changed by a rebuild, which is a common root cause of forced logout.

## LinkedIn checkpoint

Symptom: LinkedIn presents a checkpoint, CAPTCHA, or security verification.
1. The system is designed to stop or pause the account on these conditions rather than push through. Leave it paused.
2. A human should resolve the checkpoint directly in a normal browser session for that account, then re-authenticate in the app.
3. Do not automate the challenge.

## Account restriction

Symptom: LinkedIn temporarily restricts the account or shows an unusual-activity warning.
1. Pause automation for that account.
2. Reduce that account's daily/hourly limits and pacing before resuming (limits are enforced by the runner; a human should lower the configured values).
3. Resume only after the restriction clears. Do not parallelize or increase throughput to "catch up".

## Failed deployment

Symptom: new image starts unhealthy or crash-loops.
1. `docker compose logs --tail=200 linki`.
2. If it is a config error, fix `.env.local` and retry.
3. If it is a code regression, roll back to the previous image tag (DEPLOYMENT.md, Roll back) and `docker compose up -d`.
4. The database is unchanged by a rollback because migrations are additive and idempotent.

## Failed migration

Migrations are idempotent `CREATE/ALTER` statements that run on boot; there is no destructive migration path. Only "duplicate column name"/"already exists" errors are ignored; any other error is logged as `[db] migration failed: ... statement: ...` and stops boot (a plain `CREATE INDEX` over a column a legacy table lacks is logged as `[db] index skipped` instead). Table rebuilds run in one transaction, drop a leftover `*_new` table first and always restore `foreign_keys`, so a failed rebuild leaves the old table intact. If boot fails during migration:
1. Read the exact SQL error in the logs.
2. Restore the pre-deploy database backup (DEPLOYMENT.md, Restore) and roll back to the previous image.
3. Report the failing statement for a code fix. Do not hand-edit the schema in production without a backup.

## Backup restoration

See DEPLOYMENT.md sections 11 and 12. Key points: stop the container, replace `linki.db`, remove stale `-wal`/`-shm`, start, and use the same `NEXTAUTH_SECRET` that was in effect when the backup was taken (otherwise encrypted sessions and secrets will not decrypt).

## Database growth (routine maintenance)

High-growth tables to prune on a schedule (back up first):
```bash
# Example: keep 90 days of event/log history. Review before running in production.
sqlite3 /opt/linki/data/linki.db "DELETE FROM logs WHERE created_at < datetime('now','-90 days');"
sqlite3 /opt/linki/data/linki.db "DELETE FROM domain_events WHERE occurred_at < datetime('now','-90 days');"
sqlite3 /opt/linki/data/linki.db "DELETE FROM sender_events WHERE occurred_at < datetime('now','-90 days');"
sqlite3 /opt/linki/data/linki.db "VACUUM;"
```
Do not delete from `accounts`, `runs`, `targets`, or session data. Run `VACUUM` during a quiet window; it rewrites the database file.

## What to watch (lightweight monitoring)

With no heavy observability stack, poll these on a small interval from the host or an external uptime monitor:
- `GET /api/health` (app up) and `GET /api/health?ready=1` (DB up).
- `docker inspect` health status (repeated unhealthy means restart-looping).
- `free -h` / `docker stats` (high memory, OOM risk).
- `df -h /` and `du -sh /opt/linki/data` (disk and DB growth).
- `email_jobs` counts by status (rising `failed`/`uncertain` means a provider or reconciliation problem).
- `linkedin_actions` rows in `uncertain` (each needs a human check, see Stuck jobs).
- `worker_leases`: `heartbeat_at` advances about every 15s while a loop works; `token` increases when a lease changes hands between processes.
- Tracks with `run_profile_tracks.error_message LIKE 'AI writing blocked%'`: AI steps are held and retried every 6h until the OpenRouter key, model, credit or spend cap is fixed, instead of being skipped.
- Accounts flagged as needing re-auth (LinkedIn checkpoints).
- Backup job success.
