import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
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
    ) { }

    async create(dto: IncomingEventDto): Promise<EventDocument> {
        const createdEvent = new this.eventModel({
            agentId: dto.agentId,
            timestamp: new Date(dto.timestamp),
            payload: dto.payload,
        });

        return createdEvent.save();
    }
}
