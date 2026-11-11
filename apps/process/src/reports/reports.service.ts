import { Injectable, BadRequestException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ConfigService } from '@nestjs/config';
import { Model, Types } from 'mongoose';
import { MatchedEvent, MatchedEventDocument } from '../rules/schemas/matched-event.schema';
import { RankingService } from '../ranking/ranking.service';

const MAX_REPORT_WINDOW_HOURS = 24;
const DEFAULT_PAGE_SIZE = 100;
const MAX_PAGE_SIZE = 500;

interface TimestampRow {
    eventId: string;
    agentId: string;
    matchedAt: Date;
}

interface TimestampCursor {
    matchedAt: string;
    eventId: string;
}

@Injectable()
export class ReportsService {
    private readonly maxReportWindowHours: number;

    constructor(
        @InjectModel(MatchedEvent.name) private matchedEventModel: Model<MatchedEventDocument>,
        private readonly rankingService: RankingService,
        configService: ConfigService,
    ) {
        const raw = configService.get<string>('REPORT_MAX_WINDOW_HOURS');
        const parsed = raw ? Number(raw) : MAX_REPORT_WINDOW_HOURS;
        this.maxReportWindowHours =
            Number.isFinite(parsed) && parsed > 0
                ? Math.min(parsed, MAX_REPORT_WINDOW_HOURS)
                : MAX_REPORT_WINDOW_HOURS;
    }

    async getAgentTimestamps(
        ruleId: string,
        start: string,
        end: string,
        limit?: string,
        cursor?: string,
    ) {
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
            throw new BadRequestException(
                `Time window must be at most ${this.maxReportWindowHours} hours.`,
            );
        }

        const pageSize = this.parsePageSize(limit);
        const after = cursor ? this.decodeCursor(cursor) : undefined;
        if (after && (after.matchedAt < startDate || after.matchedAt > endDate)) {
            throw new BadRequestException('Cursor is outside the requested time range.');
        }

        const filter: Record<string, unknown> = {
            ruleId: new Types.ObjectId(ruleId),
            matchedAt: { $gte: startDate, $lte: endDate },
        };
        if (after) {
            filter.$or = [
                { matchedAt: { $gt: after.matchedAt } },
                { matchedAt: after.matchedAt, eventId: { $gt: after.eventId } },
            ];
        }

        const pageQuery = [
            { $match: filter },
            { $sort: { matchedAt: 1 as const, eventId: 1 as const } },
            { $limit: pageSize + 1 },
        ];
        const rows = (await this.matchedEventModel.aggregate([
            ...pageQuery,
            {
                $unionWith: {
                    coll: 'matched_events_archive',
                    pipeline: pageQuery,
                },
            },
            { $sort: { matchedAt: 1, eventId: 1 } },
            { $limit: pageSize + 1 },
            { $project: { _id: 0, eventId: 1, agentId: 1, matchedAt: 1 } },
        ])) as TimestampRow[];

        const hasMore = rows.length > pageSize;
        const page = rows.slice(0, pageSize);
        const grouped = new Map<string, { agentId: string; count: number; matchedAt: Date[] }>();
        for (const row of page) {
            let group = grouped.get(row.agentId);
            if (!group) {
                group = { agentId: row.agentId, count: 0, matchedAt: [] };
                grouped.set(row.agentId, group);
            }
            group.count += 1;
            group.matchedAt.push(row.matchedAt);
        }

        return {
            items: [...grouped.values()],
            limit: pageSize,
            nextCursor: hasMore ? this.encodeCursor(page[page.length - 1]) : null,
        };
    }

    async getAgentRanking(ruleId: string) {
        if (!Types.ObjectId.isValid(ruleId)) {
            throw new BadRequestException('Invalid ruleId format.');
        }
        return this.rankingService.getRanking(new Types.ObjectId(ruleId));
    }

    private parsePageSize(raw?: string): number {
        if (raw === undefined) return DEFAULT_PAGE_SIZE;
        if (!/^\d+$/.test(raw))
            throw new BadRequestException('limit must be an integer between 1 and 500.');
        const value = Number(raw);
        if (!Number.isSafeInteger(value) || value < 1 || value > MAX_PAGE_SIZE) {
            throw new BadRequestException('limit must be an integer between 1 and 500.');
        }
        return value;
    }

    private decodeCursor(raw: string): { matchedAt: Date; eventId: string } {
        try {
            if (!/^[A-Za-z0-9_-]+$/.test(raw)) throw new Error();
            const parsed = JSON.parse(Buffer.from(raw, 'base64url').toString()) as TimestampCursor;
            const matchedAt = new Date(parsed.matchedAt);
            if (
                !parsed ||
                isNaN(matchedAt.getTime()) ||
                typeof parsed.eventId !== 'string' ||
                !parsed.eventId
            )
                throw new Error();
            return { matchedAt, eventId: parsed.eventId };
        } catch {
            throw new BadRequestException('Invalid cursor.');
        }
    }

    private encodeCursor(row: TimestampRow): string {
        return Buffer.from(
            JSON.stringify({ matchedAt: row.matchedAt.toISOString(), eventId: row.eventId }),
        ).toString('base64url');
    }
}
