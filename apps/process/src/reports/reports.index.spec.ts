import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import {
    ArchivedMatchedEvent,
    ArchivedMatchedEventSchema,
    MatchedEvent,
    MatchedEventSchema,
} from '../rules/schemas/matched-event.schema';

describe('API A matched-event index', () => {
    let replicaSet: MongoMemoryReplSet;
    let connection: mongoose.Connection;

    beforeAll(async () => {
        replicaSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
        connection = await mongoose.createConnection(replicaSet.getUri()).asPromise();
    }, 60_000);

    afterAll(async () => {
        await connection?.close();
        await replicaSet?.stop();
    });

    it('uses the compound rule/time/event index for the bounded keyset page', async () => {
        const model = connection.model(MatchedEvent.name, MatchedEventSchema);
        const archivedModel = connection.model(ArchivedMatchedEvent.name, ArchivedMatchedEventSchema);
        await model.init();
        await archivedModel.init();
        const ruleId = new mongoose.Types.ObjectId();
        await model.create({
            ruleId,
            eventId: 'event-001',
            agentId: 'agent-1',
            eventName: 'temperature',
            eventValue: 42,
            matchedAt: new Date('2026-11-09T01:00:00Z'),
        });

        const match = {
            ruleId,
            matchedAt: { $gte: new Date('2026-11-09T00:00:00Z'), $lte: new Date('2026-11-09T23:59:59Z') },
        };
        const page = [
            { $match: match },
            { $sort: { matchedAt: 1 as const, eventId: 1 as const } },
            { $limit: 101 },
        ];
        const plan = await model.aggregate([
            ...page,
            { $unionWith: { coll: 'matched_events_archive', pipeline: page } },
            { $sort: { matchedAt: 1, eventId: 1 } },
            { $limit: 101 },
            { $project: { _id: 0, eventId: 1, agentId: 1, matchedAt: 1 } },
        ]).explain('executionStats');

        expect(JSON.stringify(plan)).toContain('ruleId_1_matchedAt_1_eventId_1');
    });
});
