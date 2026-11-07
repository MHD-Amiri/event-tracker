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

    const rabbitMqUrl =
        process.env.RABBITMQ_URL || 'amqp://guest:guest@localhost:5672';

    if (role === 'both' || role === 'ingest') {
        // 1. Ingestion queue listener
        app.connectMicroservice<MicroserviceOptions>({
            transport: Transport.RMQ,
            options: {
                urls: [rabbitMqUrl],
                queue: 'events_queue',
                queueOptions: { durable: true },
                noAck: false,
            },
        });
    }

    if (role === 'both' || role === 'evaluate') {
        // 2. Rule evaluation queue listener
        app.connectMicroservice<MicroserviceOptions>({
            transport: Transport.RMQ,
            options: {
                urls: [rabbitMqUrl],
                queue: 'events_evaluation_queue',
                queueOptions: { durable: true },
                noAck: false,
            },
        });
    }

    await app.startAllMicroservices();

    if (role === 'both' || role === 'ingest') {
        const port = process.env.PORT || 3000;
        await app.listen(port);
        console.log(`🚀 [role: ${role}] HTTP server running on: http://localhost:${port}`);
        console.log(`📡 [role: ${role}] Listening to RabbitMQ: 'events_queue' & 'events_evaluation_queue'`);
    } else {
        console.log(`📡 [role: ${role}] Pure evaluation worker — listening to RabbitMQ: 'events_evaluation_queue'`);
    }
}
bootstrap();
