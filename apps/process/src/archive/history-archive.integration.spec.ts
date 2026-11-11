import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { ConfigService } from '@nestjs/config';
import {
    ArchivedEvent,
    ArchivedEventSchema,
    Event,
    EventSchema,
} from '../pipeline/schemas/event.schema';
import {
    ArchivedMatchedEvent,
    ArchivedMatchedEventSchema,
    MatchedEvent,
    MatchedEventSchema,
} from '../rules/schemas/matched-event.schema';
import { RuleAgentCount, RuleAgentCountSchema } from '../ranking/rule-agent-count.schema';
import { RankingService } from '../ranking/ranking.service';
import { ReportsService } from '../reports/reports.service';
import { HistoryArchiveService } from './history-archive.service';

describe('History archival', () => {
    let replicaSet: MongoMemoryReplSet;
    let connection: mongoose.Connection;
    let events: mongoose.Model<Event>;
    let eventsArchive: mongoose.Model<Event>;
    let matches: mongoose.Model<MatchedEvent>;
    let matchesArchive: mongoose.Model<MatchedEvent>;
    let counts: mongoose.Model<RuleAgentCount>;
    const asOf = new Date('2026-11-11T00:00:00.000Z');
    const ruleId = new mongoose.Types.ObjectId();

    beforeAll(async () => {
        replicaSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
        connection = await mongoose.createConnection(replicaSet.getUri()).asPromise();
        events = connection.model(Event.name, EventSchema);
        eventsArchive = connection.model(ArchivedEvent.name, ArchivedEventSchema);
        matches = connection.model(MatchedEvent.name, MatchedEventSchema);
        matchesArchive = connection.model(ArchivedMatchedEvent.name, ArchivedMatchedEventSchema);
        counts = connection.model(RuleAgentCount.name, RuleAgentCountSchema);
        await Promise.all([
            events.init(), eventsArchive.init(), matches.init(), matchesArchive.init(), counts.init(),
        ]);
    }, 60_000);

    afterAll(async () => {
        await connection?.close();
        await replicaSet?.stop();
    });

    beforeEach(async () => {
        await Promise.all([
            events.deleteMany({}), eventsArchive.deleteMany({}), matches.deleteMany({}),
            matchesArchive.deleteMany({}), counts.deleteMany({}),
        ]);
    });

    it('archives expired details in repeatable batches while reports and all-time rankings remain available', async () => {
        const oldDate = new Date('2026-09-01T10:00:00.000Z');
        const recentDate = new Date('2026-11-01T10:00:00.000Z');
        await events.create([
            { _id: 'old-event', agentId: 'agent-1', timestamp: oldDate, payload: { name: 'temperature', value: 90 } },
            { _id: 'recent-event', agentId: 'agent-1', timestamp: recentDate, payload: { name: 'temperature', value: 50 } },
        ]);
        await matches.create([
            { ruleId, eventId: 'old-event', agentId: 'agent-1', eventName: 'temperature', eventValue: 90, matchedAt: oldDate },
            { ruleId, eventId: 'recent-event', agentId: 'agent-1', eventName: 'temperature', eventValue: 50, matchedAt: recentDate },
        ]);
        await counts.create({ ruleId, agentId: 'agent-1', totalMatches: 2 });

        const config = {
            get: (key: string) => key === 'HISTORY_RETENTION_DAYS' ? '30' : key === 'HISTORY_ARCHIVE_BATCH_SIZE' ? '1' : undefined,
        };
        const archive = new HistoryArchiveService(
            events as never,
            eventsArchive as never,
            matches as never,
            matchesArchive as never,
            config as unknown as ConfigService,
        );
        const result = await archive.archiveExpired(asOf);

        expect(result.eventsArchived).toBe(1);
        expect(result.matchesArchived).toBe(1);
        expect(await events.countDocuments()).toBe(1);
        expect(await eventsArchive.countDocuments()).toBe(1);
        expect(await matches.countDocuments()).toBe(1);
        expect(await matchesArchive.countDocuments()).toBe(1);

        const rankings = new RankingService(matches as never, counts as never);
        await expect(rankings.getRanking(ruleId)).resolves.toEqual([{ agentId: 'agent-1', totalMatches: 2 }]);

        const reports = new ReportsService(matches as never, rankings, { get: () => undefined } as unknown as ConfigService);
        await expect(reports.getAgentTimestamps(
            ruleId.toString(),
            oldDate.toISOString(),
            new Date(oldDate.getTime() + 60 * 60 * 1000).toISOString(),
        )).resolves.toMatchObject({
            items: [{ agentId: 'agent-1', count: 1, matchedAt: [oldDate] }],
        });

        await counts.deleteMany({});
        await rankings.rebuildFromMatchHistory();
        await expect(rankings.getRanking(ruleId)).resolves.toEqual([{ agentId: 'agent-1', totalMatches: 2 }]);

        const restartedArchive = new HistoryArchiveService(
            events as never,
            eventsArchive as never,
            matches as never,
            matchesArchive as never,
            config as unknown as ConfigService,
        );
        await expect(restartedArchive.archiveExpired(asOf)).resolves.toMatchObject({ eventsArchived: 0, matchesArchived: 0 });
        await expect(rankings.getRanking(ruleId)).resolves.toEqual([{ agentId: 'agent-1', totalMatches: 2 }]);
    });
});
