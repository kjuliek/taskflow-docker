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
{"status":"healthy","timestamp":"...","database":"connected","cache":"connected"}
```

> Any developer can clone the repo, run `docker compose up`, and have the full stack running in under 30 seconds — no local Node.js, PostgreSQL, or Redis installation required.

---

## API endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | Health check — returns DB + Redis status |
| `GET` | `/api/tasks` | List all tasks (Redis-cached, TTL 60 s) |
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

### Health response

```json
{
  "status": "healthy",
  "timestamp": "2026-04-16T12:00:00.000Z",
  "database": "connected",
  "cache": "connected"
}
```

HTTP `200` when healthy, `503` when any dependency is down.

---

## Docker Compose

### Services

| Service | Image | Role | Port |
|---------|-------|------|------|
| `api` | built from `Dockerfile` | Node.js REST API | 3000 (internal) |
| `db` | `postgres:16-alpine` | Persistent task storage | 5432 (internal) |
| `redis` | `redis:7-alpine` | Task list cache (TTL 60 s) | 6379 (internal) |
| `nginx` | `nginx:alpine` | Reverse proxy, single public entry point | **80 (public)** |

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

- `GET /api/tasks` stores the result in Redis with a 60-second TTL under the key `tasks:all`.
- Any write operation (`POST`, `PUT`, `DELETE`) immediately invalidates that key.
- Subsequent reads hit the database and repopulate the cache.

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

The API runs as a dedicated non-root user (`appuser`) inside the container.  
Verify at any time with:

```bash
docker compose exec api whoami
# Expected output: appuser
```

### Pinned image versions

All base images are pinned to a specific version to guarantee reproducible builds and prevent silent upgrades that could introduce CVEs.

| Service | Image |
|---------|-------|
| API (builder + runtime) | `node:20.19-alpine3.21` |
| PostgreSQL | `postgres:16.8-alpine3.21` |
| Redis | `redis:7.4-alpine3.21` |
| Nginx | `nginx:1.27-alpine3.21` |

Using `:latest` or unversioned Alpine tags (e.g. `postgres:16-alpine`) means the image can change on every pull without your knowledge. Pinning the full version ensures the build is deterministic across all environments.

### No secrets in the image

- `.env` is listed in both `.gitignore` and `.dockerignore` — it is never committed or baked into the image.
- Credentials are injected at runtime via environment variables.

### Trivy vulnerability scan

Scan the image locally before pushing:

```bash
# Scan for CRITICAL and HIGH CVEs only
docker run --rm -v /var/run/docker.sock:/var/run/docker.sock \
  aquasec/trivy image --severity CRITICAL,HIGH taskflow-api:latest
```

Target: **0 CRITICAL CVEs**. If any are found:
1. Update the base image pin to the latest patch (e.g. `node:20.19-alpine3.21` → `node:20.19-alpine3.22`)
2. Run `npm audit fix` to update vulnerable dependencies
3. Rebuild and scan again

The CI pipeline (GitHub Actions) also runs Trivy automatically on every push and blocks the image push if CRITICAL CVEs are found.

---

## Docker image

### Build

```bash
docker build -t taskflow-api .
```

### Verify image size (target: < 100 MB)

```bash
docker images taskflow-api
```

Result: **~49 MB content size** (well under the 100 MB target).

The multi-stage build keeps the final image lean:

| What stays out | Why |
|----------------|-----|
| devDependencies | pruned in the builder stage before copy |
| Test files | excluded via `.dockerignore` |
| Build toolchain | builder stage is discarded entirely |
| Git history / docs | excluded via `.dockerignore` |

### Image stages

```
Stage 1 — builder     node:20-alpine + all deps + npm prune  ← discarded after build
Stage 2 — production  node:20-alpine + prod deps + src only  ← final image pushed to GHCR
```

### Security

- Runs as a dedicated non-root user (`appuser:appgroup`) — no process inside the container has root privileges.
- `HEALTHCHECK` uses `wget` (available in Alpine) to probe `/health` every 30 seconds.

---

## Development (without Docker)

```bash
npm install
# Requires a local PostgreSQL and Redis instance, then:
cp .env.example .env
# Add POSTGRES_HOST, REDIS_HOST etc. to .env for local overrides
npm run dev
```

The `db.js` connection logic accepts either a `DATABASE_URL` / `REDIS_URL` (used by Docker Compose) or individual `POSTGRES_*` / `REDIS_*` variables (used for local development).

## Tests

```bash
npm test
```

Unit tests run with Node's built-in `node:test` runner — no extra dependencies.

> **Note:** the test script points directly to `tests/tasks.test.js` rather than using a directory or glob.  
> On Node.js v22 (Windows), `node --test tests/` fails because the directory is resolved as a module entry point.  
> On Node.js v20 (Linux/CI), quoted globs are not shell-expanded and are passed literally to the runner.  
> An explicit file path is the only form that works reliably across Node.js versions and platforms.

---

## Project structure

```
taskflow-docker/
├── .github/workflows/
│   └── ci.yml              # GitHub Actions pipeline
├── src/
│   ├── server.js           # Express entrypoint + /health endpoint
│   ├── routes/
│   │   └── tasks.js        # CRUD routes with Redis cache invalidation
│   └── db.js               # pg pool + Redis client + schema init
├── tests/
│   └── tasks.test.js       # Unit tests (node:test, no extra deps)
├── nginx/
│   └── default.conf        # Nginx reverse proxy — upstream api_backend
├── Dockerfile              # Multi-stage build (builder + production)
├── .dockerignore           # Excludes node_modules, tests, docs, .env
├── docker-compose.yml      # 4-service stack with healthchecks
├── docker-compose.prod.yml # Production overrides (resource limits, restart: always)
├── .env.example            # Environment variable template (3 vars to set)
├── package.json
└── README.md
```

---

## Roadmap

- [x] Step 1 — REST API with CRUD endpoints and `/health`
- [x] Step 2 — Multi-stage Dockerfile (target < 100 MB)
- [x] Step 3 — Docker Compose with health checks
- [x] Step 4 — Trivy vulnerability scan
- [ ] Step 5 — GitHub Actions: build → scan → push to GHCR
- [ ] Step 6 — Blue/Green deployment simulation
