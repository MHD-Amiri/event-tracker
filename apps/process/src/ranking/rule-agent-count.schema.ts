import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type RuleAgentCountDocument = RuleAgentCount & Document;

@Schema({ collection: 'rule_agent_counts', timestamps: true })
export class RuleAgentCount {
    @Prop({ required: true, type: Types.ObjectId })
    ruleId: Types.ObjectId;

    @Prop({ required: true })
    agentId: string;

    @Prop({ required: true, type: Number, min: 1 })
    totalMatches: number;
}

export const RuleAgentCountSchema = SchemaFactory.createForClass(RuleAgentCount);
RuleAgentCountSchema.index({ ruleId: 1, agentId: 1 }, { unique: true });
RuleAgentCountSchema.index({ ruleId: 1, totalMatches: -1, agentId: 1 });
