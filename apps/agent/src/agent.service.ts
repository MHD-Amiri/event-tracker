import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { ClientProxy, ClientProxyFactory, Transport } from '@nestjs/microservices';
import { faker } from '@faker-js/faker';
import { SensorEventMessage } from './sensor-event.interface';

@Injectable()
export class AgentService implements OnModuleInit, OnModuleDestroy {
    private readonly logger = new Logger(AgentService.name);
    private client: ClientProxy;
    private intervalId: NodeJS.Timeout;

    private readonly agentId = process.env.AGENT_ID || 'agent-default-1';
    private readonly rabbitMqUrl = process.env.RABBITMQ_URL || 'amqp://guest:guest@localhost:5672';

    // Milliseconds between events (default 200 = ~5 events/sec)
    private readonly emitIntervalMs = Number(process.env.AGENT_EMIT_INTERVAL_MS) || 200;

    // Realistic sensor names for matching rules later
    private readonly metricNames = [
        'temperature',
        'pressure',
        'humidity',
        'voltage',
        'cpu_load',
    ];

    // Ingestion queue — must match the process ingest consumer's queue (RMQ_INGESTION_QUEUE)
    private readonly ingestionQueue = process.env.RMQ_INGESTION_QUEUE || 'events_queue';

    async onModuleInit() {
        this.client = ClientProxyFactory.create({
            transport: Transport.RMQ,
            options: {
                urls: [this.rabbitMqUrl],
                queue: this.ingestionQueue,
                queueOptions: {
                    durable: true,
                },
            },
        });

        await this.client.connect();
        this.logger.log(`Connected to RabbitMQ. Agent ID: ${this.agentId}`);
        this.startEventEmitting();
    }

    onModuleDestroy() {
        if (this.intervalId) {
            clearInterval(this.intervalId);
        }
        this.client?.close();
    }

    private startEventEmitting() {
        this.intervalId = setInterval(() => {
            this.generateAndSendEvent();
        }, this.emitIntervalMs);
    }

    private generateAndSendEvent() {
        // Randomly pick a metric name
        const randomMetric = faker.helpers.arrayElement(this.metricNames);

        // Random numeric value with 2 decimals
        const randomValue = faker.number.float({ min: 10, max: 120, fractionDigits: 2 });

        const message: SensorEventMessage = {
            agentId: this.agentId,
            timestamp: new Date().toISOString(),
            payload: {
                name: randomMetric,
                value: randomValue,
            },
        };

        // Emit event asynchronously to RabbitMQ queue with pattern 'event_created'
        this.client.emit('event_created', message);
    }
}
