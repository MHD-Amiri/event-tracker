import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
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

if (require.main === module) {
    void bootstrap();
}
