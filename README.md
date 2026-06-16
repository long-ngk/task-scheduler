# Task Scheduler Application

An automated task scheduling and execution system built with Node.js/TypeScript using Express, MongoDB, BullMQ (Redis), and node-cron.

## Features

- Create one-time (`scheduleAt`) or recurring (`cronExpr`) scheduled tasks
- Supports 4 task types: file read, file import, form fill, email
- Idempotent API for receiving tasks from external systems
- Task lifecycle management: `pending` → `running` → `success` / `failed` / `retrying`
- Cancel/pause/resume support
- Retry with exponential backoff + configurable timeout
- Swagger UI at `/api-docs`

## Architecture

The system follows a layered architecture (Route → Controller → Service → Repository) with a decoupled execution engine powered by BullMQ/Redis.

### High-Level Flow

```
HTTP Client
    │
    ▼
Express Server (Middleware Stack: CorrelationId → ContentType → RequestLogger → ErrorHandler)
    │
    ▼
Route → Controller → Service Layer
    │                      │
    │         ┌────────────┼────────────────┐
    │         ▼            ▼                ▼
    │   Validation    Idempotency      Task Service
    │   Service       Guard            (CRUD + State)
    │                                       │
    ▼                                       ▼
MongoDB ◄──────────────────────────── Scheduler Engine (node-cron + polling)
                                            │
                                            ▼
                                     BullMQ Queue (Redis)
                                            │
                                            ▼
                                     Worker (timeout + retry)
                                            │
                              ┌─────────────┼─────────────┐
                              ▼             ▼             ▼
                         File Read     Form Fill      Email
                         File Import   Executor    (Nodemailer)
                         Executors
```

### Design Decisions

| Decision | Rationale |
|----------|-----------|
| Express.js | Lightweight, mature, large ecosystem for Node.js REST APIs |
| node-cron | Popular library supporting 5-6 field cron expressions |
| BullMQ + Redis | Supports delayed jobs, retry, concurrency control ideal for task scheduling |
| MongoDB + Mongoose | Flexible schema for diverse payloads, TTL index for idempotency key cleanup |
| Zod | TypeScript-first validation with automatic type inference, declarative API |
| UUID v4 | Standard RFC 4122 for guaranteed unique Correlation IDs |
| Nodemailer | Most widely used Node.js email library |

### Task State Machine

```
              ┌────────────────── User cancels ──────────────────┐
              │                                                    │
              ▼                                                    │
[*] → pending ──── scheduled time reached ───→ running ───→ success
        │                                        │
        │── User pauses ──→ paused               │── failure (retries left) ──→ retrying ──→ running
        │                     │                  │
        │                     │── User resumes → pending
        │                     │── User cancels → cancelled
        │                                        │── failure (no retries) ──→ failed
        └── User cancels ──→ cancelled
```

Valid state transitions:
- `pending → running | paused | cancelled`
- `paused → pending | cancelled`
- `running → success | retrying | failed`
- `retrying → running | failed`

### Retry Strategy

- Algorithm: Exponential backoff with `delay = base × 2^(retryCount - 1)`
- Base delay: 1 second (configurable via `TASK_RETRY_BASE_DELAY_SECONDS`)
- Max delay cap: 300 seconds (configurable via `TASK_RETRY_MAX_DELAY_SECONDS`)
- Max retries: 3 per task by default (override per task, range 0-10)
- Timeout: 30 seconds per execution by default (override per task, range 1-3600s)

### Duplicate Execution Prevention

1. Atomic `findOneAndUpdate({ status: 'pending' })` ensures only one process can claim a task
2. In-process `Set<taskId>` prevents redundant DB round-trips within the same Node.js instance
3. BullMQ `jobId` set to task's MongoDB `_id` prevents duplicate jobs in the queue

### Error Handling

All errors follow a standard response format:

```json
{
  "errorCode": "VALIDATION_ERROR",
  "message": "Request validation failed",
  "details": [{ "field": "cronExpr", "reason": "Invalid cron expression format" }],
  "correlationId": "550e8400-e29b-41d4-a716-446655440000"
}
```

| Category | HTTP Status | Example Error Codes |
|----------|-------------|---------------------|
| Validation | 400 | `VALIDATION_ERROR`, `INVALID_CRON`, `INVALID_TYPE` |
| Not Found | 404 | `TASK_NOT_FOUND` |
| Conflict | 409 | `INVALID_TASK_STATUS` |
| Payload Too Large | 413 | `PAYLOAD_TOO_LARGE` |
| Unsupported Media | 415 | `UNSUPPORTED_MEDIA_TYPE` |
| Service Unavailable | 503 | `QUEUE_UNAVAILABLE` |
| Internal | 500 | `INTERNAL_ERROR` (sanitized, no stack traces) |

### Observability

- **Correlation ID**: UUID v4 attached to every request/job, propagated via `AsyncLocalStorage`
- **Structured logging**: JSON format with `timestamp`, `level`, `correlationId`, `message`, `context`
- **Health endpoints**: `/health` (liveness) + `/ready` (dependency checks with 5s timeout)

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the full architecture diagram.

## System Requirements

- Node.js >= 18
- MongoDB 7+
- Redis 7+
- Docker & Docker Compose (optional)

## Installation & Running

### Option 1: Docker Compose (recommended)

```bash
docker-compose up --build
```

This automatically starts the app along with MongoDB, Redis, and Mailhog (test email server).

### Option 2: Run locally

1. Install dependencies:
```bash
npm install
```

2. Make sure MongoDB and Redis are running (or use Docker for just those):
```bash
docker-compose up mongodb redis -d
```

3. Copy the example env file and edit as needed:
```bash
cp .env.example .env
```

4. Run in development mode (auto-reload):
```bash
npm run dev
```

Or build and run production:
```bash
npm run build
npm start
```

## URLs After Startup

| URL | Purpose |
|-----|---------|
| http://localhost:3000/health | Health check |
| http://localhost:3000/ready | Readiness check |
| http://localhost:3000/api-docs | Swagger UI (API documentation) |
| http://localhost:3000/api-docs.json | OpenAPI spec (JSON) |
| http://localhost:8025 | Mailhog UI (view test emails - Docker only) |

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/schedules` | Create a new scheduled task |
| POST | `/api/schedules/push` | Push task from external system (idempotent) |
| GET | `/api/schedules` | List tasks (pagination + filter) |
| GET | `/api/schedules/:id` | Get task details |
| PATCH | `/api/schedules/:id/cancel` | Cancel a task |
| PATCH | `/api/schedules/:id/pause` | Pause a task |
| PATCH | `/api/schedules/:id/resume` | Resume a paused task |
| GET | `/health` | Health check |
| GET | `/ready` | Readiness check |

## Scripts

| Script | Description |
|--------|-------------|
| `npm run dev` | Run in development mode (auto-reload) |
| `npm run build` | Build TypeScript → JavaScript |
| `npm start` | Run production (from dist/) |
| `npm test` | Run unit tests |
| `npm run test:coverage` | Run tests + coverage report |
| `npm run lint` | Check ESLint |
| `npm run lint:fix` | Auto-fix ESLint errors |
| `npm run format` | Format code with Prettier |

## Running Tests

```bash
# Run all tests
npm test

# Run tests with coverage
npm run test:coverage

# Run tests in watch mode
npm run test:watch
```

## Configuration (Environment Variables)

See `.env.example` for all supported environment variables. Key variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | 3000 | HTTP server port |
| `MONGODB_URI` | mongodb://localhost:27017 | MongoDB connection string |
| `REDIS_HOST` | localhost | Redis host |
| `REDIS_PORT` | 6379 | Redis port |
| `TASK_DEFAULT_TIMEOUT_SECONDS` | 30 | Default timeout per task (1-3600s) |
| `TASK_DEFAULT_MAX_RETRIES` | 3 | Default retry count (0-10) |

## Directory Structure

```
src/
├── config/          # Configuration, database connection, swagger
├── controllers/     # HTTP request handlers
├── executors/       # Task type implementations (file_read, email, etc.)
├── middlewares/     # Express middlewares (correlationId, error handler, etc.)
├── models/          # Mongoose models (Task, IdempotencyKey)
├── routes/          # Express route definitions
├── services/        # Business logic (scheduler, queue, validation, etc.)
├── utils/           # Utilities (logger, error classes)
├── app.ts           # Express app setup
└── index.ts         # Entry point
tests/
├── unit/            # Unit tests
├── integration/     # Integration tests
├── property/        # Property-based tests (fast-check)
└── helpers/         # Test utilities
```

## License

MIT
