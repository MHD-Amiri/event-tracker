import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RmqContext } from '@nestjs/microservices';

const RETRY_COUNT_HEADER = 'x-event-tracker-retry-count';
const FAILURE_HEADER = 'x-event-tracker-failure';
const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_RETRY_DELAY_MS = 5000;
const MAX_CONFIGURED_RETRIES = 20;
const MAX_CONFIGURED_DELAY_MS = 300_000;

@Injectable()
export class RmqRetryService {
    private readonly maxRetries: number;
    private readonly retryDelayMs: number;

    constructor(config: ConfigService) {
        this.maxRetries = boundedInteger(
            config.get<number>('RMQ_MAX_RETRIES', DEFAULT_MAX_RETRIES),
            0,
            MAX_CONFIGURED_RETRIES,
            DEFAULT_MAX_RETRIES,
        );
        this.retryDelayMs = boundedInteger(
            config.get<number>('RMQ_RETRY_DELAY_MS', DEFAULT_RETRY_DELAY_MS),
            100,
            MAX_CONFIGURED_DELAY_MS,
            DEFAULT_RETRY_DELAY_MS,
        );
    }

    async handleFailure(
        context: RmqContext,
        sourceQueue: string,
        error: unknown,
        permanent = false,
    ): Promise<void> {
        const channel = context.getChannelRef();
        const message = context.getMessage();
        const headers = message.properties.headers ?? {};
        const retryCount = parseRetryCount(headers[RETRY_COUNT_HEADER]);
        const properties = {
            persistent: true,
            contentType: message.properties.contentType,
            contentEncoding: message.properties.contentEncoding,
            correlationId: message.properties.correlationId,
            messageId: message.properties.messageId,
            headers: { ...headers },
        };

        if (!permanent && retryCount < this.maxRetries) {
            const retryQueue = `${sourceQueue}.retry`;
            await channel.assertQueue(retryQueue, {
                durable: true,
                arguments: {
                    'x-message-ttl': this.retryDelayMs,
                    'x-dead-letter-exchange': '',
                    'x-dead-letter-routing-key': sourceQueue,
                },
            });
            properties.headers[RETRY_COUNT_HEADER] = retryCount + 1;
            await channel.sendToQueue(retryQueue, message.content, properties);
        } else {
            const deadLetterQueue = `${sourceQueue}.dlq`;
            await channel.assertQueue(deadLetterQueue, { durable: true });
            properties.headers[RETRY_COUNT_HEADER] = retryCount;
            properties.headers[FAILURE_HEADER] = errorMessage(error).slice(0, 500);
            properties.headers['x-event-tracker-failed-at'] = new Date().toISOString();
            await channel.sendToQueue(deadLetterQueue, message.content, properties);
        }

        // Ack only after the durable retry/DLQ queue exists and the message has
        // been handed to the channel. If forwarding throws, the caller leaves
        // the original delivery unacked for broker recovery.
        channel.ack(message);
    }
}

function parseRetryCount(value: unknown): number {
    const parsed = Number(value ?? 0);
    return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0;
}

function boundedInteger(value: unknown, min: number, max: number, fallback: number): number {
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) && parsed >= min && parsed <= max ? parsed : fallback;
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
