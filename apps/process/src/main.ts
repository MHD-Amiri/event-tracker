import { NestFactory } from '@nestjs/core';
import { MicroserviceOptions, Transport } from '@nestjs/microservices';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';

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

    // 1. Ingestion queue listener
    app.connectMicroservice<MicroserviceOptions>({
        transport: Transport.RMQ,
        options: {
            urls: [rabbitMqUrl],
            queue: 'events_queue',
            queueOptions: { durable: true },
            noAck: false
        },
    });

    // 2. Rule evaluation queue listener
    app.connectMicroservice<MicroserviceOptions>({
        transport: Transport.RMQ,
        options: {
            urls: [rabbitMqUrl],
            queue: 'events_evaluation_queue',
            queueOptions: { durable: true },
            noAck: false
        },
    });

    await app.startAllMicroservices();
    const port = process.env.PORT || 3000;
    await app.listen(port);

    console.log(`🚀 Process HTTP server running on: http://localhost:${port}`);
    console.log(`📡 Process listening to RabbitMQ: 'events_queue' & 'events_evaluation_queue'`);
}
bootstrap();
