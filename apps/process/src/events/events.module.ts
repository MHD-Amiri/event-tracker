import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { Event, EventSchema } from './schemas/event.schema';
import { EventsService } from './events.service';
import { EventsController } from './events.controller';

@Module({
    imports: [
        MongooseModule.forFeature([{ name: Event.name, schema: EventSchema }]),
        ClientsModule.registerAsync([
            {
                name: 'INTERNAL_RABBITMQ_SERVICE',
                imports: [ConfigModule],
                inject: [ConfigService],
                useFactory: (config: ConfigService) => ({
                    transport: Transport.RMQ,
                    options: {
                        // Accept either variable, mirroring main.ts, so consumers
                        // and this publisher can't land on different brokers
                        urls: [
                            config.get<string>('RABBITMQ_URI') ||
                            config.get<string>('RABBITMQ_URL') ||
                            'amqp://guest:guest@localhost:5672',
                        ],
                        // Must match the evaluation consumer's queue (RMQ_EVALUATION_QUEUE)
                        queue: config.get<string>('RMQ_EVALUATION_QUEUE', 'events_evaluation_queue'),
                        queueOptions: {
                            durable: true,
                        },
                    },
                }),
            },
        ]),
    ],
    controllers: [EventsController],
    providers: [EventsService],
})
export class EventsModule { }
