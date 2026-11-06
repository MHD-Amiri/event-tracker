import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type EventDocument = Event & Document;

@Schema({ _id: false })
export class EventPayload {
    @Prop({ required: true })
    name: string;

    @Prop({ required: true })
    value: number;
}

@Schema({ timestamps: true, collection: 'events' })
export class Event {
    @Prop({ required: true, index: true })
    agentId: string;

    @Prop({ required: true, index: true })
    timestamp: Date;

    @Prop({ required: true, type: EventPayload })
    payload: EventPayload;
}

export const EventSchema = SchemaFactory.createForClass(Event);

// Compound index for querying events by agent and time efficiently
EventSchema.index({ agentId: 1, timestamp: -1 });
