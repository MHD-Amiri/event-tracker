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
                        urls: [config.get<string>('RABBITMQ_URI', 'amqp://guest:guest@localhost:5672')],
                        queue: 'events_evaluation_queue',
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
