import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ClientProxy } from '@nestjs/microservices';
import { faker } from '@faker-js/faker';
import { randomUUID } from 'crypto';
import { clientProxy, queueNames } from '@app/rmq';
import { SensorEventMessage } from './sensor-event.interface';
import { lastValueFrom } from 'rxjs';

@Injectable()
export class AgentService implements OnModuleInit, OnModuleDestroy {
    private readonly logger = new Logger(AgentService.name);
    private client: ClientProxy;
    private intervalId?: NodeJS.Timeout;
    private inFlightPublish?: Promise<void>;
    private stopping = false;
    private destroyPromise?: Promise<void>;

    private readonly agentId: string;

    // Milliseconds between events (default 200 = ~5 events/sec)
    private readonly emitIntervalMs: number;

    // Realistic sensor names for matching rules later
    private readonly metricNames = [
        'temperature',
        'pressure',
        'humidity',
        'voltage',
        'cpu_load',
    ];

    constructor(private readonly config: ConfigService) {
        this.agentId = this.config.get<string>('AGENT_ID', 'agent-default-1');
        this.emitIntervalMs = Number(this.config.get<string>('AGENT_EMIT_INTERVAL_MS')) || 200;
    }

    async onModuleInit() {
        // Broker URL, ingestion queue name, and durable-queue options all come
        // from the shared rmq module, so the agent can't connect to a
        // different broker or queue than the process service
        this.client = clientProxy(queueNames(this.config).ingestion, this.config);

        await this.client.connect();
        this.logger.log(`Connected to RabbitMQ. Agent ID: ${this.agentId}`);
        this.startEventEmitting();
    }

    async onModuleDestroy(): Promise<void> {
        if (this.destroyPromise) return this.destroyPromise;
        this.stopping = true;
        if (this.intervalId) {
            clearInterval(this.intervalId);
            this.intervalId = undefined;
        }
        this.destroyPromise = this.closeAfterPublish();
        return this.destroyPromise;
    }

    private async closeAfterPublish(): Promise<void> {
        if (this.inFlightPublish) {
            let timeout: NodeJS.Timeout | undefined;
            await Promise.race([
                this.inFlightPublish,
                new Promise<void>((resolve) => {
                    timeout = setTimeout(() => {
                        this.logger.warn('Timed out waiting for in-flight RabbitMQ publish during shutdown.');
                        resolve();
                    }, 5000);
                }),
            ]);
            if (timeout) clearTimeout(timeout);
        }
        this.client?.close();
    }

    private startEventEmitting() {
        this.intervalId = setInterval(() => {
            if (this.stopping || this.inFlightPublish) return;
            const publish = this.generateAndSendEvent();
            this.inFlightPublish = publish;
            void publish.finally(() => {
                if (this.inFlightPublish === publish) this.inFlightPublish = undefined;
            });
        }, this.emitIntervalMs);
    }

    private async generateAndSendEvent(): Promise<void> {
        // Randomly pick a metric name
        const randomMetric = faker.helpers.arrayElement(this.metricNames);

        // Random numeric value with 2 decimals
        const randomValue = faker.number.float({ min: 10, max: 120, fractionDigits: 2 });

        const message: SensorEventMessage = {
            eventId: randomUUID(),
            agentId: this.agentId,
            timestamp: new Date().toISOString(),
            payload: {
                name: randomMetric,
                value: randomValue,
            },
        };

        // Emit event asynchronously to RabbitMQ queue with pattern 'event_created'
        try {
            await lastValueFrom(this.client.emit('event_created', message), { defaultValue: undefined });
        } catch (error) {
            const detail = error instanceof Error ? error.message : String(error);
            this.logger.error(`RabbitMQ publish failed for eventId=${message.eventId}: ${detail}`);
        }
    }
}
