import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type MatchedEventDocument = MatchedEvent & Document;

@Schema({ timestamps: true })
export class MatchedEvent {
    @Prop({ required: true, type: Types.ObjectId, ref: 'Rule', index: true })
    ruleId: Types.ObjectId;

    // Snapshot rule name at the time of match (preserves reporting if rule changes)
    @Prop({ required: true })
    ruleName: string;

    @Prop({ required: true, index: true })
    agentId: string;

    @Prop({ required: true })
    eventName: string;

    @Prop({ required: true, type: Number })
    eventValue: number;

    @Prop({ required: true, index: true })
    matchedAt: Date;
}

export const MatchedEventSchema = SchemaFactory.createForClass(MatchedEvent);

// Compound index for Rule Reporting query (RuleId + matchedAt window)
MatchedEventSchema.index({ ruleId: 1, matchedAt: -1 });
// Compound index for Agent Ranking query
MatchedEventSchema.index({ agentId: 1, matchedAt: -1 });
