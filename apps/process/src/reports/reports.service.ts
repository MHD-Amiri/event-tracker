import { Injectable, BadRequestException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { MatchedEvent, MatchedEventDocument } from '../rules/schemas/matched-event.schema';

@Injectable()
export class ReportsService {
    constructor(
        @InjectModel(MatchedEvent.name) private matchedEventModel: Model<MatchedEventDocument>,
    ) { }

    // API 1: Timestamps per agent for a rule within a max 1-day window
    async getAgentTimestamps(ruleId: string, start: string, end: string) {
        if (!Types.ObjectId.isValid(ruleId)) {
            throw new BadRequestException('Invalid ruleId format.');
        }

        const startDate = new Date(start);
        const endDate = new Date(end);

        if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
            throw new BadRequestException('Invalid start or end date format.');
        }

        const diffHours = (endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60);
        if (diffHours > 24 || diffHours < 0) {
            throw new BadRequestException('Time window must be at most 24 hours.');
        }

        const objectId = new Types.ObjectId(ruleId);

        // Aggregation grouped by agentId
        const results = await this.matchedEventModel.aggregate([
            {
                $match: {
                    ruleId: objectId,
                    matchedAt: { $gte: startDate, $lte: endDate },
                },
            },
            {
                $group: {
                    _id: '$agentId',
                    matchedAt: { $push: '$matchedAt' },
                    count: { $sum: 1 },
                },
            },
            {
                $project: {
                    _id: 0,
                    agentId: '$_id',
                    count: 1,
                    matchedAt: 1,
                },
            },
        ]);

        return results;
    }

    // API 2: Agent ranking by match count for a rule (all-time)
    async getAgentRanking(ruleId: string) {
        if (!Types.ObjectId.isValid(ruleId)) {
            throw new BadRequestException('Invalid ruleId format.');
        }

        const objectId = new Types.ObjectId(ruleId);

        const results = await this.matchedEventModel.aggregate([
            {
                $match: {
                    ruleId: objectId,
                },
            },
            {
                $group: {
                    _id: '$agentId',
                    totalMatches: { $sum: 1 },
                },
            },
            {
                $sort: { totalMatches: -1 }, // Descending order (highest matches first)
            },
            {
                $project: {
                    _id: 0,
                    agentId: '$_id',
                    totalMatches: 1,
                },
            },
        ]);

        return results;
    }
}
