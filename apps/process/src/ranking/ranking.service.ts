import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { MatchedEvent, MatchedEventDocument } from '../rules/schemas/matched-event.schema';
import { RuleAgentCount, RuleAgentCountDocument } from './rule-agent-count.schema';

export interface MatchCountInput extends Partial<MatchedEvent> {
    ruleId: Types.ObjectId;
    eventId: string;
    agentId: string;
}

@Injectable()
export class RankingService {
    constructor(
        @InjectModel(MatchedEvent.name) private readonly matchedEventModel: Model<MatchedEventDocument>,
        @InjectModel(RuleAgentCount.name) private readonly countModel: Model<RuleAgentCountDocument>,
    ) { }

    /** Record one idempotent Match and its durable count in the same Mongo transaction. */
    async recordMatches(matches: MatchCountInput[]): Promise<void> {
        if (matches.length === 0) return;

        const session = await this.matchedEventModel.db.startSession();
        try {
            await session.withTransaction(async () => {
                for (const match of matches) {
                    const result = await this.matchedEventModel.updateOne(
                        { ruleId: match.ruleId, eventId: match.eventId },
                        { $setOnInsert: match },
                        { upsert: true, session },
                    );
                    if (result.upsertedCount > 0) {
                        await this.countModel.updateOne(
                            { ruleId: match.ruleId, agentId: match.agentId },
                            { $inc: { totalMatches: 1 }, $setOnInsert: { ruleId: match.ruleId, agentId: match.agentId } },
                            { upsert: true, session },
                        );
                    }
                }
            });
        } finally {
            await session.endSession();
        }
    }

    async getRanking(ruleId: Types.ObjectId): Promise<{ agentId: string; totalMatches: number }[]> {
        return this.countModel
            .find({ ruleId })
            .sort({ totalMatches: -1, agentId: 1 })
            .select({ _id: 0, agentId: 1, totalMatches: 1 })
            .lean();
    }

    /**
     * Rebuild counts from immutable Match history. Pause evaluation consumers
     * before running this maintenance operation so writes cannot race the rebuild.
     */
    async rebuildFromMatchHistory(): Promise<void> {
        const counts = await this.matchedEventModel.aggregate([
            { $group: { _id: { ruleId: '$ruleId', agentId: '$agentId' }, totalMatches: { $sum: 1 } } },
            { $project: { _id: 0, ruleId: '$_id.ruleId', agentId: '$_id.agentId', totalMatches: 1 } },
        ]);
        const session = await this.countModel.db.startSession();
        try {
            await session.withTransaction(async () => {
                await this.countModel.deleteMany({}, { session });
                if (counts.length) await this.countModel.insertMany(counts, { session });
            });
        } finally {
            await session.endSession();
        }
    }
}
