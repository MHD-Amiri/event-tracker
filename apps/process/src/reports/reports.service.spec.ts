import { BadRequestException } from '@nestjs/common';
import { Types } from 'mongoose';
import { ReportsService } from './reports.service';
import { RedisService } from '../redis/redis.service';
import { MatchedEventDocument } from '../rules/schemas/matched-event.schema';

describe('ReportsService', () => {
    const ruleId = '507f1f77bcf86cd799439011';
    const start = '2026-11-09T00:00:00.000Z';
    const end = '2026-11-09T06:00:00.000Z';

    let aggregate: jest.Mock;
    let getRankingCache: jest.Mock;
    let setRankingCache: jest.Mock;
    let service: ReportsService;

    const createService = (windowHours?: string) => {
        const model = { aggregate } as unknown as { aggregate: typeof aggregate } & import('mongoose').Model<MatchedEventDocument>;
        const redis = { getRankingCache, setRankingCache } as unknown as RedisService;
        const config = { get: jest.fn().mockReturnValue(windowHours) };
        return new ReportsService(model, redis, config as any);
    };

    beforeEach(() => {
        aggregate = jest.fn().mockResolvedValue([]);
        getRankingCache = jest.fn().mockResolvedValue(null);
        setRankingCache = jest.fn().mockResolvedValue(undefined);
        service = createService();
    });

    describe('getAgentTimestamps()', () => {
        it('rejects a malformed Rule id before querying Mongo', async () => {
            await expect(service.getAgentTimestamps('not-an-object-id', start, end))
                .rejects.toThrow(new BadRequestException('Invalid ruleId format.'));

            expect(aggregate).not.toHaveBeenCalled();
        });

        it.each([
            ['invalid start', 'not-a-date', end],
            ['invalid end', start, 'not-a-date'],
        ])('rejects an %s date', async (_label, from, to) => {
            await expect(service.getAgentTimestamps(ruleId, from, to))
                .rejects.toThrow(new BadRequestException('Invalid start or end date format.'));

            expect(aggregate).not.toHaveBeenCalled();
        });

        it('rejects reversed date ranges', async () => {
            await expect(service.getAgentTimestamps(ruleId, end, start))
                .rejects.toThrow(BadRequestException);

            expect(aggregate).not.toHaveBeenCalled();
        });

        it('rejects a range longer than the configured maximum', async () => {
            service = createService('6');

            await expect(service.getAgentTimestamps(
                ruleId,
                start,
                '2026-11-09T06:00:00.001Z',
            )).rejects.toThrow(new BadRequestException('Time window must be at most 6 hours.'));

            expect(aggregate).not.toHaveBeenCalled();
        });

        it('accepts the exact configured maximum and queries inclusive date bounds', async () => {
            service = createService('6');
            const rows = [{ agentId: 'agent-1', count: 2, matchedAt: [new Date(start), new Date(end)] }];
            aggregate.mockResolvedValue(rows);

            await expect(service.getAgentTimestamps(ruleId, start, end)).resolves.toBe(rows);

            expect(aggregate).toHaveBeenCalledWith([
                {
                    $match: {
                        ruleId: new Types.ObjectId(ruleId),
                        matchedAt: { $gte: new Date(start), $lte: new Date(end) },
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
        });

        it('accepts a zero-length range', async () => {
            await expect(service.getAgentTimestamps(ruleId, start, start)).resolves.toEqual([]);
            expect(aggregate).toHaveBeenCalledTimes(1);
        });

        it.each([undefined, '', 'not-a-number', '0', '-2'])(
            'uses the 24-hour default when configured maximum is %s',
            async (configuredHours) => {
                service = createService(configuredHours);

                await expect(service.getAgentTimestamps(
                    ruleId,
                    start,
                    '2026-11-10T00:00:00.001Z',
                )).rejects.toThrow(new BadRequestException('Time window must be at most 24 hours.'));
                expect(aggregate).not.toHaveBeenCalled();
            },
        );

        it('uses a valid configured maximum', async () => {
            service = createService('2');

            await expect(service.getAgentTimestamps(ruleId, start, end))
                .rejects.toThrow(new BadRequestException('Time window must be at most 2 hours.'));
            expect(aggregate).not.toHaveBeenCalled();
        });
    });

    describe('getAgentRanking()', () => {
        it('returns a cached ranking without querying Mongo', async () => {
            const ranking = [{ agentId: 'agent-1', totalMatches: 7 }];
            getRankingCache.mockResolvedValue(ranking);

            await expect(service.getAgentRanking(ruleId)).resolves.toBe(ranking);

            expect(getRankingCache).toHaveBeenCalledWith(ruleId);
            expect(aggregate).not.toHaveBeenCalled();
            expect(setRankingCache).not.toHaveBeenCalled();
        });

        it('aggregates, caches, and returns the ranking on a cache miss', async () => {
            const ranking = [
                { agentId: 'agent-2', totalMatches: 8 },
                { agentId: 'agent-1', totalMatches: 3 },
            ];
            aggregate.mockResolvedValue(ranking);

            await expect(service.getAgentRanking(ruleId)).resolves.toBe(ranking);

            expect(aggregate).toHaveBeenCalledWith([
                { $match: { ruleId: new Types.ObjectId(ruleId) } },
                { $group: { _id: '$agentId', totalMatches: { $sum: 1 } } },
                { $sort: { totalMatches: -1 } },
                { $project: { _id: 0, agentId: '$_id', totalMatches: 1 } },
            ]);
            expect(setRankingCache).toHaveBeenCalledWith(ruleId, ranking);
        });

        it('rejects a malformed Rule id before checking the cache', async () => {
            await expect(service.getAgentRanking('invalid-id')).rejects.toThrow(BadRequestException);

            expect(getRankingCache).not.toHaveBeenCalled();
            expect(aggregate).not.toHaveBeenCalled();
        });
    });
});
