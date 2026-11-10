import { ClientProxy, ClientProxyFactory, MicroserviceOptions, RmqOptions, Transport } from '@nestjs/microservices';

/** Canonical broker variable. `RABBITMQ_URI` is accepted as a deprecated fallback. */
export const BROKER_URL_VAR = 'RABBITMQ_URL';
export const DEPRECATED_BROKER_URL_VAR = 'RABBITMQ_URI';

export const DEFAULT_BROKER_URL = 'amqp://guest:guest@localhost:5672';
export const DEFAULT_INGESTION_QUEUE = 'events_queue';
export const DEFAULT_EVALUATION_QUEUE = 'events_evaluation_queue';
export const DEFAULT_PREFETCH_COUNT = 500;

/**
 * The slice of `ConfigService` this module needs. Declared structurally so the
 * module stays a pure function library — tests pass a plain object, callers
 * pass Nest's ConfigService without adapters.
 */
export interface ConfigReader {
    get<T = string>(key: string, defaultValue?: T): T;
}

let warnedAboutDeprecatedVar = false;

/**
 * Resolves the broker URL. Precedence lives here and nowhere else, so the
 * ingest consumer, the evaluation publisher, and the agent cannot disagree.
 */
export function brokerUrl(env: ConfigReader): string {
    const url = env.get<string>(BROKER_URL_VAR);
    if (url) return url;

    const uri = env.get<string>(DEPRECATED_BROKER_URL_VAR);
    if (uri) {
        if (!warnedAboutDeprecatedVar) {
            warnedAboutDeprecatedVar = true;
            console.warn(
                `⚠️ ${DEPRECATED_BROKER_URL_VAR} is deprecated — set ${BROKER_URL_VAR} instead. ` +
                `Falling back to ${DEPRECATED_BROKER_URL_VAR} for this process.`,
            );
        }
        return uri;
    }

    return DEFAULT_BROKER_URL;
}

/**
 * Queue names are a cross-app invariant: the agent publishes to `ingestion`,
 * ingest publishes to `evaluation`. Naming them in one place keeps the three
 * call sites from drifting.
 */
export function queueNames(env: ConfigReader): { ingestion: string; evaluation: string } {
    return {
        ingestion: env.get<string>('RMQ_INGESTION_QUEUE', DEFAULT_INGESTION_QUEUE),
        evaluation: env.get<string>('RMQ_EVALUATION_QUEUE', DEFAULT_EVALUATION_QUEUE),
    };
}

/** Options for a producer (agent, ingest→evaluation publisher). */
export function publisherOptions(queue: string, env: ConfigReader): RmqOptions['options'] {
    return {
        urls: [brokerUrl(env)],
        queue,
        queueOptions: { durable: true },
    };
}

/** Full `ClientsModule` entry for an in-process publisher. */
export function publisherClientConfig(
    queue: string,
    env: ConfigReader,
): { transport: Transport.RMQ; options: RmqOptions['options'] } {
    return {
        transport: Transport.RMQ,
        options: publisherOptions(queue, env),
    };
}

/**
 * Options for a consumer. `noAck` + `prefetchCount` are consumer-only: they
 * cap the unacked buffer per consumer so a slow consumer can't have the broker
 * push an unbounded backlog into memory.
 */
export function consumerOptions(queue: string, env: ConfigReader): RmqOptions['options'] {
    const rawPrefetch = env.get<string>('RMQ_PREFETCH_COUNT');
    const prefetchCount = Number(rawPrefetch) || DEFAULT_PREFETCH_COUNT;

    return {
        urls: [brokerUrl(env)],
        queue,
        queueOptions: { durable: true },
        noAck: false,
        prefetchCount,
    };
}

/** Builds a client proxy for publishers that need to `emit` on demand. */
export function clientProxy(queue: string, env: ConfigReader): ClientProxy {
    return ClientProxyFactory.create({
        transport: Transport.RMQ,
        options: publisherOptions(queue, env),
    });
}

/**
 * Full `connectMicroservice` argument for a consumer. Bootstrap code runs
 * outside DI, so it takes this instead of injecting a provider.
 */
export function consumerMicroservice(queue: string, env: ConfigReader): MicroserviceOptions {
    return {
        transport: Transport.RMQ,
        options: consumerOptions(queue, env),
    };
}
