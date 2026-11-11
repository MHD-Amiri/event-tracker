import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { MatchedEvent, MatchedEventSchema } from '../rules/schemas/matched-event.schema';

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
        await model.init();
        const ruleId = new mongoose.Types.ObjectId();
        await model.create({
            ruleId,
            eventId: 'event-001',
            agentId: 'agent-1',
            eventName: 'temperature',
            eventValue: 42,
            matchedAt: new Date('2026-11-09T01:00:00Z'),
        });

        const plan = await model.find({
            ruleId,
            matchedAt: { $gte: new Date('2026-11-09T00:00:00Z'), $lte: new Date('2026-11-09T23:59:59Z') },
        })
            .select({ agentId: 1, matchedAt: 1, eventId: 1 })
            .sort({ matchedAt: 1, eventId: 1 })
            .limit(101)
            .explain('executionStats');

        const explain = plan as unknown as { queryPlanner: { winningPlan: unknown } };
        expect(JSON.stringify(explain.queryPlanner.winningPlan)).toContain('ruleId_1_matchedAt_1_eventId_1');
    });
});
