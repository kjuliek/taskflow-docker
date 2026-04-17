# taskflow-docker

A production-ready task management REST API containerised with Docker.  
Stack: **Node.js 20 · Express · PostgreSQL 16 · Redis 7 · Nginx**.

---

## Architecture

```
Client → Nginx (:80) → API (:3000) → PostgreSQL (:5432)
                                    → Redis      (:6379)
```

Four services orchestrated by Docker Compose, images built and scanned automatically by GitHub Actions, pushed to GHCR.

---

## Quick start

```bash
# 1. Clone
git clone https://github.com/<your-org>/taskflow-docker.git
cd taskflow-docker

# 2. Configure environment
cp .env.example .env          # edit values if needed

# 3. Start all services
docker compose up --build -d

# 4. Check health
curl http://localhost/health
```

Expected response:
```json
{"status":"healthy","timestamp":"...","version":"unknown","database":"connected","cache":"connected"}
```

> Any developer can clone the repo, run `docker compose up`, and have the full stack running in under 30 seconds — no local Node.js, PostgreSQL, or Redis installation required.

---

## API endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | Health check — returns DB + Redis status |
| `GET` | `/api/tasks?limit=20&offset=0` | List tasks — paginated, Redis-cached per page (TTL 60 s) |
| `GET` | `/api/tasks/:id` | Get a single task |
| `POST` | `/api/tasks` | Create a task |
| `PUT` | `/api/tasks/:id` | Update a task |
| `DELETE` | `/api/tasks/:id` | Delete a task |

### Task schema

```json
{
  "id": 1,
  "title": "Write documentation",
  "description": "Complete the README",
  "status": "pending",
  "created_at": "2026-04-16T12:00:00.000Z",
  "updated_at": "2026-04-16T12:00:00.000Z"
}
```

`status` accepted values: `pending` · `in_progress` · `done`

### Input validation

All routes validate inputs before touching the database:

| Rule | HTTP response |
|------|--------------|
| `:id` is not a positive integer | `400 "id" must be a positive integer` |
| `status` is not one of the accepted values | `400 "status" must be one of: pending, in_progress, done` |
| `title` missing on `POST` | `400 "title" is required` |
| Task not found | `404 Task not found` |

### Health response

```json
{
  "status": "healthy",
  "timestamp": "2026-04-16T12:00:00.000Z",
  "version": "1.0.0-blue",
  "database": "connected",
  "cache": "connected"
}
```

HTTP `200` when healthy, `503` when any dependency is down.

`version` reflects the `APP_VERSION` environment variable — set per-container in `docker-compose.prod.yml` to identify which Blue/Green slot is serving the request. Defaults to `"unknown"` when the variable is not set (e.g. in the base `docker-compose.yml`).

---

## Docker Compose

### Services

| Service | Image | Role | Port |
|---------|-------|------|------|
| `api` | built from `Dockerfile` | Node.js REST API | 3000 (internal) |
| `db` | `postgres:16.8-alpine3.23` | Persistent task storage | 5432 (internal) |
| `redis` | `redis:7.4-alpine3.23` | Task list cache (TTL 60 s) | 6379 (internal) |
| `nginx` | `nginx:1.27-alpine3.23` | Reverse proxy, single public entry point | **80 (public)** |

Only Nginx is exposed to the host. All other services communicate on Docker's internal network.

### Startup dependency chain

```
db (healthy) ──┐
               ├──► api (started) ──► nginx
redis (started)┘
```

The API container will not start until PostgreSQL passes its healthcheck (`pg_isready`). This prevents connection errors at boot when the database is still initialising.

### PostgreSQL healthcheck

```yaml
healthcheck:
  test: ["CMD-SHELL", "pg_isready -U ${POSTGRES_USER} -d ${POSTGRES_DB}"]
  interval: 10s
  timeout: 5s
  retries: 5
  start_period: 30s
```

`start_period: 30s` gives PostgreSQL time to restore data from its volume on first boot before the healthcheck starts counting retries.

### Redis memory policy

```yaml
command: redis-server --maxmemory 128mb --maxmemory-policy allkeys-lru
```

Redis is capped at 128 MB. When full, it evicts the least-recently-used keys (`allkeys-lru`). This makes it behave as a bounded cache — it will never crash the host due to unbounded memory growth.

### Redis caching strategy

`GET /api/tasks` supports pagination via `?limit=20&offset=0` query parameters:

| Parameter | Default | Max | Description |
|-----------|---------|-----|-------------|
| `limit` | `20` | `100` | Number of tasks per page |
| `offset` | `0` | — | Number of tasks to skip |

Each page is cached independently in Redis under the key `tasks:all:<limit>:<offset>` with a 60-second TTL. This means `?limit=20&offset=0` and `?limit=20&offset=20` are cached separately.

Any write operation (`POST`, `PUT`, `DELETE`) invalidates **all** paginated cache entries at once by scanning and deleting every key matching `tasks:all:*`.

Example response:

```json
{
  "data": [{ "id": 1, "title": "...", "status": "pending", "..." : "..." }],
  "total": 42,
  "limit": 20,
  "offset": 0
}
```

### Nginx reverse proxy

Nginx is the sole public entry point on port 80. It proxies all traffic to the API and strips internal routing from public view.

```nginx
upstream api_backend {
    server api:3000;        # Docker internal hostname
}
```

The `/health` location has `access_log off` to avoid polluting logs with automated healthcheck probes.

### Data persistence

PostgreSQL data is stored in a named Docker volume (`pgdata`). It survives `docker compose down` and is only removed with:

```bash
docker compose down -v    # ⚠ deletes all data
```

---

## Environment variables

Copy `.env.example` to `.env` before starting the stack. Docker Compose builds the full connection URLs automatically.

| Variable | Example | Description |
|----------|---------|-------------|
| `POSTGRES_USER` | `taskuser` | PostgreSQL username |
| `POSTGRES_PASSWORD` | `taskpassword` | PostgreSQL password |
| `POSTGRES_DB` | `taskdb` | PostgreSQL database name |
| `DATABASE_URL` | *(built by Compose)* | Full Postgres connection string — auto-set by Docker Compose |
| `REDIS_URL` | *(built by Compose)* | Redis connection string — auto-set by Docker Compose |
| `NODE_ENV` | `production` | Runtime environment |

---

## Security

### Non-root container

The API runs as a dedicated non-root user (`appuser:appgroup`) inside the container — no process has root privileges.

Verify at any time with:

```bash
docker compose exec api whoami
# Expected output: appuser
```

The user is created in the Dockerfile production stage and ownership is set via `--chown` on every `COPY` instruction:

```dockerfile
RUN addgroup -S appgroup && adduser -S appuser -G appgroup
COPY --from=builder --chown=appuser:appgroup /app/node_modules ./node_modules
USER appuser
```

### Pinned image versions

All base images are pinned to a specific runtime + Alpine version to guarantee reproducible builds and prevent silent CVE introduction via tag mutation.

| Service | Image | Why pinned |
|---------|-------|-----------|
| API (builder + runtime) | `node:20.19-alpine3.23` | LTS runtime, fixed OS packages |
| PostgreSQL | `postgres:16.8-alpine3.23` | Known-good patch release |
| Redis | `redis:7.4-alpine3.23` | Known-good patch release |
| Nginx | `nginx:1.27-alpine3.23` | Stable branch, fixed OS packages |

Using `:latest` or partial tags like `postgres:16-alpine` means the image silently changes on every pull. Pinning the full version makes every build deterministic across dev, CI, and production.

### No secrets in the image

- `.env` is listed in both `.gitignore` and `.dockerignore` — it is never committed or baked into the image.
- Credentials are injected at runtime via environment variables defined in `docker-compose.yml`.
- The `Dockerfile` contains no credentials, tokens, or environment-specific values.

### Trivy vulnerability scan results

Scan run against `ghcr.io/kjuliek/taskflow-docker:latest` in CI with `--severity CRITICAL,HIGH`:

| Scope | Total CVEs | CRITICAL/HIGH | Pipeline impact |
|-------|-----------|---------------|----------------|
| Alpine OS packages (`alpine 3.23.x`) | 0 | **0** | ✅ passes |
| Application `node_modules` (`/app/node_modules/`) | 0 | **0** | ✅ passes |
| npm internal packages (`/usr/local/lib/node_modules/npm/`) | — | excluded via `skip-dirs` | ✅ passes |

The Dockerfile runs `apk upgrade --no-cache` in the production stage to pull the latest security patches from the Alpine repos at build time. Node.js base images are built at a fixed point in time — their OS packages become stale as CVEs are patched upstream. `apk upgrade` bridges this gap without waiting for the base image maintainer to publish a new tag.

The npm internal packages at `/usr/local/lib/node_modules/npm/` are excluded via `skip-dirs` because they belong to Node.js's bundled npm CLI — not our application code — and are not reachable at runtime.

#### Version history

| Pin | Alpine version in image | OS CVEs | CRITICAL/HIGH | Status |
|-----|------------------------|---------|---------------|--------|
| `node:20-alpine` (unpinned) | 3.23.x | 0 | 0 | ✅ (local only, pre-pinning) |
| `node:20.19-alpine3.21` | 3.21.5 | 11 | TBD by CI | bumped |
| `node:20.19-alpine3.22` | 3.22.2 | 11 | **2 CRITICAL** (OpenSSL CVE-2025-15467) | bumped |
| `node:20.19-alpine3.23` | 3.23.2 | 11 | **2 CRITICAL** (same — packages frozen at image build time) | + apk upgrade |
| `node:20.19-alpine3.23` + `apk upgrade` | 3.23.2 (patched) | 0 | **0** | ✅ current |

Lesson: pinning a version guarantees reproducibility but also freezes OS packages at a specific state. The Trivy step in CI catches any CRITICAL/HIGH CVEs introduced by a pin and blocks the push — forcing an explicit version bump as the resolution.

### Run Trivy locally (Windows PowerShell)

```powershell
docker run --rm -v /var/run/docker.sock:/var/run/docker.sock ghcr.io/aquasecurity/trivy:latest image --severity CRITICAL,HIGH taskflow-api:latest
```

If CVEs are found:
1. Update the base image Alpine pin (e.g. `alpine3.22` → `alpine3.23`)
2. Run `npm audit fix` to patch vulnerable Node.js dependencies
3. Rebuild and scan again — never push with unresolved CRITICAL CVEs

---

## CI/CD Pipeline

The pipeline is defined in [.github/workflows/ci.yml](.github/workflows/ci.yml) and runs on every push and pull request to `main`.

### Pipeline overview

```
push / PR to main
       │
       ▼
┌──────────────────┐
│  Job 1: test     │  always runs (push + PR)
│  ─────────────── │
│  npm ci          │
│  npm run lint    │
│  npm run test    │
│  (with coverage) │
└────────┬─────────┘
         │ needs (must pass)
         ▼
┌──────────────────────────┐
│  Job 2: build-and-push   │  push to main only
│  ──────────────────────  │
│  docker login GHCR       │
│  docker buildx build     │
│  → push to GHCR          │
│  trivy scan (exit 1 on   │
│    CRITICAL CVE)         │
└──────────────────────────┘
```

### Job 1 — Lint, test & coverage

| Step | Command | Purpose |
|------|---------|---------|
| Install | `npm ci` | Reproducible install from lock file |
| Lint | `npm run lint` | ESLint checks `src/` for errors |
| Test + coverage | `npm run test:coverage` | Runs unit tests and prints coverage via Node.js built-in `--experimental-test-coverage` |

### Job 2 — Build, scan & push

| Step | Tool | Purpose |
|------|------|---------|
| Login | `docker/login-action@v3` | Authenticates to GHCR using `GITHUB_TOKEN` |
| Buildx | `docker/setup-buildx-action@v3` | Enables BuildKit and layer cache |
| Metadata | `docker/metadata-action@v5` | Generates two tags: `sha-<short>` (immutable) and `latest` |
| Build & push | `docker/build-push-action@v5` | Builds with `cache-from/to: type=gha` to reuse layers between runs |
| Scan | `aquasecurity/trivy-action@master` | Scans the pushed image — `exit-code: 1` blocks the pipeline on CRITICAL |

### Image tags on GHCR

Every push to `main` produces two tags:

```
ghcr.io/<owner>/taskflow-docker:sha-abc1234   ← immutable, tied to a specific commit
ghcr.io/<owner>/taskflow-docker:latest        ← updated on every push to main
```

Use the SHA tag in production deployments for reproducibility.

### GitHub Actions permissions

`GITHUB_TOKEN` is automatically available in every workflow. The `build-and-push` job declares:

```yaml
permissions:
  contents: read
  packages: write   # required to push to ghcr.io
```

Verify in **Settings → Actions → General** that "Read and write permissions" is enabled.

### Layer cache

```yaml
cache-from: type=gha
cache-to: type=gha,mode=max
```

Docker layer cache is stored in GitHub Actions cache. On subsequent pushes, unchanged layers (e.g. `node_modules`) are restored instead of rebuilt, significantly reducing build time.

---

## Docker image

### Build locally

```bash
docker build -t taskflow-api .
```

### Verify image size (target: < 100 MB)

```bash
docker images taskflow-api
```

Result: **~49 MB content size** (well under the 100 MB target).

### How the multi-stage build stays lean

| What stays out | Why |
|----------------|-----|
| devDependencies (`eslint`, `nodemon`) | Pruned in the builder stage before copy |
| Test files | Excluded via `.dockerignore` |
| Build toolchain (npm cache, etc.) | Builder stage is discarded entirely |
| Git history, docs, CI config | Excluded via `.dockerignore` |

### Image stages

```
Stage 1 — builder     node:20.19-alpine3.23 + all deps + npm prune  ← discarded
Stage 2 — production  node:20.19-alpine3.23 + prod deps + src only  ← pushed to GHCR
```

---

## Development (without Docker)

```bash
npm install
cp .env.example .env
# Add POSTGRES_HOST, REDIS_HOST etc. to .env for local overrides
npm run dev
```

The connection logic in `src/db.js` accepts either a `DATABASE_URL` / `REDIS_URL` (Docker Compose) or individual `POSTGRES_*` / `REDIS_*` variables (local development without Docker).

## Lint

```bash
npm run lint
```

ESLint checks `src/` against `eslint:recommended` rules. Configuration in `.eslintrc.json`.

## Tests

```bash
npm test                 # unit tests only
npm run test:coverage    # unit tests + coverage report (stdout)
```

Unit tests use Node.js's built-in `node:test` runner — no extra test framework dependency.

### What is tested

| Suite | Cases |
|-------|-------|
| `parseId` | valid integer, non-numeric string, zero, negative, empty string |
| `status validation` | all valid values, unknown value, empty string, case-sensitivity |
| `POST payload validation` | title only, all fields, missing title, invalid status |
| `health response shape` | all keys present including `version`, fallback to `"unknown"`, unhealthy state |

> **Cross-platform note:** the test script uses an explicit file path (`tests/tasks.test.js`) rather than a directory or glob.  
> On Node.js v22 (Windows), `node --test tests/` fails because the directory resolves as a module entry point.  
> On Node.js v20 (Linux/CI), quoted globs are not shell-expanded. An explicit path works on all versions and platforms.

---

## Project structure

```
taskflow-docker/
├── .github/workflows/
│   └── ci.yml              # 2-job CI/CD pipeline (test → build+scan+push)
├── src/
│   ├── server.js           # Express entrypoint + /health endpoint
│   ├── routes/
│   │   └── tasks.js        # CRUD routes with Redis cache invalidation
│   └── db.js               # pg pool + Redis client + schema init on boot
├── tests/
│   └── tasks.test.js       # Unit tests (node:test, no extra deps)
├── nginx/
│   ├── default.conf        # Nginx reverse proxy — upstream api_backend
│   └── blue-green.conf     # Blue/Green routing — active + standby upstreams
├── Dockerfile              # Multi-stage: builder (prune) + production (non-root)
├── .dockerignore           # Excludes node_modules, tests, docs, .env, CI config
├── .eslintrc.json          # ESLint 8 config — eslint:recommended + node env
├── docker-compose.yml      # 4-service stack with pinned images and healthchecks
├── docker-compose.prod.yml # Blue/Green stack (api-blue + api-green + nginx + db + redis)
├── .env.example            # 3 variables to set — Compose builds the URLs
├── package.json
└── README.md
```

---

## Blue/Green Deployment Simulation

In production, Blue/Green uses a load balancer (AWS ALB, Traefik…). Here it is simulated with Docker Compose and Nginx to demonstrate the principle.

### Architecture

```
Client → Nginx (:80) → active_backend  → api-blue:3000  (live traffic)
                      → standby_backend → api-green:3000 (validation only, via /test-standby/)
```

Both containers share the same PostgreSQL database and Redis instance — no data migration required during the switch.

### Files

| File | Role |
|------|------|
| `docker-compose.prod.yml` | Defines `api-blue`, `api-green`, shared `db`, `redis`, `nginx` |
| `nginx/blue-green.conf` | Routes public traffic to `active_backend`, exposes standby via `/test-standby/` |

### Startup dependency chain

```
db (healthy) ──┐
               ├──► api-blue  (healthy) ──┐
redis (started)┘                          ├──► nginx
               ├──► api-green (healthy) ──┘
               └──(shared)
```

Both `api-blue` and `api-green` have a `healthcheck` (`wget /health`, every 15 s). Nginx only starts once **both** slots pass their healthcheck — preventing Nginx from proxying to a container that isn't ready yet.

### Starting the stack

```bash
cp .env.example .env   # fill in credentials if not done
docker compose -f docker-compose.prod.yml up -d
```

### Switch procedure (Blue → Green)

```bash
# 1. Verify Green is healthy before touching live traffic
curl http://localhost/test-standby/health
# Expected: {"status":"healthy","version":"2.0.0-green",...}

# 2. Edit nginx/blue-green.conf — change active_backend to point to Green:
#    server api-green:3000;   ← was api-blue:3000

# 3. Reload Nginx — zero downtime, no restart needed
docker compose -f docker-compose.prod.yml exec nginx nginx -s reload

# 4. Confirm live traffic now hits Green
curl http://localhost/health
# Expected: {"status":"healthy","version":"2.0.0-green",...}

# 5. Rollback to Blue if needed: reverse step 2 and reload again
```

### Why zero downtime

`nginx -s reload` sends a `HUP` signal to the Nginx master process. It spawns new worker processes with the updated config while the old workers finish serving in-flight requests before exiting. No connection is dropped.

### APP_VERSION

The `/health` endpoint exposes `APP_VERSION` from the environment:

```json
{"status":"healthy","version":"2.0.0-green","database":"connected","cache":"connected"}
```

This makes it possible to confirm which slot is active at any time without inspecting container names.

---

## Roadmap

- [x] Step 1 — REST API with CRUD endpoints and `/health`
- [x] Step 2 — Multi-stage Dockerfile (target < 100 MB)
- [x] Step 3 — Docker Compose with health checks
- [x] Step 4 — Trivy vulnerability scan (0 CRITICAL CVEs)
- [x] Step 5 — GitHub Actions: lint → test → build → scan → push to GHCR
- [x] Step 6 — Blue/Green deployment simulation
