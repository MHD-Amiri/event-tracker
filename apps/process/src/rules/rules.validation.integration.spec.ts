import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { RedisService } from '../redis/redis.service';
import { CreateRuleDto } from './dto/create-rule.dto';
import { UpdateRuleDto } from './dto/update-rule.dto';
import { Rule, RuleSchema, RuleOperator } from './schemas/rule.schema';
import { RulesService } from './rules.service';

describe('Rules validation', () => {
    let replicaSet: MongoMemoryReplSet;
    let connection: mongoose.Connection;
    let service: RulesService;
    let model: mongoose.Model<Rule>;

    beforeAll(async () => {
        replicaSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
        connection = await mongoose.createConnection(replicaSet.getUri()).asPromise();
        model = connection.model(Rule.name, RuleSchema);
        await model.init();
        service = new RulesService(model as never, { invalidateRulesCache: jest.fn() } as unknown as RedisService);
    }, 60_000);

    afterAll(async () => {
        await connection?.close();
        await replicaSet?.stop();
    });

    beforeEach(async () => {
        await model.deleteMany({});
    });

    it('rejects invalid DTO fields including empty optional update strings', async () => {
        const invalidCreate = plainToInstance(CreateRuleDto, {
            name: '', eventName: 'temperature', operator: '>', value: 10,
        });
        const invalidUpdate = plainToInstance(UpdateRuleDto, { name: '' });

        expect(await validate(invalidCreate)).not.toHaveLength(0);
        expect(await validate(invalidUpdate)).not.toHaveLength(0);
        expect(await validate(plainToInstance(UpdateRuleDto, { value: 12 }))).toHaveLength(0);
    });

    it('rejects an invalid update and keeps the persisted Rule unchanged', async () => {
        const rule = await model.create({
            name: 'Temperature threshold',
            eventName: 'temperature',
            operator: RuleOperator.GREATER_THAN,
            value: 80,
        });

        await expect(service.update(String(rule._id), { operator: 'invalid' as RuleOperator }))
            .rejects.toThrow();

        const unchanged = await service.findOne(String(rule._id));
        expect(unchanged.operator).toBe(RuleOperator.GREATER_THAN);
    });
});
