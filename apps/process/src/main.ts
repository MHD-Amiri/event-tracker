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

    // Connect RabbitMQ microservice listener
    app.connectMicroservice<MicroserviceOptions>({
        transport: Transport.RMQ,
        options: {
            urls: [rabbitMqUrl],
            queue: 'events_queue',
            queueOptions: {
                durable: true,
            },
        },
    });

    await app.startAllMicroservices();
    const port = process.env.PORT || 3000;
    await app.listen(port);

    console.log(`🚀 Process HTTP server running on: http://localhost:${port}`);
    console.log(`📡 Process Microservice listening to RabbitMQ queue 'events_queue'`);
}
bootstrap();
