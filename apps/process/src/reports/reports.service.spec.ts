import { BadRequestException } from '@nestjs/common';
import { Types } from 'mongoose';
import { ReportsService } from './reports.service';
import { RankingService } from '../ranking/ranking.service';
import { MatchedEventDocument } from '../rules/schemas/matched-event.schema';

describe('ReportsService', () => {
    const ruleId = '507f1f77bcf86cd799439011';
    const start = '2026-11-09T00:00:00.000Z';
    const end = '2026-11-09T06:00:00.000Z';
    let aggregate: jest.Mock;
    let getRanking: jest.Mock;
    let service: ReportsService;

    const createService = (windowHours?: string) => {
        const model = { aggregate } as unknown as import('mongoose').Model<MatchedEventDocument>;
        const ranking = { getRanking } as unknown as RankingService;
        const config = { get: jest.fn().mockReturnValue(windowHours) };
        return new ReportsService(model, ranking, config as any);
    };

    beforeEach(() => {
        aggregate = jest.fn().mockResolvedValue([]);
        getRanking = jest.fn().mockResolvedValue([]);
        service = createService();
    });

    describe('getAgentTimestamps()', () => {
        it('rejects a malformed Rule id before querying Mongo', async () => {
            await expect(
                service.getAgentTimestamps('not-an-object-id', start, end),
            ).rejects.toThrow(BadRequestException);
            expect(aggregate).not.toHaveBeenCalled();
        });

        it.each([
            ['invalid start', 'not-a-date', end],
            ['invalid end', start, 'not-a-date'],
        ])('rejects an %s date', async (_label, from, to) => {
            await expect(service.getAgentTimestamps(ruleId, from, to)).rejects.toThrow(
                BadRequestException,
            );
            expect(aggregate).not.toHaveBeenCalled();
        });

        it('rejects reversed date ranges', async () => {
            await expect(service.getAgentTimestamps(ruleId, end, start)).rejects.toThrow(
                BadRequestException,
            );
            expect(aggregate).not.toHaveBeenCalled();
        });

        it('never allows configuration to raise the hard 24-hour ceiling', async () => {
            service = createService('48');
            await expect(
                service.getAgentTimestamps(ruleId, start, '2026-11-10T00:00:00.001Z'),
            ).rejects.toThrow('Time window must be at most 24 hours.');
            expect(aggregate).not.toHaveBeenCalled();
        });

        it('uses inclusive time bounds and a stable bounded keyset query', async () => {
            const rows = [
                { eventId: 'event-1', agentId: 'a1', matchedAt: new Date(start) },
                { eventId: 'event-2', agentId: 'a1', matchedAt: new Date(end) },
            ];
            aggregate.mockResolvedValue(rows);

            await expect(service.getAgentTimestamps(ruleId, start, end)).resolves.toEqual({
                items: [{ agentId: 'a1', count: 2, matchedAt: [new Date(start), new Date(end)] }],
                limit: 100,
                nextCursor: null,
            });
            expect(aggregate).toHaveBeenCalledWith(
                expect.arrayContaining([
                    {
                        $match: {
                            ruleId: new Types.ObjectId(ruleId),
                            matchedAt: { $gte: new Date(start), $lte: new Date(end) },
                        },
                    },
                    { $unionWith: expect.objectContaining({ coll: 'matched_events_archive' }) },
                    { $sort: { matchedAt: 1, eventId: 1 } },
                    { $limit: 101 },
                ]),
            );
        });

        it.each(['0', '-1', '501', '1.5', 'abc'])(
            'rejects invalid or unbounded page size %s',
            async (pageSize) => {
                await expect(
                    service.getAgentTimestamps(ruleId, start, end, pageSize),
                ).rejects.toThrow(BadRequestException);
                expect(aggregate).not.toHaveBeenCalled();
            },
        );

        it('returns a cursor after the last included row and accepts it on the next page', async () => {
            const rows = Array.from({ length: 3 }, (_, index) => ({
                eventId: `event-${index}`,
                agentId: `agent-${index}`,
                matchedAt: new Date(Date.parse(start) + index * 1000),
            }));
            aggregate.mockResolvedValueOnce(rows);
            const result = await service.getAgentTimestamps(ruleId, start, end, '2');
            expect(result.items).toHaveLength(2);
            expect(result.nextCursor).toBeTruthy();

            await service.getAgentTimestamps(ruleId, start, end, '2', result.nextCursor!);
            const secondPagePipeline = aggregate.mock.calls[1][0];
            expect(secondPagePipeline[0].$match).toEqual(
                expect.objectContaining({
                    $or: [
                        { matchedAt: { $gt: rows[1].matchedAt } },
                        { matchedAt: rows[1].matchedAt, eventId: { $gt: rows[1].eventId } },
                    ],
                }),
            );
        });

        it('rejects malformed cursors', async () => {
            await expect(
                service.getAgentTimestamps(ruleId, start, end, undefined, 'bad!'),
            ).rejects.toThrow(BadRequestException);
            expect(aggregate).not.toHaveBeenCalled();
        });

        it('allows a smaller configured time window', async () => {
            service = createService('2');
            await expect(service.getAgentTimestamps(ruleId, start, end)).rejects.toThrow(
                'Time window must be at most 2 hours.',
            );
            expect(aggregate).not.toHaveBeenCalled();
        });
    });

    describe('getAgentRanking()', () => {
        it('returns the durable projection ranking without scanning Match history', async () => {
            const ranking = [{ agentId: 'agent-1', totalMatches: 7 }];
            getRanking.mockResolvedValue(ranking);
            await expect(service.getAgentRanking(ruleId)).resolves.toBe(ranking);
            expect(getRanking).toHaveBeenCalledWith(new Types.ObjectId(ruleId));
            expect(aggregate).not.toHaveBeenCalled();
        });

        it('rejects a malformed Rule id before checking the cache', async () => {
            await expect(service.getAgentRanking('invalid-id')).rejects.toThrow(
                BadRequestException,
            );
            expect(getRanking).not.toHaveBeenCalled();
        });
    });
});
