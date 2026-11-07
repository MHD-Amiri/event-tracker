import { Injectable, Inject, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientProxy } from '@nestjs/microservices';
import { Model } from 'mongoose';
import { Event, EventDocument } from './schemas/event.schema';

export interface IncomingEventDto {
    agentId: string;
    timestamp: string;
    payload: {
        name: string;
        value: number;
    };
}

@Injectable()
export class EventsService {
    private readonly logger = new Logger(EventsService.name);

    constructor(
        @InjectModel(Event.name) private readonly eventModel: Model<EventDocument>,
        @Inject('INTERNAL_RABBITMQ_SERVICE') private readonly rmqClient: ClientProxy,
    ) { }

    async create(dto: IncomingEventDto): Promise<void> {
        // Deterministic _id built from the message content: if the consumer
        // nacks (e.g. the emit below failed) and RabbitMQ redelivers, the
        // second save hits a duplicate key and is a no-op instead of a
        // duplicate row
        const createdEvent = new this.eventModel({
            _id: `${dto.agentId}|${dto.timestamp}|${dto.payload.name}|${dto.payload.value}`,
            agentId: dto.agentId,
            timestamp: new Date(dto.timestamp),
            payload: dto.payload,
        });

        try {
            await createdEvent.save();
        } catch (err) {
            // 11000 = duplicate key — this message was already persisted on a
            // previous delivery; safe to continue to the emit
            if ((err as any)?.code !== 11000) throw err;
        }

        // Awaiting the emit: resolves once the message is written to the
        // broker, rejects on failure so the consumer nacks and the whole
        // message (persist + emit) is retried as a unit
        await new Promise<void>((resolve, reject) => {
            this.rmqClient.emit('evaluate_event', dto).subscribe({
                next: () => resolve(),
                error: reject,
                complete: () => resolve(),
            });
        });
    }
}
