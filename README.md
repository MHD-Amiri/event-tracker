# event-tracker

A distributed event-tracking pipeline: simulated agents stream sensor events over RabbitMQ, a NestJS **process** service persists them to MongoDB, evaluates user-defined rules, and exposes reporting APIs — with Redis caching the active rule set and report results.

```
┌────────┐   events_queue    ┌─────────────┐  events_evaluation_queue  ┌─────────────┐
│ Agent  │ ──── (AMQP) ────▶ │   Process    │ ──── (AMQP) ────────────▶ │   Process    │
│ (5/s)  │                   │  (ingest)    │                           │ (evaluate)  │
└────────┘                   │  + HTTP API  │                           │  matches →  │
                             └──────┬──────┘                           │  MongoDB    │
                                    │ save                             └─────────────┘
                                    ▼
                               MongoDB                                  Redis
                                                                    (active Rules cache)
```

## Architecture

| Component | Role |
|---|---|
| **Agent** (`apps/agent`) | Standalone worker emitting simulated sensor events (~5/sec) to `events_queue` |
| **Process** (`apps/process`) | NestJS monolith: ingestion consumer, rule-evaluation consumer, REST API. Deployable as one process or split by role (see [Scaling](#scaling--deployment-roles)) |
| **RabbitMQ** | Two durable queues — decouples ingestion from evaluation, buffers failures |
| **MongoDB** | Source of truth: `events`, `rules`, `matched_events`, and durable `rule_agent_counts` collections; run as a replica set for atomic Match/count writes |
| **Redis** | 1-hour TTL cache for the active Rule set |

### Message flow

1. Agent publishes `event_created` → `events_queue`
2. Process (ingest) saves the event to MongoDB with the agent-generated **stable event ID**, then emits `evaluate_event`
3. Process (evaluate) loads active rules (Redis-cached), inserts `matched_events` for every matching rule — with a full **rule snapshot** embedded, so reports stay accurate even if the rule is edited or deleted later
4. Failed messages receive bounded delayed retries; malformed or exhausted messages are preserved in a durable per-queue dead-letter queue (DLQ)

## Prerequisites

- Node 18+ (via nvm), npm
- Docker (for RabbitMQ, MongoDB, Redis)

## Quick start

### Run the full stack in containers

```bash
cp .sample.env .env
docker compose up --build
```

Copy `.sample.env` first: Compose reads `.env` for its broker credentials, and
the apps load `.env` for their connection settings. This keeps both sides on
the same local RabbitMQ account.

Compose builds the Agent and Process images and starts them after RabbitMQ,
MongoDB, and Redis pass their health checks. The Process API is available at
`http://localhost:3000`; RabbitMQ management is at `http://localhost:15672`.
Use distinct `AGENT_ID` values when scaling agents. The sample broker password
is for local development; replace it before exposing the broker outside your
machine. Persistent named volumes retain RabbitMQ, MongoDB, and Redis data.

Stop the stack with `docker compose down`; add `-v` only when intentionally
deleting its persisted data.

### Run services locally

```bash
# 1. Required: configure both Compose and the local apps with matching broker credentials
cp .sample.env .env

# 2. Start only the infrastructure containers (not the Agent or Process apps)
docker compose up -d rabbitmq mongodb redis

# 3. Install dependencies
npm install

# 4. In one terminal, start the Process app (consumers + HTTP API on :3000)
npm run start:process

# 5. In another terminal, start a sensor Agent
npm run start:agent
```

The Compose command above names only RabbitMQ, MongoDB, and Redis, so the apps run on the host through the `start:process` and `start:agent` scripts. Stop the infrastructure with `docker compose down` when finished.

Configuration is env-driven. The table shows `.sample.env` values; copy that file to `.env` before starting the stack:

| Variable | Sample value | Used by |
|---|---|---|
| `RABBITMQ_URL` | `amqp://event_tracker:event_tracker_dev@localhost:5672` | agent + process (`RABBITMQ_URI` is a deprecated alias) |
| `RMQ_MAX_RETRIES` | `3` | process consumers; retries after initial delivery before DLQ |
| `RMQ_RETRY_DELAY_MS` | `5000` | process consumers; delay before retry |
| `MONGO_URI` | `mongodb://localhost:27017/event_tracker?replicaSet=rs0` | process |
| `REDIS_HOST` / `REDIS_PORT` | `localhost` / `6379` | process |
| `PORT` | `3000` | process HTTP |
| `PROCESS_ROLE` | `both` | process deployment role |
| `AGENT_ID` | `agent-default-1` | agent identifier |

## Walkthrough: from zero to a report

With both services running:

**1. Create a rule** — alert when temperature exceeds 80:

```bash
curl -X POST http://localhost:3000/rules \
  -H 'Content-Type: application/json' \
  -d '{
    "name": "High temperature",
    "eventName": "temperature",
    "operator": ">",
    "value": 80
  }'
```

```json
{
  "_id": "682f9f2a1c9d3e4f5a6b7c8d",
  "name": "High temperature",
  "eventName": "temperature",
  "operator": ">",
  "value": 80,
  "isActive": true
}
```

Note the `_id` — it's the `ruleId` used in the report APIs. Rules are cached in Redis for up to 1 hour, but **every create/update/delete invalidates the cache immediately**, so changes take effect right away.

**2. Verify the agent's events** are flowing (agent emits `temperature` among 5 metric types, values 10–120, so a rule at 80 trips regularly):

```bash
# Event timestamps per agent — ISO 8601 range, max 24h; limit defaults to 100 and is capped at 500
curl 'http://localhost:3000/reports/rules/682f9f2a1c9d3e4f5a6b7c8d/timestamps?start=2026-11-07T00:00:00Z&end=2026-11-08T00:00:00Z&limit=100'
```

**3. Check matches are being recorded** — the evaluation consumer writes one `matched_events` doc per (rule, event) match:

```bash
# Agent ranking for a rule — all-time match counts, highest first
curl http://localhost:3000/reports/rules/682f9f2a1c9d3e4f5a6b7c8d/ranking
```

```json
[
  { "agentId": "agent-default-1", "totalMatches": 342 }
]
```

The ranking endpoint reads the indexed `rule_agent_counts` projection, so requests do not scan Match history and reflect committed counts immediately.

**4. Manage rules**:

```bash
curl 'http://localhost:3000/rules?page=1&limit=20' # list a page (limit max 100)
curl http://localhost:3000/rules/<id>            # get one
curl -X PUT http://localhost:3000/rules/<id> \
  -H 'Content-Type: application/json' \
  -d '{"value": 50}'                             # update (cache invalidated)
curl -X DELETE http://localhost:3000/rules/<id>  # delete (cache invalidated)
```

Run multiple agents to make the ranking interesting: `AGENT_ID=agent-2 npm run start:agent`.

## API reference

### Rules — `/rules`

| Method | Path | Body | Notes |
|---|---|---|---|
| `POST` | `/rules` | `CreateRuleDto` | |
| `GET` | `/rules` | optional `page` (default 1), `limit` (default 20, max 100) | Returns `{ items, total, page, limit, totalPages }`; sorted by stable Rule ID order |
| `GET` | `/rules/:id` | — | 404 if unknown |
| `PUT` | `/rules/:id` | `UpdateRuleDto` | partial update |
| `DELETE` | `/rules/:id` | — | `{ success: true }` |

`operator` is one of `==`, `!=`, `>`, `>=`, `<`, `<=`. All bodies are validated (whitelist + strict DTO — unknown fields are rejected with 400).

### Reports — `/reports`

| Method | Path | Query | Notes |
|---|---|---|---|
| `GET` | `/reports/rules/:ruleId/timestamps` | `start`, `end` (ISO 8601), optional `limit` (1–500, default 100), optional opaque `cursor` | Window must be ≤ 24h, `start ≤ end`. Returns `{ items: [{ agentId, count, matchedAt }], limit, nextCursor }`; counts/timestamps are for that page. Pass `nextCursor` to fetch the next stable page. |
| `GET` | `/reports/rules/:ruleId/ranking` | — | All-time per-agent match counts from the durable projection, descending |

Both validate `ruleId` (400 on malformed ObjectId) and return 400 with a clear message on invalid input.

## Scaling & deployment roles

The same process codebase deploys in three topologies via `PROCESS_ROLE`:

| Role | Consumes | Serves | Use when |
|---|---|---|---|
| `both` (default) | both queues | HTTP | local dev, single instance |
| `ingest` | `events_queue` | HTTP | scale ingestion + API tier |
| `evaluate` | `events_evaluation_queue` | — (no HTTP port) | scale evaluation workers independently |

```bash
npm run start:process:ingest       # PROCESS_ROLE=ingest
npm run start:process:evaluate     # PROCESS_ROLE=evaluate
```

RabbitMQ round-robins each queue across all its consumers, so scaling the evaluation tier is just launching more `evaluate` processes — no code changes. This is the payoff of the two-queue split: ingestion keeps flowing while evaluation is slow or scaled down.

## Design decisions & best practices

**Idempotent consumption.** Every event carries a generated `eventId`, which is the event document ID. A match has a unique `(ruleId, eventId)` key and is written with an upsert, so redelivery cannot inflate match counts. Two distinct events with identical readings remain distinct.

**Broker confirms on forward and retry hops.** The `evaluate_event` emit and retry/DLQ forwarding are awaited; the source delivery is acknowledged only after forwarding succeeds. A retry queue holds each failure for `RMQ_RETRY_DELAY_MS` before returning it to the source queue.

**Bounded failure handling.** Broker messages are validated before service work. Invalid messages go directly to `<queue>.dlq`; transient failures retry up to `RMQ_MAX_RETRIES` times, then go to the same durable DLQ. Defaults are 3 retries and a 5 second delay. Inspect the queue's DLQ before replaying or discarding messages.

**Mongo is the source of truth; Redis is disposable.** Redis caches only active Rules; flushing it degrades performance, never correctness. API B reads durable Mongo counters and does not depend on Redis.

**Durable ranking projection.** Each Match and its per-rule/per-agent count increment commit in one Mongo transaction. The `(ruleId, agentId)` counter index supports ranked reads without grouping all historical Matches. MongoDB must run as a replica set for transactions; Compose initializes a single-node `rs0` replica set. Before using API B on an existing database, or to repair counters, stop the Process evaluation consumer and run `npm run rebuild:rankings`; the command replaces the projection from Match history, then evaluation can resume.

**Queue-per-stage, role-gated consumers.** `events_queue` and `events_evaluation_queue` isolate ingestion from evaluation latency. Prefetch is capped (`prefetchCount: 500`) so a slow consumer can't have the broker push an unbounded unacked buffer into memory.

**Rule snapshots at match time.** `matched_events.ruleSnapshot` embeds the rule's name/operator/value as they were when it matched. Editing or deleting a rule later doesn't falsify history — reports show what agents were actually measured against.

**Collection naming.** `matched_events` (and `events`) are declared explicitly in the schema — Mongoose would otherwise pluralize the class name into `matchedevents`.

**Known trade-offs / future work:**
- DLQ replay is an operator action; add an authenticated replay tool before relying on unattended recovery in production
- Report queries are unauthenticated; add auth before exposing beyond localhost

## Development

```bash
npx tsc -p apps/process/tsconfig.app.json --noEmit   # type check process
npx tsc -p apps/agent/tsconfig.app.json --noEmit     # type check agent
```

Monitoring: RabbitMQ management UI at http://localhost:15672 (credentials from `RABBITMQ_DEFAULT_USER` / `RABBITMQ_DEFAULT_PASS`, `event_tracker` / `event_tracker_dev` by default) — watch queue depth on `events_evaluation_queue` to see evaluation backpressure in real time.
