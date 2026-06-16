# Architecture Document — Task Scheduler Application

## Overview

The Task Scheduler system follows a layered architecture with clearly separated components communicating through well-defined interfaces. It uses a message queue (BullMQ/Redis) to decouple scheduling logic from execution logic.

## Architecture Diagram

```
┌──────────────────────────────────────────────────────────────────────┐
│                         HTTP Clients                                  │
└───────────────────────────────┬──────────────────────────────────────┘
                                │
                    ┌───────────▼───────────┐
                    │   Express HTTP Server  │
                    │  (Middleware Stack)    │
                    │  • CorrelationId      │
                    │  • ContentType        │
                    │  • RequestLogger      │
                    │  • ErrorHandler       │
                    └───────────┬───────────┘
                                │
              ┌─────────────────┼─────────────────┐
              │                 │                   │
    ┌─────────▼──────┐  ┌──────▼───────┐   ┌─────▼──────┐
    │ Health Routes  │  │Schedule Routes│   │ Swagger UI │
    │  /health       │  │/api/schedules │   │ /api-docs  │
    │  /ready        │  │              │   │            │
    └────────────────┘  └──────┬───────┘   └────────────┘
                               │
                    ┌──────────▼──────────┐
                    │ Schedule Controller  │
                    └──────────┬──────────┘
                               │
         ┌─────────────────────┼─────────────────────┐
         │                     │                       │
┌────────▼────────┐  ┌────────▼────────┐  ┌──────────▼──────────┐
│  Task Service   │  │ Idempotency Svc │  │ Validation Service  │
│ (CRUD + State)  │  │ (Dedup Guard)   │  │ (Zod Schemas)       │
└────────┬────────┘  └─────────────────┘  └─────────────────────┘
         │
    ┌────┼────────────────────┐
    │    │                     │
┌───▼────▼───┐       ┌────────▼────────┐
│  MongoDB   │       │  Queue Service  │
│  (Mongoose)│       │  (BullMQ)       │
└────────────┘       └────────┬────────┘
                              │
                    ┌─────────▼─────────┐
                    │   Redis (ioredis) │
                    └─────────┬─────────┘
                              │
              ┌───────────────┼───────────────┐
              │                               │
    ┌─────────▼─────────┐          ┌─────────▼─────────┐
    │  Scheduler Engine │          │   BullMQ Worker    │
    │  (node-cron +     │          │   (Job Processor)  │
    │   Polling Loop)   │          │   • Timeout        │
    └───────────────────┘          │   • Retry/Backoff  │
                                   └─────────┬─────────┘
                                             │
                              ┌──────────────┼──────────────┐
                              │              │              │
                    ┌─────────▼──┐  ┌────────▼──┐  ┌───────▼───────┐
                    │ File Read  │  │ Form Fill │  │    Email      │
                    │ File Import│  │ Executor  │  │  (Nodemailer) │
                    │ Executors  │  │           │  │               │
                    └────────────┘  └───────────┘  └───────────────┘
```

## Core Components

| Component | Technology | Responsibility |
|-----------|-----------|----------------|
| HTTP Server | Express 5 | Accept requests, routing, middleware pipeline |
| Scheduler Engine | node-cron + setInterval | Dispatch tasks at the configured time (cron or one-time) |
| Queue | BullMQ + Redis | Decouple scheduling from execution, ensure at-least-once delivery |
| Worker | BullMQ Worker | Process jobs, apply timeout + retry logic |
| Executors | Custom modules | Task-type-specific execution logic |
| Database | MongoDB + Mongoose | Store tasks, idempotency keys, execution history |
| Cache/Queue Backend | Redis 7 | Backend for BullMQ, health checks |

## Main Processing Flow

1. **Client creates task** → Validation → Save to DB (status: `pending`) → Register with scheduler
2. **Scheduler detects task is due** → Atomic claim (`pending` → `running`) → Enqueue to BullMQ
3. **Worker picks up job** → Call corresponding executor → Record execution history
4. **Success** → Status `success` + save result
5. **Failure + retries remaining** → Status `retrying` + re-enqueue with exponential backoff
6. **Failure + max retries reached** → Status `failed` + record error details

## Duplicate Execution Prevention

- Atomic `findOneAndUpdate({ status: 'pending' })` ensures only 1 instance can claim a task
- In-flight set prevents duplicate DB round-trips within the same process
- BullMQ `jobId` = task MongoDB `_id` prevents duplicate jobs in the queue

## Retry Strategy

- Exponential backoff: `delay = base × 2^(retryCount - 1)`
- Base delay: 1s (configurable)
- Max delay: 300s (configurable)
- Max retries: 3 (configurable per task, range 0-10)

## Observability

- Correlation ID (UUID v4) attached throughout each request/job lifecycle
- Structured JSON logging (timestamp, level, correlationId, message, context)
- Health check (`/health`) + Readiness check (`/ready`) for monitoring/orchestrators
