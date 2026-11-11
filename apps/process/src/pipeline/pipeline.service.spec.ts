import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { connect, disconnect, Types, Model } from 'mongoose';
import { PipelineService, checkCondition } from './pipeline.service';
import { Event, EventDocument, EventSchema, SensorEventMessage } from './schemas/event.schema';
import { Rule, RuleSchema, RuleOperator } from '../rules/schemas/rule.schema';
import { ArchivedMatchedEvent, ArchivedMatchedEventSchema, MatchedEvent, MatchedEventDocument, MatchedEventSchema } from '../rules/schemas/matched-event.schema';
import { RulesService } from '../rules/rules.service';
import { RuleAgentCount, RuleAgentCountSchema } from '../ranking/rule-agent-count.schema';
import { RankingService } from '../ranking/ranking.service';

/**
 * Tests through PipelineService's interface — ingest()/evaluate() — with the
 * Mongoose models real (in-memory Mongo) and only the RMQ client faked.
 * The bugs this suite guards against (silent field drops, dedup-on-redelivery,
 * snapshot shape, cache stringification) all hide in the calling sequence,
 * which is exactly what the interface exercises.
 */

describe('PipelineService', () => {
    let mongod: MongoMemoryReplSet;
    let pipeline: PipelineService;
    let eventModel: Model<Event>;
    let ruleModel: Model<Rule>;
    let matchedEventModel: Model<MatchedEvent>;
    let countModel: Model<RuleAgentCount>;
    let rankingService: RankingService;
    let rmqEmit: jest.Mock;

    const emitRef = {
        subscribe: (handlers: { next?: () => void; error?: (error: Error) => void; complete?: () => void }) => {
            handlers.complete?.();
            return { unsubscribe: () => undefined };
        },
    };

    beforeAll(async () => {
        mongod = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
        const connection = await connect(mongod.getUri('event_tracker_test'));
        eventModel = connection.model(Event.name, EventSchema);
        ruleModel = connection.model(Rule.name, RuleSchema);
        matchedEventModel = connection.model(MatchedEvent.name, MatchedEventSchema);
        const archivedMatchedEventModel = connection.model(ArchivedMatchedEvent.name, ArchivedMatchedEventSchema);
        countModel = connection.model(RuleAgentCount.name, RuleAgentCountSchema);
        await matchedEventModel.init();
        await archivedMatchedEventModel.init();
        await countModel.init();
        rankingService = new RankingService(matchedEventModel as any, countModel as any);

        const moduleRef = await Test.createTestingModule({
            providers: [
                PipelineService,
                { provide: RankingService, useValue: rankingService },
                {
                    provide: getModelToken(Event.name),
                    useValue: eventModel,
                },
                {
                    provide: getModelToken(MatchedEvent.name),
                    useValue: matchedEventModel,
                },
                {
                    provide: getModelToken(Rule.name),
                    // injected into RulesService below via the real service is
                    // not needed — PipelineService reads rules through
                    // RulesService.getActiveRules, which we stub
                    useValue: ruleModel,
                },
                {
                    provide: RulesService,
                    useValue: {
                        getActiveRules: jest.fn(),
                    },
                },
                {
                    provide: 'INTERNAL_RABBITMQ_SERVICE',
                    useValue: { emit: jest.fn().mockReturnValue(emitRef) },
                },
            ],
        }).compile();

        pipeline = moduleRef.get(PipelineService);
        rmqEmit = moduleRef.get('INTERNAL_RABBITMQ_SERVICE').emit;

        // silence console noise from the logger
        rmqEmit.mockClear();
    });

    afterAll(async () => {
        await disconnect();
        if (mongod) await mongod.stop();
    });

    const event: SensorEventMessage = {
        eventId: 'event-1',
        agentId: 'agent-1',
        timestamp: '2026-11-09T00:00:00.000Z',
        payload: { name: 'temperature', value: 42.5 },
    };

    beforeEach(async () => {
        await eventModel.deleteMany({});
        await matchedEventModel.deleteMany({});
        await countModel.deleteMany({});
        await ruleModel.deleteMany({});
        rmqEmit.mockClear();
    });

    describe('ingest()', () => {
        it('persists the event with agentId, timestamp, and payload', async () => {
            await pipeline.ingest(event);

            const doc = await eventModel.findOne({ agentId: 'agent-1' }).lean();
            expect(doc).not.toBeNull();
            // Regression: agentId was silently dropped by the old schema
            // (no @Prop declared), leaving the agentId index indexing nothing
            expect(doc!.agentId).toBe('agent-1');
            expect(doc!.payload.name).toBe('temperature');
            expect(doc!.payload.value).toBe(42.5);
            expect(new Date(doc!.timestamp).toISOString()).toBe(event.timestamp);
        });

        it('uses the stable event ID as the event document ID', async () => {
            await pipeline.ingest(event);

            const doc = await eventModel.findOne({}).lean();
            expect(doc!._id).toBe('event-1');
        });

        it('is idempotent on redelivery: a duplicate save is a no-op, not a duplicate row', async () => {
            await pipeline.ingest(event);
            await pipeline.ingest(event); // what a nack + RabbitMQ redelivery produces

            const count = await eventModel.countDocuments();
            expect(count).toBe(1);
        });

        it('emits evaluate_event with the original message', async () => {
            await pipeline.ingest(event);

            expect(rmqEmit).toHaveBeenCalledWith('evaluate_event', event);
        });

        it('still emits when the save hit a duplicate key (redelivery after a failed emit)', async () => {
            await pipeline.ingest(event);
            rmqEmit.mockClear();

            // second delivery: save is a duplicate-key no-op, emit must still run
            await pipeline.ingest(event);

            expect(rmqEmit).toHaveBeenCalledTimes(1);
        });

        it('rejects when the emit fails so the consumer can schedule a retry', async () => {
            const failingRef = {
                subscribe: (handlers: any) => {
                    handlers.error(new Error('broker down'));
                    return { unsubscribe: () => undefined };
                },
            };
            rmqEmit.mockReturnValueOnce(failingRef);

            await expect(pipeline.ingest(event)).rejects.toThrow('broker down');
            // the event stayed persisted — the retry's duplicate-key no-op
            // makes the second attempt safe
            expect(await eventModel.countDocuments()).toBe(1);
        });
    });

    describe('evaluate()', () => {
        const activeRulesProvider = (rules: any[]) => ({
            provide: RulesService,
            useValue: {
                getActiveRules: async () => rules,
            },
        });

        // Helper: rebuild the pipeline against a fresh RulesService stub.
        // getActiveRules returns what a JSON round-trip through Redis
        // produces — plain objects with string _id — which is the shape
        // that broke ObjectId refs before.
        const rulesFromCache = (rule: any) => JSON.parse(JSON.stringify(rule));

        it('persists a match when the event name and condition line up', async () => {
            const rule = await ruleModel.create({
                name: 'High temperature',
                eventName: 'temperature',
                operator: RuleOperator.GREATER_THAN,
                value: 40,
                isActive: true,
            });
            // what getActiveRules hands back after the Redis round-trip
            const cached = rulesFromCache(rule);

            const moduleRef = await Test.createTestingModule({
                providers: [
                    PipelineService,
                    { provide: RankingService, useValue: rankingService },
                    {
                        provide: getModelToken(Event.name),
                        useValue: eventModel,
                    },
                    {
                        provide: getModelToken(MatchedEvent.name),
                        useValue: matchedEventModel,
                    },
                    {
                        provide: RulesService,
                        useValue: { getActiveRules: async () => [cached] },
                    },
                    {
                        provide: 'INTERNAL_RABBITMQ_SERVICE',
                        useValue: { emit: jest.fn().mockReturnValue(emitRef) },
                    },
                ],
            }).compile();
            const fresh = moduleRef.get(PipelineService);

            await fresh.evaluate(event);

            const matches = await matchedEventModel.find({}).lean();
            expect(matches).toHaveLength(1);
        });

        it('records only one match when the same event is evaluated more than once', async () => {
            const rule = await ruleModel.create({
                name: 'High temperature',
                eventName: 'temperature',
                operator: RuleOperator.GREATER_THAN,
                value: 40,
                isActive: true,
            });
            const fresh = new PipelineService(
                eventModel as unknown as Model<EventDocument>,
                { emit: jest.fn().mockReturnValue(emitRef) } as any,
                { getActiveRules: async () => [rulesFromCache(rule)] } as any,
                rankingService,
            );

            await fresh.evaluate(event);
            await fresh.evaluate(event);

            expect(await matchedEventModel.countDocuments({ ruleId: rule._id, eventId: event.eventId })).toBe(1);
            const [count] = await countModel.find({ ruleId: rule._id }).lean();
            expect(count.totalMatches).toBe(1);
        });

        it('ranks from durable counts and rebuilds those counts from Match history', async () => {
            const rule = await ruleModel.create({
                name: 'High temperature',
                eventName: 'temperature',
                operator: RuleOperator.GREATER_THAN,
                value: 40,
                isActive: true,
            });
            const rules = { getActiveRules: async () => [rulesFromCache(rule)] };
            const fresh = new PipelineService(
                eventModel as unknown as Model<EventDocument>,
                { emit: jest.fn() } as any,
                rules as any,
                rankingService,
            );

            await fresh.evaluate(event);
            await fresh.evaluate({
                ...event,
                eventId: 'event-2',
                agentId: 'agent-2',
                payload: { name: 'temperature', value: 90 },
            });
            await fresh.evaluate({
                ...event,
                eventId: 'event-3',
                agentId: 'agent-1',
                payload: { name: 'temperature', value: 45 },
            });

            await expect(rankingService.getRanking(rule._id)).resolves.toEqual([
                { agentId: 'agent-1', totalMatches: 2 },
                { agentId: 'agent-2', totalMatches: 1 },
            ]);

            await countModel.deleteMany({});
            await rankingService.rebuildFromMatchHistory();

            await expect(rankingService.getRanking(rule._id)).resolves.toEqual([
                { agentId: 'agent-1', totalMatches: 2 },
                { agentId: 'agent-2', totalMatches: 1 },
            ]);
        });

        it('rejects invalid broker event data before doing work', async () => {
            const invalidEvent = { ...event, payload: { ...event.payload, value: Number.NaN } };

            await expect(pipeline.evaluate(invalidEvent)).rejects.toThrow('Invalid sensor event');
        });

        it('casts the cache-stringified rule _id back to a valid ObjectId ref', async () => {
            const rule = await ruleModel.create({
                name: 'High temperature',
                eventName: 'temperature',
                operator: RuleOperator.GREATER_THAN,
                value: 40,
                isActive: true,
            });
            const cached = rulesFromCache(rule);

            const moduleRef = await Test.createTestingModule({
                providers: [
                    PipelineService,
                    { provide: RankingService, useValue: rankingService },
                    { provide: getModelToken(Event.name), useValue: eventModel },
                    { provide: getModelToken(MatchedEvent.name), useValue: matchedEventModel },
                    { provide: RulesService, useValue: { getActiveRules: async () => [cached] } },
                    { provide: 'INTERNAL_RABBITMQ_SERVICE', useValue: { emit: jest.fn().mockReturnValue(emitRef) } },
                ],
            }).compile();
            const fresh = moduleRef.get(PipelineService);

            await fresh.evaluate(event);

            const [match] = await matchedEventModel.find({}).lean();
            expect((match.ruleId as Types.ObjectId).toString()).toBe(rule._id.toString());
            // the ref must actually resolve to the rule document
            const populated = await matchedEventModel.find({}).populate('ruleId').lean();
            expect(populated[0].ruleId).not.toBeNull();
        });

        it('snapshots the rule at match time', async () => {
            const rule = await ruleModel.create({
                name: 'High temperature',
                eventName: 'temperature',
                operator: RuleOperator.GREATER_THAN,
                value: 40,
                isActive: true,
            });
            const cached = rulesFromCache(rule);

            const moduleRef = await Test.createTestingModule({
                providers: [
                    PipelineService,
                    { provide: RankingService, useValue: rankingService },
                    { provide: getModelToken(Event.name), useValue: eventModel },
                    { provide: getModelToken(MatchedEvent.name), useValue: matchedEventModel },
                    { provide: RulesService, useValue: { getActiveRules: async () => [cached] } },
                    { provide: 'INTERNAL_RABBITMQ_SERVICE', useValue: { emit: jest.fn().mockReturnValue(emitRef) } },
                ],
            }).compile();
            const fresh = moduleRef.get(PipelineService);

            await fresh.evaluate(event);

            const [match] = await matchedEventModel.find({}).lean();
            expect(match.ruleSnapshot).toMatchObject({
                name: 'High temperature',
                eventName: 'temperature',
                operator: RuleOperator.GREATER_THAN,
                value: 40,
            });
            expect(match.eventValue).toBe(42.5);
            expect(match.agentId).toBe('agent-1');
        });

        it('skips rules for a different eventName and rules whose condition fails', async () => {
            const rules = [
                { _id: new Types.ObjectId().toHexString(), name: 'Other metric', eventName: 'pressure', operator: '>', value: 40, isActive: true },
                { _id: new Types.ObjectId().toHexString(), name: 'Low threshold', eventName: 'temperature', operator: '>', value: 100, isActive: true },
            ];

            const moduleRef = await Test.createTestingModule({
                providers: [
                    PipelineService,
                    { provide: RankingService, useValue: rankingService },
                    { provide: getModelToken(Event.name), useValue: eventModel },
                    { provide: getModelToken(MatchedEvent.name), useValue: matchedEventModel },
                    { provide: RulesService, useValue: { getActiveRules: async () => rules } },
                    { provide: 'INTERNAL_RABBITMQ_SERVICE', useValue: { emit: jest.fn().mockReturnValue(emitRef) } },
                ],
            }).compile();
            const fresh = moduleRef.get(PipelineService);

            await fresh.evaluate(event);

            expect(await matchedEventModel.countDocuments()).toBe(0);
        });

        it('inserts nothing when there are no active rules', async () => {
            const moduleRef = await Test.createTestingModule({
                providers: [
                    PipelineService,
                    { provide: RankingService, useValue: rankingService },
                    { provide: getModelToken(Event.name), useValue: eventModel },
                    { provide: getModelToken(MatchedEvent.name), useValue: matchedEventModel },
                    { provide: RulesService, useValue: { getActiveRules: async () => [] } },
                    { provide: 'INTERNAL_RABBITMQ_SERVICE', useValue: { emit: jest.fn().mockReturnValue(emitRef) } },
                ],
            }).compile();
            const fresh = moduleRef.get(PipelineService);

            await fresh.evaluate(event);

            expect(await matchedEventModel.countDocuments()).toBe(0);
        });
    });

    describe('checkCondition() — operator semantics', () => {
        const cases: [RuleOperator, number, number, boolean][] = [
            [RuleOperator.EQUALS, 42, 42, true],
            [RuleOperator.EQUALS, 42, 43, false],
            [RuleOperator.NOT_EQUALS, 42, 43, true],
            [RuleOperator.NOT_EQUALS, 42, 42, false],
            [RuleOperator.GREATER_THAN, 42, 41.9, true],
            [RuleOperator.GREATER_THAN, 42, 42, false],
            [RuleOperator.GREATER_THAN_OR_EQUAL, 42, 42, true],
            [RuleOperator.GREATER_THAN_OR_EQUAL, 42, 42.1, false],
            [RuleOperator.LESS_THAN, 42, 42.1, true],
            [RuleOperator.LESS_THAN, 42, 42, false],
            [RuleOperator.LESS_THAN_OR_EQUAL, 42, 42, true],
            [RuleOperator.LESS_THAN_OR_EQUAL, 42, 41.9, false],
        ];

        it.each(cases)('%s: checkCondition(%j, %j) → %j', (op, val, target, expected) => {
            expect(checkCondition(val, op, target)).toBe(expected);
        });

        it('defaults to false for an unknown operator', () => {
            expect(checkCondition(42, 'unknown' as RuleOperator, 42)).toBe(false);
        });
    });
});
