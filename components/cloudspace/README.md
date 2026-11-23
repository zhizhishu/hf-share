---
title: CloudSpace
emoji: ☁️
colorFrom: blue
colorTo: green
sdk: docker
app_port: 7860
---

# CloudSpace

CloudSpace is a private subscription workspace image for `zhizhishu`. It packages a merged web UI, backend API, HTTP META helper, external state backup, and a password-protected access gateway into one Docker container.

Repository: https://github.com/zhizhishu/cloudspace

Published image:

```text
ghcr.io/zhizhishu/cloudspace:latest
```

## Runtime

- Public port: `7860` by default for Hugging Face Spaces, or platform `PORT` when provided.
- Internal core port: `3001` by default.
- Data path: `/opt/app/data`.
- Frontend path: `/opt/app/frontend`.
- Backend path: `/2cXaAxRGfddmGz2yx1wA`.
- Container listen host: the CloudSpace access gateway listens on `0.0.0.0`; the internal core listens on `127.0.0.1`.
- Access lock: enabled by default. The first start generates an initial password if `ACCESS_LOCK_INITIAL_PASSWORD` is not set, then stores a hashed config in `/opt/app/data/cloudspace-access.json`. After login, open `/__lock` to change the password.
- HTTP META: enabled by default on internal `127.0.0.1:9876` for Node.js script operations.
- Stratus (full-server version): enabled by default on internal `127.0.0.1:9100` (stable) and `127.0.0.1:9101` (beta). It is reached from outside through an encrypted public path prefix on the same `7860` gateway, so proxy clients without the access cookie can still fetch scripts/subscriptions. See `## Stratus Full-Server Version` below.

## Environment Variables

| Name | Default |
| --- | --- |
| `CLOUDSPACE_PRODUCT_NAME` | `CloudSpace` |
| `ACCESS_LOCK_ENABLED` | `true` |
| `ACCESS_LOCK_PORT` | `$PORT` or `3000` |
| `ACCESS_LOCK_DATA_PATH` | `/opt/app/data/cloudspace-access.json` |
| `ACCESS_LOCK_INITIAL_PASSWORD` | empty, generated on first start |
| `ACCESS_LOCK_COOKIE_SAMESITE` | auto (`None` on HTTPS/HF, `Lax` on local HTTP) |
| `ACCESS_LOCK_UPSTREAM_TIMEOUT_MS` | `300000` |
| `ACCESS_LOCK_REQUEST_TIMEOUT_MS` | upstream timeout + `30000` |
| `ACCESS_LOCK_MAX_FRONTEND_TRANSFORM_BYTES` | `2097152` |
| `ACCESS_LOCK_FRONTEND_CACHE_CONTROL` | `no-store` |
| `ACCESS_LOCK_API_CACHE_CONTROL` | `no-store` |
| `CLOUDSPACE_API_MAX_CONCURRENT` | `4` |
| `CLOUDSPACE_API_MAX_BODY_BYTES` | `8388608` |
| `CLOUDSPACE_CONFIG_PATH` | `/__cloudspace/config.json` |
| `CLOUDSPACE_HEALTH_PATH` | `/__cloudspace/health` |
| `CLOUDSPACE_PUBLIC_HEALTH` | `true` |
| `CLOUDSPACE_HEALTH_TIMEOUT_MS` | `2500` |
| `CLOUDSPACE_HEALTH_CACHE_MS` | `10000` |
| `CLOUDSPACE_UPSTREAM_HOST` | `127.0.0.1` |
| `CLOUDSPACE_UPSTREAM_PORT` | `3001` |
| `CLOUDSPACE_BACKEND_API_HOST` | `127.0.0.1` |
| `CLOUDSPACE_BACKEND_API_PORT` | `3001` |
| `CLOUDSPACE_BACKEND_MERGE` | `true` |
| `CLOUDSPACE_BACKEND_PATH` | `/2cXaAxRGfddmGz2yx1wA` |
| `CLOUDSPACE_FRONTEND_PATH` | `/opt/app/frontend` |
| `CLOUDSPACE_DATA_BASE_PATH` | `/opt/app/data` |
| `CLOUDSPACE_INTERNAL_API_BASE` | `http://127.0.0.1:$CLOUDSPACE_BACKEND_API_PORT$CLOUDSPACE_BACKEND_PATH` |
| `CLOUDSPACE_BODY_JSON_LIMIT` | `8mb` |
| `CLOUDSPACE_CORE_NODE_MAX_OLD_SPACE_SIZE` | `6144` |
| `CLOUDSPACE_ACCESS_NODE_MAX_OLD_SPACE_SIZE` | `128` |
| `CLOUDSPACE_JOBS_PATH` | `/__cloudspace/jobs` |
| `CLOUDSPACE_JOB_ENABLED` | `true` |
| `CLOUDSPACE_JOB_MAX_CONCURRENT` | `2` |
| `CLOUDSPACE_JOB_MAX_QUEUE` | `20` |
| `CLOUDSPACE_JOB_MAX_BODY_BYTES` | `67108864` |
| `CLOUDSPACE_JOB_RESULT_MAX_BYTES` | `67108864` |
| `CLOUDSPACE_JOB_TIMEOUT_MS` | `300000` |
| `CLOUDSPACE_JOB_RETENTION_MS` | `86400000` |
| `HTTP_META_ENABLED` | `true` |
| `HTTP_META_HOST` | `127.0.0.1` |
| `HTTP_META_PORT` | `9876` |
| `HTTP_META_FOLDER` | `/opt/app/http-meta/meta` |
| `HTTP_META_TEMP_FOLDER` | `/tmp/http-meta` |
| `HTTP_META_BODY_JSON_LIMIT` | `32mb` |
| `HTTP_META_NODE_MAX_OLD_SPACE_SIZE` | `8192` |
| `HTTP_META_RESTART_ENABLED` | `true` |
| `HTTP_META_RESTART_DELAY_SECONDS` | `5` |
| `CURL_CONNECT_TIMEOUT` | `10` |
| `CURL_MAX_TIME` | `180` |
| `SUPABASE_BACKUP_ENABLED` | `false` |
| `SUPABASE_URL` | empty |
| `SUPABASE_SERVICE_ROLE_KEY` | empty |
| `SUPABASE_STORAGE_BUCKET` | empty |
| `SUPABASE_STORAGE_OBJECT` | `cloudspace/storage.json` |
| `SUPABASE_RESTORE_ON_START` | `true` |
| `SUPABASE_BACKUP_INTERVAL_SECONDS` | `300` |
| `SUPABASE_BACKUP_INITIAL_DELAY_SECONDS` | `60` |
| `SUPABASE_BACKUP_MIN_BYTES` | `200` |
| `SUPABASE_BACKUP_MAX_BYTES` | `16777216` |
| `SUPABASE_BACKUP_ALLOW_EMPTY` | `false` |
| `SUPABASE_STATE_FILE_MAX_BYTES` | `262144` |
| `SUPABASE_STATE_DATA_FILE_ALLOWLIST` | `github.json,github/*.json,github-*.json,*.github.json` |
| `SUPABASE_BACKUP_REQUIRE_VALID_STORAGE` | `true` |
| `SUPABASE_RESTORE_REQUIRE_VALID_STORAGE` | `true` |
| `SUPABASE_DAILY_BACKUP_ENABLED` | `true` |
| `SUPABASE_DAILY_BACKUP_PREFIX` | `cloudspace/daily` |
| `CLOUDSPACE_CACHE_CLEANUP_ENABLED` | `true` |
| `CLOUDSPACE_CACHE_CLEANUP_INTERVAL_SECONDS` | `600` |
| `CLOUDSPACE_CACHE_MAX_AGE_MINUTES` | `360` |
| `CLOUDSPACE_CACHE_MIN_DELETE_AGE_MINUTES` | `15` |
| `CLOUDSPACE_CACHE_MAX_KB` | `262144` |
| `CLOUDSPACE_CACHE_EMERGENCY_PURGE` | `true` |
| `CLOUDSPACE_CACHE_PATHS` | HTTP META temp, `/tmp/cloudspace-cache`, and CloudSpace data cache/tmp/log paths |
| `SCRIPTHUB_ENABLED` | `true` |
| `SCRIPTHUB_DIR` | `/opt/app/scripthub` |
| `SCRIPTHUB_HOST` | `127.0.0.1` |
| `SCRIPTHUB_PORT` | `9100` (internal stable) |
| `SCRIPTHUB_BETA_ENABLED` | `true` |
| `SCRIPTHUB_BETA_PORT` | `9101` (internal beta) |
| `SCRIPTHUB_PUBLIC_PATH` | `/sh-REPLACE_ME` (encrypted public prefix for stable) |
| `SCRIPTHUB_BETA_PUBLIC_PATH` | `/shb-REPLACE_ME` (encrypted public prefix for beta) |
| `SCRIPTHUB_BASE_URL` | `https://your-account-cloudspace.hf.space$SCRIPTHUB_PUBLIC_PATH` |
| `SCRIPTHUB_BETA_BASE_URL` | `https://your-account-cloudspace.hf.space$SCRIPTHUB_BETA_PUBLIC_PATH` |
| `SCRIPTHUB_MAX_CONCURRENT` | `16` (gateway concurrency cap for the Stratus lane; `0` = unlimited) |
| `SCRIPTHUB_NODE_MAX_OLD_SPACE_SIZE` | `1024` |
| `SCRIPTHUB_START_DELAY_SECONDS` | `2` |
| `SCRIPTHUB_RESTART_ENABLED` | `true` |
| `SCRIPTHUB_RESTART_DELAY_SECONDS` | `5` |
| `SCRIPTHUB_UPSTREAM_TIMEOUT_MS` | access upstream timeout (`300000`) |
| `SCRIPTHUB_MAX_BODY_BYTES` | `16777216` |

CloudSpace still maps a small set of internal compatibility variables for the bundled upstream core at container startup. Keep the public deployment configuration on the `CLOUDSPACE_*` variables unless you are debugging the core process directly.

## Single-Container Access Model

CloudSpace stays one app behind one password. Users enter the access password once on the frontend lock page; the same same-origin session then unlocks frontend pages, `/api/*`, and CloudSpace control routes. The gateway still uses internal scheduling lanes so large backend/API/HTTP META work cannot trip over the UI, but those lanes are an implementation detail rather than separate public projects:

- `/__lock/*`: access lock pages and password actions.
- `/__cloudspace/config.json`: same-origin CloudSpace config; protected by the same access cookie.
- `/__cloudspace/health`: gateway/core/HTTP META health summary. It remains public by default for deployment checks; set `CLOUDSPACE_PUBLIC_HEALTH=false` to put it behind the same password too.
- `/__cloudspace/jobs`: async API job lane for large subscription, availability-test, and landing-test style operations; protected by the same access cookie.
- `/api/*`: API proxy lane with bounded concurrency and request-body size; protected by the same access cookie.
- Everything else: frontend lane with branding/config injection and frontend cache policy.

HTTP META remains internal on `127.0.0.1:9876`; it is checked by health and restarted by the startup supervisor if the helper exits.

## Stratus Full-Server Version

CloudSpace bundles **Stratus**, a full-server script / rule-set conversion toolkit, as an additional internal service so it coexists with the bundled Cumulus core in the same container and behind the same `7860` gateway.

- The Stratus process is a single `node service.js` that listens on `127.0.0.1:9100` (stable) and `127.0.0.1:9101` (beta) at the same time. It is fetched and `pnpm install --prod` is run at image build time in a dedicated build stage, then copied into the runtime image at `/opt/app/scripthub`.
- Stratus keeps no server-side user data: a generated script/subscription link encodes everything it needs, and its `./tmp` working directory (symlinked to `/tmp/scripthub-tmp`) only holds transient cache. So no Supabase backup is required for Stratus, and a container rebuild does not lose any Stratus configuration.
- Because proxy clients (Surge / Loon / Stash / Clash, mobile apps, etc.) cannot send the CloudSpace access cookie, Stratus is exposed through an **encrypted public path prefix** instead of the password lock. The gateway matches that prefix *before* the access lock, strips it, and forwards the request to the internal Stratus port. Everything else stays locked.
  - Stable: `https://<your-space>/sh-REPLACE_ME/...` → internal `127.0.0.1:9100`.
  - Beta: `https://<your-space>/shb-REPLACE_ME/...` → internal `127.0.0.1:9101`.
- The security of this lane is the unguessable prefix (the same model Stratus recommends: a complex URL behind a reverse proxy). **For real deployments, override `SCRIPTHUB_PUBLIC_PATH` / `SCRIPTHUB_BETA_PUBLIC_PATH` with your own long random values via Hugging Face Space Variables**, and set `SCRIPTHUB_BASE_URL` / `SCRIPTHUB_BETA_BASE_URL` to the matching public URL so generated links point at the right prefix. A near-miss path such as `/sh-...EVIL` is *not* routed to Stratus; it falls back to the access lock.
- Because the repository ships a built-in default prefix, the gateway logs a prominent `[stratus][SECURITY]` warning at startup whenever the default prefix is still in use, to remind you to override it. The prefix must be treated like a password: if you do not override it, anyone who can read the repository can reach this code-executing service without the password.
- Since Stratus executes script code, the gateway also caps the Stratus lane at `SCRIPTHUB_MAX_CONCURRENT` concurrent requests (default `16`, `0` to disable) as defense-in-depth, returning `429` when exceeded.
- `SCRIPTHUB_ENABLED=false` disables the whole Stratus service and its routes; `SCRIPTHUB_BETA_ENABLED=false` disables only the beta lane. If Stratus fails to start, the container keeps running normally — the Cumulus core is never blocked by Stratus.
- Health: `/__cloudspace/health` reports a `stratus` section (reachability of each lane). Stratus status is informational and does not flip the overall `ok` flag, since it is a testing-stage component.
- Logged-in CloudSpace config (`/__cloudspace/config.json`) lists the active Stratus routes and base URLs for convenience.

## Subscription Stall Guards

Hugging Face Spaces can still hang on very large subscription import/export, conversion, or availability-test requests when the upstream core waits on slow remote URLs. CloudSpace now adds guardrails so a bad subscription job fails with a bounded error instead of pinning the whole access gateway forever:

- The access gateway gives upstream API calls up to `ACCESS_LOCK_UPSTREAM_TIMEOUT_MS` milliseconds, default `300000` (5 minutes), then returns `504`.
- The `/api/*` lane allows up to `CLOUDSPACE_API_MAX_CONCURRENT` concurrent proxied API requests and rejects larger request bodies above `CLOUDSPACE_API_MAX_BODY_BYTES`.
- Large API work can be submitted to the authenticated `/__cloudspace/jobs` lane instead of keeping one browser/Hugging Face proxy request open. Jobs are queued, run with bounded concurrency, persist status under `/opt/app/data/cloudspace-jobs`, and expose a polling result URL.
- The gateway only buffers up to `ACCESS_LOCK_MAX_FRONTEND_TRANSFORM_BYTES` while branding frontend HTML/JS; larger frontend assets pass through without transformation to avoid memory spikes.
- Transformed frontend responses and API responses default to `Cache-Control: no-store` to avoid stale same-origin config and browser cache growth.
- The bundled core, access gateway, and HTTP META helper start with separate Node heap caps.
- HTTP META accepts larger internal JSON payloads through `HTTP_META_BODY_JSON_LIMIT`, default `32mb`, so large node lists are not rejected by the helper's default `1mb` body parser.
- Supabase restore/backup curl calls use connection/total timeouts and skip state exports above `SUPABASE_BACKUP_MAX_BYTES`.
- A background cache cleanup loop trims safe cache paths only: HTTP META temp, `/tmp/cloudspace-cache`, and `cache`/`tmp`/`logs` under `CLOUDSPACE_DATA_BASE_PATH`. It refuses to clean arbitrary paths.

For extremely large subscription work, prefer lowering script-side `concurrency` and increasing script-side `timeout` in the CloudSpace/subscription task itself. Raising `ACCESS_LOCK_UPSTREAM_TIMEOUT_MS` is useful only when the request is slow but still making progress; if a provider URL is dead, letting it wait longer just makes the spinner feel more dramatic, which is adorable but useless.

## Access Password

Use `/__lock` for normal password changes after login.

`ACCESS_LOCK_INITIAL_PASSWORD` is an initial/reset seed, not a value that should overwrite the user-managed password on every restart. CloudSpace stores only a hash of the password plus a fingerprint of the last applied initial secret in `/opt/app/data/cloudspace-access.json`.

- First start: if `ACCESS_LOCK_INITIAL_PASSWORD` is set, CloudSpace uses it as the initial password.
- Normal change: changing the password from `/__lock` survives restarts and Supabase restore.
- Forced reset: changing `ACCESS_LOCK_INITIAL_PASSWORD` in Hugging Face or another platform secret, then restarting the container, applies the new secret once as a password reset.

If Supabase restore is enabled, the restored access-lock config is loaded before the access gateway starts. That means the password stored in the restored state remains active unless the platform secret has changed since the last applied reset.

On Hugging Face, the app is displayed inside an iframe on `huggingface.co` while the app itself runs on `*.hf.space`. CloudSpace therefore uses `SameSite=None; Secure` for access cookies on HTTPS/HF requests; otherwise the browser may accept the password but drop the session cookie, causing a login loop that looks like a wrong password.

## Supabase Storage Backup

CloudSpace can use Supabase Storage as an external backup target. It is not a POSIX container volume; the container starts the core service, verifies or creates a private Supabase Storage bucket, restores `storage.json` when present, then periodically exports `/api/storage` and uploads a CloudSpace state bundle back with upsert enabled.

The state bundle stores:

- CloudSpace server-side `/api/storage` export.
- Only small GitHub-related state files from `/opt/app/data` that match `SUPABASE_STATE_DATA_FILE_ALLOWLIST`.

The access-lock password file (`cloudspace-access.json`) is intentionally excluded from Supabase backup and restore. Keep temporary access passwords local-only; do not store them in Hugging Face Secrets, Supabase state, GitHub, frontend localStorage, or repository files.

Browser-local OAuth sessions, browser localStorage, and GitHub website login cookies are not server-side CloudSpace data. Those cannot be restored by Supabase on another browser or device, so GitHub may still ask for login again there. The access lock avoids relying on a browser's GitHub login for basic private access.

Backup safety:

- Restore and backup both validate that exported CloudSpace storage is meaningful before applying or uploading it.
- Empty or malformed exports are skipped by default, so a transient backend failure should not overwrite the last good Supabase state.
- A daily snapshot is also written to `SUPABASE_DAILY_BACKUP_PREFIX/YYYY-MM-DD.json` when Supabase backup is enabled. Keep this prefix private because it contains server-side CloudSpace state.

Create a Supabase project, then set:

```env
SUPABASE_BACKUP_ENABLED=true
SUPABASE_URL=https://<project-ref>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<server-side service role key>
SUPABASE_STORAGE_BUCKET=cloudspace
SUPABASE_STORAGE_OBJECT=cloudspace/storage.json
```

Keep `SUPABASE_SERVICE_ROLE_KEY` only in runtime environment secrets. Do not expose it in the frontend or commit it to Git.

## Local Build

```bash
docker build -t cloudspace .
docker run --rm -p 3000:3000 cloudspace
```

Open `http://localhost:3000/`. The generated initial password is printed once in the container logs. After login, open `http://localhost:3000/__lock` to change it.

## Node.js Availability Script

This image includes HTTP META and the Cirrus core, so Node.js availability and geo scripts can use the default internal endpoint:

```text
http_meta_protocol=http
http_meta_host=127.0.0.1
http_meta_port=9876
```

The bundled Cirrus core tracks `v1.19.27`, matching the Clash.Meta target generated by current availability scripts. The Docker build also runs the bundled core once so an incompatible binary fails during image publishing instead of surfacing later as refused local HTTP META test ports.

## Northflank

Use a deployment service when deploying the published Docker image. Use a build service only if Northflank is linked to GitHub and should build this repository directly.

Source repository:

```text
https://github.com/zhizhishu/cloudspace
```

Published container image:

```text
ghcr.io/zhizhishu/cloudspace:latest
```

## Deployment verification

After publishing or updating the Hugging Face Space pin, verify the whole GitHub -> GHCR -> Hugging Face -> live app chain:

```powershell
.\scripts\verify-cloudspace-deploy.ps1
```

The check is read-only. It verifies that:

- the latest `publish-image.yml` GitHub Actions run completed successfully for the current commit;
- `ghcr.io/zhizhishu/cloudspace:latest` resolves to a digest;
- the Hugging Face Space Dockerfile pins that same GHCR digest;
- the live Space `/__cloudspace/health` reports gateway, API/core, and HTTP META as healthy.

Use JSON output when another agent or script needs to consume the result:

```powershell
.\scripts\verify-cloudspace-deploy.ps1 -Json
```

## Hugging Face Spaces

Create a Docker Space and push this repository to it, or use a minimal Space repository that points at the published GHCR image. Hugging Face reads the Space configuration from the YAML block at the top of this README:

```yaml
sdk: docker
app_port: 7860
```

Keep the same Supabase environment variables in Space secrets if you want CloudSpace server-side state to restore after restarts. Free Spaces have more memory than the current Northflank free container, but their default runtime disk is still ephemeral.

When updating the Space manually, make sure the target is `your-account/cloudspace`. Older local remotes or browser tabs may still point at previous test Spaces and should not be reused for deployment.
