# Event Tracker

A sensor-event pipeline: agents publish events to RabbitMQ, the process app persists them, matches them against rules, and serves reports.

## Language

**SensorEvent**:
The message an agent publishes: `agentId`, `timestamp`, and a `payload` of `{ name, value }`.
_Avoid_: event (ambiguous with Mongo's `events` collection and the domain event), message, reading

**Ingestion queue**:
The queue the agent publishes to and the ingest consumer reads from. Default `events_queue`.
_Avoid_: events queue, input queue

**Evaluation queue**:
The queue ingest publishes to and the evaluation consumer reads from, carrying events that already passed ingestion. Default `events_evaluation_queue`.
_Avoid_: matcher queue, processing queue

**Rule**:
An active condition on a sensor-event name and value, e.g. `temperature > 80`.
_Avoid_: alert, trigger, filter

**Match** (matched event):
A recorded instance of a SensorEvent satisfying a Rule. Stored with a snapshot of the rule as it was at match time.
_Avoid_: hit, alert, violation

**Snapshot**:
The copy of a Rule's fields stored on a Match, so later edits to the Rule do not rewrite history.
_Avoid_: version, copy

**Broker URL**:
The AMQP connection string. Canonical variable `RABBITMQ_URL`; `RABBITMQ_URI` is a deprecated alias.
_Avoid_: AMQP URI, Rabbit URI, connection string

**Deployment role**:
Which consumers a process instance runs: `both`, `ingest`, or `evaluate`.
_Avoid_: mode, profile, node type
