import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

const logger = new Logger('AgentBootstrap');

function describeStartupError(error: unknown, seen = new WeakSet<object>()): string {
    if (error instanceof Error) {
        if (seen.has(error)) return '[circular error cause]';
        seen.add(error);
        const cause = (error as Error & { cause?: unknown }).cause;
        return `${error.name}: ${error.message}${cause === undefined ? '' : `; cause=${describeStartupError(cause, seen)}`}`;
    }
    if (typeof error === 'string') return error;

    if (typeof error === 'object' && error !== null) {
        if (seen.has(error)) return '[circular error detail]';
        seen.add(error);
        const details = error as Record<string, unknown>;
        const readable = ['message', 'code', 'replyCode', 'replyText']
            .filter((key) => typeof details[key] === 'string' || typeof details[key] === 'number')
            .map((key) => `${key}=${details[key]}`);
        for (const key of ['err', 'error', 'cause']) {
            if (details[key] !== undefined) readable.push(`${key}=${describeStartupError(details[key], seen)}`);
        }
        if (readable.length) return readable.join('; ');
    }

    return String(error);
}

export async function bootstrap() {
    try {
        const app = await NestFactory.createApplicationContext(AppModule);
        logger.log('Agent service initialized successfully.');
        return app;
    } catch (error) {
        logger.error(
            `Agent startup failed: ${describeStartupError(error)}. ` +
            'Check RabbitMQ availability and the RABBITMQ_URL credentials.',
        );
        throw error;
    }
}

if (require.main === module) {
    void bootstrap().catch(() => {
        // Failed AMQP initialization can leave the transport retry manager's
        // timers alive; this fatal startup path must terminate instead of hang.
        process.exit(1);
    });
}
