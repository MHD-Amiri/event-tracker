import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';
import { RuleOperator } from './rule.schema';

export type MatchedEventDocument = MatchedEvent & Document;

@Schema()
export class RuleSnapshot {
    @Prop({ required: true })
    name: string;

    @Prop({ required: true })
    eventName: string;

    @Prop({ required: true, type: String, enum: Object.values(RuleOperator) })
    operator: RuleOperator;

    @Prop({ required: true, type: Number })
    value: number;
}

// Explicit collection name: Mongoose would otherwise pluralize the class name
// into 'matchedevents'. snake_case matches the rest of the infra (events_queue, etc.)
@Schema({ collection: 'matched_events', timestamps: true })
export class MatchedEvent {
    // Indexed via the compound indexes below ({ ruleId, matchedAt } and
    // { agentId, matchedAt })
    @Prop({ required: true, type: Types.ObjectId, ref: 'Rule' })
    ruleId: Types.ObjectId;

    // Snapshot of the rule at match time (preserves reporting if the rule
    // is later edited or deleted)
    @Prop({ type: RuleSnapshot, _id: false })
    ruleSnapshot: RuleSnapshot;

    // Indexed via the compound index below ({ agentId, matchedAt })
    @Prop({ required: true })
    agentId: string;

    @Prop({ required: true })
    eventName: string;

    @Prop({ required: true, type: Number })
    eventValue: number;

    // Suffix of the compound indexes above
    @Prop({ required: true })
    matchedAt: Date;
}

export const MatchedEventSchema = SchemaFactory.createForClass(MatchedEvent);

// Compound index for Rule Reporting query (RuleId + matchedAt window)
MatchedEventSchema.index({ ruleId: 1, matchedAt: -1 });
// Compound index for Agent Ranking query
MatchedEventSchema.index({ agentId: 1, matchedAt: -1 });
