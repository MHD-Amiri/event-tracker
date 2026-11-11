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

// The event as it crosses the RMQ seam, in the shape the agent publishes it.
// Kept next to the persisted schema because they differ in exactly one way:
// the agent's ISO timestamp becomes a Date here.
export interface SensorEventMessage {
    eventId: string;
    agentId: string;
    timestamp: string; // ISO 8601
    payload: {
        name: string;
        value: number;
    };
}

// _id is the stable agent-generated eventId, so a redelivered message is a
// no-op instead of a duplicate row — see pipeline.service.ts ingest().
@Schema({ timestamps: true, collection: 'events' })
export class Event {
    @Prop({ required: true })
    _id: string;

    @Prop({ required: true })
    agentId: string;

    @Prop({ required: true })
    timestamp: Date;

    @Prop({ required: true, type: EventPayload })
    payload: EventPayload;
}

export const EventSchema = SchemaFactory.createForClass(Event);

// Compound index for querying events by agent and time efficiently
EventSchema.index({ agentId: 1, timestamp: -1 });
EventSchema.index({ timestamp: 1 });

export class ArchivedEvent extends Event {}
export const ArchivedEventSchema = EventSchema.clone();
ArchivedEventSchema.set('collection', 'events_archive');
