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

## Environment variables

See [.env.example](.env.example) for the full list.

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | API listening port |
| `NODE_ENV` | `development` | Runtime environment |
| `POSTGRES_HOST` | `localhost` | PostgreSQL host |
| `POSTGRES_DB` | `taskflow` | Database name |
| `POSTGRES_USER` | `taskflow` | Database user |
| `POSTGRES_PASSWORD` | — | Database password |
| `REDIS_HOST` | `localhost` | Redis host |
| `REDIS_PORT` | `6379` | Redis port |

---

## Development (without Docker)

```bash
npm install
# Start a local PostgreSQL and Redis, then:
cp .env.example .env
npm run dev
```

## Tests

```bash
npm test
```

Unit tests run with Node's built-in `node:test` runner — no extra dependencies.

> **Note (Node.js v22):** the test script uses a glob pattern (`"tests/**/*.test.js"`) instead of a directory path.  
> On Node.js v22, `node --test tests/` attempts to resolve the directory as a CommonJS module entry point and fails.  
> Passing an explicit glob lets the test runner discover files correctly on all platforms.

---

## Project structure

```
taskflow-docker/
├── .github/workflows/
│   └── ci.yml              # GitHub Actions pipeline
├── src/
│   ├── server.js           # Express entrypoint + /health
│   ├── routes/
│   │   └── tasks.js        # CRUD routes with Redis cache
│   └── db.js               # pg pool + Redis client + schema init
├── tests/
│   └── tasks.test.js       # Unit tests
├── nginx/
│   └── default.conf        # Nginx reverse proxy config
├── Dockerfile              # Container image definition
├── .dockerignore           # Build context exclusions
├── docker-compose.yml      # Development stack (4 services)
├── docker-compose.prod.yml # Production overrides
├── .env.example            # Environment variable template
├── package.json
└── README.md
```

---

## Roadmap

- [x] Step 1 — REST API with CRUD endpoints and `/health`
- [ ] Step 2 — Multi-stage Dockerfile (target < 100 MB)
- [ ] Step 3 — Docker Compose with health checks
- [ ] Step 4 — Trivy vulnerability scan
- [ ] Step 5 — GitHub Actions: build → scan → push to GHCR
- [ ] Step 6 — Blue/Green deployment simulation
