# Linki Deployment Guide

Target: a single Linux VPS with 8 GB RAM and 100 GB storage running Docker and Docker Compose. Linki runs as two containers from one image, sharing the `data/` volume (the SQLite database):

- `linki` (`LINKI_ROLE=web`): the web app, API and MCP server. It starts no background loop.
- `linki-worker` (`LINKI_ROLE=worker`, `node .worker-dist/worker.js`): every background loop — LinkedIn account workers and Chromium, email campaigns, inbox sync, email jobs, warmup, verification, webhooks, AI agents, list imports and the daily retention job.

A web restart or deploy therefore never interrupts a send, and Chromium's memory is isolated in the worker. The original single-container mode is still supported: see "Single-process mode" below.

### Process roles (`LINKI_ROLE`)

| Value | HTTP | Background loops | Run with |
| --- | --- | --- | --- |
| `all` (default) | yes | yes, inside Next.js | `npm start` |
| `web` | yes | no | `npm start` |
| `worker` | no | yes | `npm run worker` (bundled, after `npm run build`) or `npm run worker:dev` (tsx, development) |

Both processes of the split mode need the same `LINKI_DB_PATH`, `NEXTAUTH_SECRET` (the worker decrypts LinkedIn cookies and mailbox passwords with a key derived from it) and `NEXTAUTH_URL` (the worker builds tracking, unsubscribe and webhook links from it); both are required in production for every role. Run exactly ONE worker per database; leases make a second one harmless but useless.

How the two processes stay out of each other's way:
- Every loop holds a DB lease in `worker_leases` (unchanged).
- A LinkedIn account is driven by one holder at a time across processes: the worker's account unit and every web route that drives a session (wizard preview, li-stats, sync-accepted, list sync-status, profile-scrape, the login steps) take the DB lease `linkedin-account:<id>` (60 s TTL, renewed every 15 s, released when the holder finishes). A web request for a busy account answers 409 "busy, try again in a few minutes".
- The LinkedIn session is stored in the DB (`accounts.cookies_json`). Saves are compare-and-swap, so a process never overwrites a session the other process replaced (login, cookie paste, disconnect), and a process drops its stale browser context before it next holds the account. In the split mode the web process closes its context before it lets go of the account.

### Single-process mode

Delete the `linki-worker` service from `docker-compose.yml` and remove `LINKI_ROLE=web` from `linki` (or set `LINKI_ROLE=all`). Everything then runs in one container as before; all the safety above still applies. Outside Docker: `npm run build && npm start` with `LINKI_ROLE` unset.

## 1. Prepare the VPS

- Install Docker Engine and the Docker Compose plugin.
- Create a deploy directory and a `data/` subdirectory (the SQLite database lives there and must persist across container recreation):
  ```bash
  mkdir -p /opt/linki/data && cd /opt/linki
  ```
- Put `docker-compose.yml` in `/opt/linki`.
- Front the app with a host-level reverse proxy (nginx, Caddy, or Traefik) terminating TLS and forwarding to `127.0.0.1:${PORT}`. The container binds to loopback only; do not expose it directly.

## 2. Configure environment variables

Create `/opt/linki/.env.local` from `.env.example`. It is read by compose via `env_file` and must never be committed or baked into an image (it is gitignored and dockerignored).

Required in production:
- `NEXTAUTH_SECRET` (generate with `openssl rand -base64 32`). The app fails fast at startup if this is missing.
- `NEXTAUTH_URL` (your public HTTPS URL, e.g. `https://linki.example.com`). The app fails fast at startup if this is missing or not an absolute URL. It is the only source of the app's public origin (OAuth/MCP token audience, discovery metadata); `Host` / `X-Forwarded-Host` headers are never trusted for this.

Recommended:
- `INTERNAL_API_SECRET` (generate with `openssl rand -base64 32`) if the MCP endpoint is used. It is only ever sent to the app's own loopback address (`http://127.0.0.1:${PORT:-3000}` inside the container).
- `TRUST_PROXY=1` when the app sits behind the reverse proxy described above. Rate limits (login, signup, OAuth) then key on the proxy-supplied `X-Real-IP` (or the right-most `X-Forwarded-For` entry). Configure the proxy to overwrite, not append to, `X-Real-IP` — for nginx: `proxy_set_header X-Real-IP $remote_addr;`. Leave it unset when clients can reach the app directly; otherwise those headers are client-forgeable and are ignored in favour of the socket address. Without it behind a proxy, every client shares the proxy's address and one rate-limit bucket.

Optional: `LINKI_ROLE` (set per service by compose), `LINKI_WORKER_GRACE_MS` (worker shutdown grace, default 60000), `LINKI_WORKER_HEARTBEAT_FILE` (worker liveness file), `EMAIL_TRACKING_BASE_URL`, `EMAIL_TRACKING_SECRET`, `MCP_ALLOWED_ORIGINS`, `HEADLESS`, `LINKEDIN_ACCOUNT_CONCURRENCY` (LinkedIn accounts worked in parallel, default 4, max 16; see "Resource recommendations"). `LINKI_DB_PATH` is set to `/data/linki.db` by compose automatically.

Open-tracking bot filtering (both optional, both have working defaults):
- `EMAIL_TRACKING_PREFETCH_SECONDS` — a pixel hit landing within this many seconds of the send is recorded as an automated prefetch rather than a read. Defaults to `15`. Mail security gateways (Defender Safe Links, Proofpoint, Mimecast, Barracuda) fetch every image on delivery, and Apple Mail Privacy Protection prefetches on receipt, so without this the open rate measures scanners instead of prospects. Lower it only if you see genuine reads being filtered; the campaign analytics show verified opens and raw pixel hits side by side so you can tell.
- `EMAIL_TRACKING_BOT_IP_CIDRS` — comma-separated CIDR ranges to treat as scanners, e.g. `17.58.0.0/16,40.94.0.0/16`. Empty by default: vendor egress ranges change often enough that a stale built-in list would start discarding real opens. Apple publishes its relay ranges at `mask-api.icloud.com/egress-ip-ranges.csv`.

## 3. Build or pull the containers

The compose file uses the published image by default:
```bash
docker compose pull
```
To build from source instead, edit `docker-compose.yml` to comment out `image:` and uncomment `build: .`, then:
```bash
docker compose build
```
Both services use the same image (`linki:local`); `npm run build` inside the Dockerfile builds the Next.js app and bundles the worker (`.worker-dist/worker.js`, esbuild; npm packages stay external and load from `node_modules`).
Note: the Dockerfile pins Chromium and the base image deliberately (LinkedIn fingerprint stability). Do not unpin them.

## 4. Start the application

```bash
docker compose up -d                 # starts linki (web) and linki-worker
```
The worker log shows `[worker] starting ...` and one `[runner] ... loop started` line per loop; the web log shows `LINKI_ROLE=web: background loops are not started in the web process`.

## 5. Migrations

No manual migration step is required. Schema creation and idempotent migrations run in-process on boot from `lib/db.ts`. The first start creates `/data/linki.db`.

## 6. Verify health

```bash
# Liveness
curl -fsS http://127.0.0.1:${PORT:-3456}/api/health
# Readiness (includes a DB check)
curl -fsS "http://127.0.0.1:${PORT:-3456}/api/health?ready=1"
# Container health status
docker compose ps
docker inspect --format '{{.State.Health.Status}}' $(docker compose ps -q linki)
```
Expect `{"status":"ok",...}` and, for readiness, `"db":"up"`. The container should report `healthy` within ~40 seconds of start.

The worker has no HTTP endpoint. Its healthcheck fails when its heartbeat file (`/tmp/linki-worker.heartbeat`, touched every 15 s) is older than 2 minutes:
```bash
docker inspect --format '{{.State.Health.Status}}' $(docker compose ps -q linki-worker)
```
Loop progress is visible in the DB either way: `worker_leases.heartbeat_at` (per loop and per busy LinkedIn account) and `runs.last_tick_at`, both shown on the admin overview (`/api/admin/overview`, "workers").

## 7. View logs

```bash
docker compose logs -f linki          # web
docker compose logs -f linki-worker   # background loops, LinkedIn, email sending
```
Logs are capped at 10 MB per file, 5 files (50 MB total) by the compose `logging` config.

## 8. Restart safely

```bash
docker compose restart linki          # web only: no send is interrupted
docker compose restart linki-worker   # background work only: the web app stays up
```
Restarting the worker does not take the web app down. On SIGTERM the worker stops starting new work, lets in-flight steps finish for up to `LINKI_WORKER_GRACE_MS` (60 s), saves and closes the LinkedIn browser contexts, releases its leases and exits; `stop_grace_period: 90s` gives it that time. While the worker is down, campaigns simply wait; nothing is lost. Do not `docker compose kill` the worker unless it is stuck: a hard kill skips the session save and leaves leases to expire (60 s at most).

In-flight email jobs are safe: a job mid-provider-handoff is recovered as `uncertain` on restart rather than re-sent. The LinkedIn loop resumes from durable run state. Restarts are safe with respect to the encrypted sessions in `/data`.

## 9. Update the application

```bash
cd /opt/linki
docker compose pull            # or: docker compose build
docker compose up -d
docker compose ps              # confirm healthy
```
To update the web without touching running sends, recreate only it: `docker compose up -d --no-deps linki`. Recreate the worker when the release changes background behaviour: `docker compose up -d --no-deps linki-worker` (graceful stop as above, then start). The new worker may start while the old one is still in its grace period; leases keep them from running the same loop or account at once.
Because `/data` is a bind mount, the database survives the container recreation.

## 10. Roll back

```bash
# Pin to a previous known-good image tag in docker-compose.yml, then:
docker compose up -d
```
Keep the previous image tag noted before each update. The database schema only grows via idempotent migrations, so an older app image runs against the same `/data/linki.db` without a downgrade step.

## 11. Back up data

The entire application state is the SQLite database plus its WAL/SHM siblings.
```bash
# Consistent online backup (preferred; requires sqlite3 on the host):
sqlite3 /opt/linki/data/linki.db ".backup '/opt/linki/backups/linki-$(date +%F).db'"

# Or stop-copy-start for a cold backup:
docker compose stop linki-worker linki
cp /opt/linki/data/linki.db /opt/linki/backups/linki-$(date +%F).db
docker compose start linki linki-worker
```
Back up `linki.db`, `linki.db-wal`, and `linki.db-shm` together if copying cold. Store backups off-box. These files contain encrypted LinkedIn sessions and lead data; protect them accordingly.

## 12. Restore data

```bash
docker compose stop linki-worker linki
cp /opt/linki/backups/linki-YYYY-MM-DD.db /opt/linki/data/linki.db
rm -f /opt/linki/data/linki.db-wal /opt/linki/data/linki.db-shm
docker compose start linki linki-worker
```
Restore requires the same `NEXTAUTH_SECRET` used when the backup was taken, or the encrypted sessions and secrets will not decrypt.

## 13. Clean Docker resources safely

```bash
docker image prune -f            # dangling images
docker builder prune -f          # build cache
```
Do not run `docker volume prune` or delete the `data/` bind mount; that is the database. Never `docker compose down -v`.

## 14. Monitor RAM and disk

```bash
docker stats --no-stream         # container memory/CPU
free -h                          # host memory
df -h /                          # host disk
du -sh /opt/linki/data           # database size growth
```

## Resource recommendations for the 8 GB VPS

These are grounded in the actual architecture: two Node processes (web, worker), one SQLite connection each on the same WAL database, and one shared Chromium in the worker driven by a single leased LinkedIn loop that works up to `LINKEDIN_ACCOUNT_CONCURRENCY` accounts in parallel, each in its own browser context and strictly sequential within the account. The web process only opens a browser for a user-triggered LinkedIn request (preview, manual sync, login) and closes the context again afterwards.

| Resource | Recommended | Rationale |
| --- | --- | --- |
| App server processes | 1 web (`next start`) + 1 worker | Do not run multiple replicas of either against one SQLite file. |
| Background worker concurrency | 1 per loop type (built in) | Each subsystem loop is leased and sequential; email dispatch handles up to 20 pending jobs per 30 s tick, sent sequentially. |
| Max simultaneous Chromium contexts | `LINKEDIN_ACCOUNT_CONCURRENCY` (default 4) | One browser, one context per LinkedIn account. Each context costs roughly 150 to 300 MB (more on heavy Sales Navigator pages). A context unused for 20 minutes is saved and closed. One account is never driven by two workers at once. |
| Database connection pool | N/A (1 shared connection) | better-sqlite3 is synchronous; a single connection with WAL is correct for one host. |
| Container memory limit | worker 5 GB, web 1.5 GB (optional, opt-in) | Leaves ~1 GB for OS + Docker daemon and ~1 GB free reserve. Chromium can spike to ~1 to 1.5 GB on heavy pages; 6 GB gives ample headroom. |
| Minimum free memory reserve | ~1 GB | Prevents swapping and OOM under a Chromium spike. |
| Log retention | 50 MB/container (set) | json-file `max-size: 10m` x `max-file: 5`. |
| Database growth | Prune periodically | See OPERATIONS_RUNBOOK.md for pruning `logs`, `domain_events`, `sender_events`, and completed `email_jobs`. |

### Applying container memory/CPU limits (optional)

Resource limits are intentionally not set in the shipped `docker-compose.yml` because a too-tight `mem_limit` would OOM-kill Chromium mid-session and force a LinkedIn re-authentication. If you choose to apply them, use generous headroom and monitor `docker stats` for a few days first:

```yaml
    # Add under the linki-worker service (and a smaller one under linki), only after observing real usage:
    deploy:
      resources:
        limits:
          memory: 6g
    # For non-swarm compose, the equivalent top-level keys are:
    # mem_limit: 6g
    # cpus: "3.5"
```

### Sizing `LINKEDIN_ACCOUNT_CONCURRENCY`

Budget memory for the WORKER as: Node (~400 MB) + Chromium browser process (~300 MB) + `LINKEDIN_ACCOUNT_CONCURRENCY` x 300 MB per context, plus ~1 GB spike headroom. The default of 4 needs about 3 GB of that headroom on top of the OS; on the 8 GB VPS keep it at 4 to 6. Contexts of accounts with no LinkedIn work are closed after 20 idle minutes, so the steady state is usually below the cap. Set `LINKEDIN_ACCOUNT_CONCURRENCY=1` to get the old one-account-at-a-time behaviour (for example while diagnosing memory pressure). Raising it does not raise any LinkedIn limit: daily caps, pacing (8 to 20 s between steps within an account), active hours and discovery budgets are all per account.

The web container needs about 400 to 600 MB, plus a transient ~300 to 600 MB when a user runs a wizard preview or a manual LinkedIn sync (one browser, one context, closed afterwards). Do not give the worker less than roughly 3.5 GB: a single Chromium session plus the Node app can transiently need 2 to 2.5 GB, and headroom absorbs page-load spikes. Swap can be enabled as an emergency backstop only; it is not a substitute for headroom and will slow the browser noticeably if hit.
