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

    async create(dto: IncomingEventDto): Promise<EventDocument> {
        const createdEvent = new this.eventModel({
            agentId: dto.agentId,
            timestamp: new Date(dto.timestamp),
            payload: dto.payload,
        });

        // 2. Fire and forget to internal evaluation queue
        this.rmqClient.emit('evaluate_event', createdEvent);

        return createdEvent.save();
    }
}
