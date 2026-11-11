# Manual end-to-end smoke test

This procedure exercises the full path through RabbitMQ, MongoDB, Redis, the agent, the process service, Rule matching, and the report endpoints. It uses the local Docker Compose stack and does not run as part of Jest.

Prerequisites: Docker Compose, Node/npm, `curl`, and `jq`.

## Start the dependencies and apps

From the repository root:

```bash
docker compose up -d
```

Wait for RabbitMQ, MongoDB, and Redis to be ready. In separate terminals, start the process service and one agent:

```bash
npm run start:process
```

```bash
npm run start:agent
```

The process service should listen on port 3000. The agent should report a RabbitMQ connection.

## Create a Rule and wait for Matches

Create a Rule that matches every generated `temperature` reading:

```bash
RULE_ID=$(curl -sS -X POST http://localhost:3000/rules \
  -H 'Content-Type: application/json' \
  -d '{"name":"Smoke test temperature","eventName":"temperature","operator":">=","value":10}' \
  | jq -r '._id')
printf 'Rule ID: %s\n' "$RULE_ID"
```

Wait about 15 seconds for the agent to publish SensorEvents and for the process workers to record Matches.

## Verify persisted data and reports

Inspect a stored Match and its Rule snapshot:

```bash
docker exec event_tracker_mongodb mongosh event_tracker --quiet --eval \
  "db.matched_events.findOne({ruleId: ObjectId('$RULE_ID')}, {_id: 0, ruleId: 1, agentId: 1, matchedAt: 1, ruleSnapshot: 1})"
```

The result should include `agentId`, `matchedAt`, and a `ruleSnapshot` with the Rule name, `temperature`, `>=`, and `10`.

Query the timestamp report using a recent UTC window:

```bash
START=$(date -u -d '5 minutes ago' +%Y-%m-%dT%H:%M:%SZ)
END=$(date -u +%Y-%m-%dT%H:%M:%SZ)
curl -sS "http://localhost:3000/reports/rules/$RULE_ID/timestamps?start=$START&end=$END"
```

The response should contain a group for the running agent with one or more matched timestamps. Query its all-time ranking:

```bash
curl -sS "http://localhost:3000/reports/rules/$RULE_ID/ranking"
```

The response should include that agent with a positive `totalMatches` count.

## Stop the local stack

Stop the agent and process terminals with Ctrl+C, then stop the Compose services:

```bash
docker compose down
```
