import { Transport } from '@nestjs/microservices';
import {
    brokerUrl,
    consumerMicroservice,
    consumerOptions,
    DEFAULT_BROKER_URL,
    DEFAULT_EVALUATION_QUEUE,
    DEFAULT_INGESTION_QUEUE,
    DEFAULT_PREFETCH_COUNT,
    publisherClientConfig,
    publisherOptions,
    queueNames,
    ConfigReader,
} from './rmq.config';

const config = (values: Record<string, string | undefined> = {}): ConfigReader => ({
    get: (key, defaultValue) => (values[key] ?? defaultValue) as never,
});

describe('RabbitMQ configuration', () => {
    afterEach(() => {
        jest.restoreAllMocks();
    });

    describe('brokerUrl()', () => {
        it('prefers the canonical broker URL when both variables are configured', () => {
            expect(
                brokerUrl(
                    config({
                        RABBITMQ_URL: 'amqp://primary.example',
                        RABBITMQ_URI: 'amqp://legacy.example',
                    }),
                ),
            ).toBe('amqp://primary.example');
        });

        it('uses the default broker URL when neither variable is configured', () => {
            const warning = jest.spyOn(console, 'warn').mockImplementation(() => undefined);

            expect(brokerUrl(config())).toBe(DEFAULT_BROKER_URL);
            expect(warning).toHaveBeenCalledWith(
                expect.stringContaining('RABBITMQ_URL is not set'),
            );
            expect(warning).toHaveBeenCalledWith(
                expect.stringContaining('copy .sample.env to .env'),
            );
        });

        it('uses the deprecated URL only as a fallback and warns once', () => {
            const warning = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
            const legacyConfig = config({ RABBITMQ_URI: 'amqp://legacy.example' });

            expect(brokerUrl(legacyConfig)).toBe('amqp://legacy.example');
            expect(brokerUrl(legacyConfig)).toBe('amqp://legacy.example');

            expect(warning).toHaveBeenCalledTimes(1);
            expect(warning).toHaveBeenCalledWith(
                expect.stringContaining('RABBITMQ_URI is deprecated'),
            );
        });
    });

    describe('queueNames()', () => {
        it('uses the standard ingestion and evaluation queue names by default', () => {
            expect(queueNames(config())).toEqual({
                ingestion: DEFAULT_INGESTION_QUEUE,
                evaluation: DEFAULT_EVALUATION_QUEUE,
            });
        });

        it('applies ingestion and evaluation queue overrides independently', () => {
            expect(
                queueNames(
                    config({
                        RMQ_INGESTION_QUEUE: 'custom-ingestion',
                        RMQ_EVALUATION_QUEUE: 'custom-evaluation',
                    }),
                ),
            ).toEqual({
                ingestion: 'custom-ingestion',
                evaluation: 'custom-evaluation',
            });
        });
    });

    describe('publisherOptions()', () => {
        it('configures a durable publisher for the selected queue and broker', () => {
            expect(
                publisherOptions(
                    'custom-ingestion',
                    config({
                        RABBITMQ_URL: 'amqp://broker.example',
                    }),
                ),
            ).toEqual({
                urls: ['amqp://broker.example'],
                queue: 'custom-ingestion',
                queueOptions: { durable: true },
            });
        });

        it('includes publisher options in the Nest client configuration', () => {
            expect(publisherClientConfig('events_queue', config())).toEqual({
                transport: Transport.RMQ,
                options: {
                    urls: [DEFAULT_BROKER_URL],
                    queue: 'events_queue',
                    queueOptions: { durable: true },
                },
            });
        });
    });

    describe('consumerOptions()', () => {
        it('requires manual acknowledgements and uses the default prefetch count when missing', () => {
            expect(consumerOptions('events_queue', config())).toEqual({
                urls: [DEFAULT_BROKER_URL],
                queue: 'events_queue',
                queueOptions: { durable: true },
                noAck: false,
                prefetchCount: DEFAULT_PREFETCH_COUNT,
                maxConnectionAttempts: 5,
            });
        });

        it('uses a configured prefetch count', () => {
            expect(
                consumerOptions(
                    'events_evaluation_queue',
                    config({
                        RMQ_PREFETCH_COUNT: '125',
                        RABBITMQ_URL: 'amqp://broker.example',
                    }),
                ),
            ).toEqual({
                urls: ['amqp://broker.example'],
                queue: 'events_evaluation_queue',
                queueOptions: { durable: true },
                noAck: false,
                prefetchCount: 125,
                maxConnectionAttempts: 5,
            });
        });

        it('falls back to the default prefetch count for malformed configuration', () => {
            expect(
                consumerOptions(
                    'events_queue',
                    config({
                        RMQ_PREFETCH_COUNT: 'not-a-number',
                    }),
                ).prefetchCount,
            ).toBe(DEFAULT_PREFETCH_COUNT);
        });

        it('includes consumer options in the Nest microservice configuration', () => {
            expect(consumerMicroservice('events_queue', config())).toEqual({
                transport: Transport.RMQ,
                options: {
                    urls: [DEFAULT_BROKER_URL],
                    queue: 'events_queue',
                    queueOptions: { durable: true },
                    noAck: false,
                    prefetchCount: DEFAULT_PREFETCH_COUNT,
                    maxConnectionAttempts: 5,
                },
            });
        });
    });
});
