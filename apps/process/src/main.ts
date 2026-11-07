import { NestFactory } from '@nestjs/core';
import { MicroserviceOptions, Transport } from '@nestjs/microservices';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';

// Deployment role: 'both' (default, single-process dev setup), 'ingest'
// (events_queue consumer + HTTP + report APIs), or 'evaluate'
// (events_evaluation_queue consumer only — scale this tier independently)
const role = process.env.PROCESS_ROLE || 'both';

async function bootstrap() {
    const app = await NestFactory.create(AppModule);

    // Global validation pipe for upcoming Rules API
    app.useGlobalPipes(
        new ValidationPipe({
            whitelist: true,
            transform: true,
            forbidNonWhitelisted: true,
        }),
    );

    // Accept either variable so consumers and the ingest publisher can't end
    // up on different brokers when only one is set (events.module reads RABBITMQ_URI)
    const rabbitMqUrl =
        process.env.RABBITMQ_URL ||
        process.env.RABBITMQ_URI ||
        'amqp://guest:guest@localhost:5672';

    // Caps the unacked-message buffer per consumer so a slow consumer can't
    // have the broker push an unbounded backlog into memory
    const prefetchCount = Number(process.env.RMQ_PREFETCH_COUNT) || 500;

    const ingestionQueue = process.env.RMQ_INGESTION_QUEUE || 'events_queue';
    const evaluationQueue = process.env.RMQ_EVALUATION_QUEUE || 'events_evaluation_queue';

    if (role === 'both' || role === 'ingest') {
        // 1. Ingestion queue listener
        app.connectMicroservice<MicroserviceOptions>({
            transport: Transport.RMQ,
            options: {
                urls: [rabbitMqUrl],
                queue: ingestionQueue,
                queueOptions: { durable: true },
                noAck: false,
                prefetchCount,
            },
        });
    }

    if (role === 'both' || role === 'evaluate') {
        // 2. Rule evaluation queue listener
        app.connectMicroservice<MicroserviceOptions>({
            transport: Transport.RMQ,
            options: {
                urls: [rabbitMqUrl],
                queue: evaluationQueue,
                queueOptions: { durable: true },
                noAck: false,
                prefetchCount,
            },
        });
    }

    await app.startAllMicroservices();

    if (role === 'both' || role === 'ingest') {
        const port = process.env.PORT || 3000;
        await app.listen(port);
        console.log(`🚀 [role: ${role}] HTTP server running on: http://localhost:${port}`);
        console.log(`📡 [role: ${role}] Listening to RabbitMQ: '${ingestionQueue}' & '${evaluationQueue}'`);
    } else {
        console.log(`📡 [role: ${role}] Pure evaluation worker — listening to RabbitMQ: '${evaluationQueue}'`);
    }
}
bootstrap();
