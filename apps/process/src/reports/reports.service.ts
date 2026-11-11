import { Injectable, BadRequestException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ConfigService } from '@nestjs/config';
import { Model, Types } from 'mongoose';
import { MatchedEvent, MatchedEventDocument } from '../rules/schemas/matched-event.schema';
import { RankingService } from '../ranking/ranking.service';

@Injectable()
export class ReportsService {
    // Max report window in hours; requests spanning more are rejected
    private readonly maxReportWindowHours: number;

    constructor(
        @InjectModel(MatchedEvent.name) private matchedEventModel: Model<MatchedEventDocument>,
        private readonly rankingService: RankingService,
        configService: ConfigService,
    ) {
        const raw = configService.get<string>('REPORT_MAX_WINDOW_HOURS');
        const parsed = raw ? Number(raw) : 24;
        this.maxReportWindowHours =
            Number.isFinite(parsed) && parsed > 0 ? parsed : 24;
    }

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
        if (diffHours > this.maxReportWindowHours || diffHours < 0) {
            throw new BadRequestException(`Time window must be at most ${this.maxReportWindowHours} hours.`);
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
    // Rankings are read from durable per-rule/per-agent counters, never from
    // an aggregation over Match history.
    async getAgentRanking(ruleId: string) {
        if (!Types.ObjectId.isValid(ruleId)) {
            throw new BadRequestException('Invalid ruleId format.');
        }

        const objectId = new Types.ObjectId(ruleId);
        return this.rankingService.getRanking(objectId);
    }
}
