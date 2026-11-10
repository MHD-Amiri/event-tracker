# Share RabbitMQ transport configuration through a library

The two apps previously constructed their own RabbitMQ clients, each resolving
the broker URL and queue names independently. They disagreed: `main.ts` preferred
`RABBITMQ_URL` while the publisher module preferred `RABBITMQ_URI`, the agent read
only `RABBITMQ_URL`, and the queue names plus durable-queue options were copied in
three places. With both variables set, the consumer and the publisher could land
on different brokers — silently.

We moved all of it into `libs/rmq`, a Nest monorepo library (`@app/rmq`) exposing
`brokerUrl`, `queueNames`, `publisherOptions`, `consumerOptions`, and the two
`{ transport, options }` bundles each call site needs. `RABBITMQ_URL` is canonical;
`RABBITMQ_URI` remains a deprecated fallback with a once-per-process warning, so
existing deployments keep working.

The seam is deliberately not a broker abstraction. The interface returns
Nest-RMQ-shaped options, so it is named for the transport it actually is
(`libs/rmq`, not `libs/messaging`). Swapping the broker is a rename-worthy event,
and the module's name should make that obvious rather than promise independence
it does not provide.

## Consequences

The agent gained `RABBITMQ_URI` support as a side effect; it previously ignored
that variable entirely and would connect to `localhost` in a deployment that set
only the legacy name.
