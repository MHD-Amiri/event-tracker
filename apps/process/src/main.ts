import { NestFactory } from '@nestjs/core';
import { Logger, ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';
import { consumerMicroservice, queueNames, type ConfigReader } from '@app/rmq';

// Bootstrap runs outside the DI container, so it can't inject ConfigService.
// ConfigModule.forRoot() (in app.module.ts, evaluated before this function runs)
// has already copied .env values into process.env, so a read-through adapter
// sees the same values ConfigService would return.
const env: ConfigReader = {
    get<T = string>(key: string, defaultValue?: T): T {
        const raw = process.env[key];
        return (raw ?? defaultValue) as T;
    },
};

// Deployment role: 'both' (default, single-process dev setup), 'ingest'
// (events_queue consumer + HTTP + report APIs), or 'evaluate'
// (events_evaluation_queue consumer only — scale this tier independently)
export async function bootstrap(role = process.env.PROCESS_ROLE || 'both') {
    const app = await NestFactory.create(AppModule);
    app.enableShutdownHooks();

    // Global validation pipe for upcoming Rules API
    app.useGlobalPipes(
        new ValidationPipe({
            whitelist: true,
            transform: true,
            forbidNonWhitelisted: true,
        }),
    );

    const queues = queueNames(env);

    if (role === 'both' || role === 'ingest') {
        // 1. Ingestion queue listener
        app.connectMicroservice(consumerMicroservice(queues.ingestion, env));
    }

    if (role === 'both' || role === 'evaluate') {
        // 2. Rule evaluation queue listener
        app.connectMicroservice(consumerMicroservice(queues.evaluation, env));
    }

    await app.startAllMicroservices();

    if (role === 'both' || role === 'ingest') {
        const port = process.env.PORT || 3000;
        await app.listen(port);
        console.log(`🚀 [role: ${role}] HTTP server running on: http://localhost:${port}`);
        console.log(`📡 [role: ${role}] Listening to RabbitMQ: '${queues.ingestion}' & '${queues.evaluation}'`);
    } else {
        console.log(`📡 [role: ${role}] Pure evaluation worker — listening to RabbitMQ: '${queues.evaluation}'`);
    }
}

export async function runBootstrap(): Promise<boolean> {
    try {
        await bootstrap();
        return true;
    } catch (error) {
        const detail = describeStartupError(error);
        Logger.error(`Process startup failed: ${detail}`, undefined, 'ProcessBootstrap');
        process.exitCode = 1;
        return false;
    }
}

function describeStartupError(error: unknown, seen = new WeakSet<object>()): string {
    if (error instanceof Error) {
        if (seen.has(error)) return '[circular error cause]';
        seen.add(error);
        const cause = (error as Error & { cause?: unknown }).cause;
        return `${error.name}: ${error.message}${cause === undefined ? '' : `; cause=${describeStartupError(cause, seen)}`}`;
    }
    if (typeof error === 'object' && error !== null) {
        if (seen.has(error)) return '[circular error detail]';
        seen.add(error);
        try {
            return JSON.stringify(error) ?? String(error);
        } catch {
            return '[unserializable error details]';
        }
    }
    return String(error);
}

if (require.main === module) {
    void runBootstrap().then((started) => {
        if (!started) process.exit(1);
    });
}
