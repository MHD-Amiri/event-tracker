import { NotFoundException } from '@nestjs/common';
import { Model } from 'mongoose';
import { RedisService } from '../redis/redis.service';
import { CreateRuleDto } from './dto/create-rule.dto';
import { UpdateRuleDto } from './dto/update-rule.dto';
import { Rule, RuleDocument, RuleOperator } from './schemas/rule.schema';
import { RulesService } from './rules.service';

describe('RulesService', () => {
    const ruleId = '507f1f77bcf86cd799439011';
    const createDto: CreateRuleDto = {
        name: 'High temperature',
        eventName: 'temperature',
        operator: RuleOperator.GREATER_THAN,
        value: 80,
    };
    const updateDto: UpdateRuleDto = { value: 90 };
    const createdRule = { _id: ruleId, ...createDto, isActive: true };
    const updatedRule = { ...createdRule, value: 90 };

    let model: {
        create: jest.Mock;
        find: jest.Mock;
        findById: jest.Mock;
        findByIdAndUpdate: jest.Mock;
        findByIdAndDelete: jest.Mock;
    };
    let findLean: jest.Mock;
    let findByIdLean: jest.Mock;
    let updateLean: jest.Mock;
    let redis: {
        invalidateRulesCache: jest.Mock;
        getCachedRules: jest.Mock;
        setCachedRules: jest.Mock;
    };
    let service: RulesService;

    beforeEach(() => {
        findLean = jest.fn().mockResolvedValue([]);
        findByIdLean = jest.fn().mockResolvedValue(createdRule);
        updateLean = jest.fn().mockResolvedValue(updatedRule);
        model = {
            create: jest.fn().mockResolvedValue(createdRule),
            find: jest.fn().mockReturnValue({ lean: findLean }),
            findById: jest.fn().mockReturnValue({ lean: findByIdLean }),
            findByIdAndUpdate: jest.fn().mockReturnValue({ lean: updateLean }),
            findByIdAndDelete: jest.fn().mockResolvedValue(createdRule),
        };
        redis = {
            invalidateRulesCache: jest.fn().mockResolvedValue(undefined),
            getCachedRules: jest.fn().mockResolvedValue(null),
            setCachedRules: jest.fn().mockResolvedValue(undefined),
        };
        service = new RulesService(
            model as unknown as Model<RuleDocument>,
            redis as unknown as RedisService,
        );
    });

    describe('create()', () => {
        it('creates a Rule, invalidates the active Rule cache, and returns the created Rule', async () => {
            await expect(service.create(createDto)).resolves.toBe(createdRule);

            expect(model.create).toHaveBeenCalledWith(createDto);
            expect(redis.invalidateRulesCache).toHaveBeenCalledTimes(1);
        });

        it('does not invalidate the cache when creating a Rule fails', async () => {
            model.create.mockRejectedValue(new Error('database unavailable'));

            await expect(service.create(createDto)).rejects.toThrow('database unavailable');

            expect(redis.invalidateRulesCache).not.toHaveBeenCalled();
        });

        it('surfaces a cache invalidation failure after the Rule is created', async () => {
            redis.invalidateRulesCache.mockRejectedValue(new Error('Redis unavailable'));

            await expect(service.create(createDto)).rejects.toThrow('Redis unavailable');

            expect(model.create).toHaveBeenCalledWith(createDto);
            expect(redis.invalidateRulesCache).toHaveBeenCalledTimes(1);
        });
    });

    describe('findAll()', () => {
        it('returns all Rules', async () => {
            const rules = [createdRule, updatedRule];
            findLean.mockResolvedValue(rules);

            await expect(service.findAll()).resolves.toBe(rules);

            expect(model.find).toHaveBeenCalledWith();
        });
    });

    describe('findOne()', () => {
        it('returns the requested Rule', async () => {
            await expect(service.findOne(ruleId)).resolves.toBe(createdRule);

            expect(model.findById).toHaveBeenCalledWith(ruleId);
        });

        it('throws NotFoundException when the Rule does not exist', async () => {
            findByIdLean.mockResolvedValue(null);

            await expect(service.findOne(ruleId)).rejects.toThrow(NotFoundException);
        });
    });

    describe('update()', () => {
        it('updates a Rule, invalidates the active Rule cache, and returns the updated Rule', async () => {
            await expect(service.update(ruleId, updateDto)).resolves.toBe(updatedRule);

            expect(model.findByIdAndUpdate).toHaveBeenCalledWith(ruleId, updateDto, { new: true });
            expect(redis.invalidateRulesCache).toHaveBeenCalledTimes(1);
        });

        it('throws NotFoundException and keeps the cache when the Rule does not exist', async () => {
            updateLean.mockResolvedValue(null);

            await expect(service.update(ruleId, updateDto)).rejects.toThrow(NotFoundException);

            expect(redis.invalidateRulesCache).not.toHaveBeenCalled();
        });
    });

    describe('remove()', () => {
        it('deletes a Rule, invalidates the active Rule cache, and reports success', async () => {
            await expect(service.remove(ruleId)).resolves.toEqual({ success: true });

            expect(model.findByIdAndDelete).toHaveBeenCalledWith(ruleId);
            expect(redis.invalidateRulesCache).toHaveBeenCalledTimes(1);
        });

        it('throws NotFoundException and keeps the cache when the Rule does not exist', async () => {
            model.findByIdAndDelete.mockResolvedValue(null);

            await expect(service.remove(ruleId)).rejects.toThrow(NotFoundException);

            expect(redis.invalidateRulesCache).not.toHaveBeenCalled();
        });
    });

    describe('getActiveRules()', () => {
        it('returns cached Rules without querying Mongo', async () => {
            const cachedRules = [createdRule];
            redis.getCachedRules.mockResolvedValue(cachedRules);

            await expect(service.getActiveRules()).resolves.toBe(cachedRules);

            expect(model.find).not.toHaveBeenCalled();
            expect(redis.setCachedRules).not.toHaveBeenCalled();
        });

        it('queries active Rules and caches them on a cache miss', async () => {
            const activeRules = [createdRule];
            findLean.mockResolvedValue(activeRules);

            await expect(service.getActiveRules()).resolves.toBe(activeRules);

            expect(model.find).toHaveBeenCalledWith({ isActive: true });
            expect(redis.setCachedRules).toHaveBeenCalledWith(activeRules);
        });

        it('caches and returns an empty result when no Rules are active', async () => {
            findLean.mockResolvedValue([]);

            await expect(service.getActiveRules()).resolves.toEqual([]);

            expect(model.find).toHaveBeenCalledWith({ isActive: true });
            expect(redis.setCachedRules).toHaveBeenCalledWith([]);
        });

        it('returns a cached empty result without querying Mongo', async () => {
            redis.getCachedRules.mockResolvedValue([]);

            await expect(service.getActiveRules()).resolves.toEqual([]);

            expect(model.find).not.toHaveBeenCalled();
            expect(redis.setCachedRules).not.toHaveBeenCalled();
        });
    });
});
