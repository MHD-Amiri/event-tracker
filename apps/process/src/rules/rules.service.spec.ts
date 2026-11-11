import { BadRequestException, NotFoundException } from '@nestjs/common';
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
        countDocuments: jest.Mock;
        findById: jest.Mock;
        findByIdAndUpdate: jest.Mock;
        findByIdAndDelete: jest.Mock;
    };
    let findLean: jest.Mock;
    let findSort: jest.Mock;
    let findSkip: jest.Mock;
    let findLimit: jest.Mock;
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
        findLimit = jest.fn().mockReturnValue({ lean: findLean });
        findSkip = jest.fn().mockReturnValue({ limit: findLimit });
        findSort = jest.fn().mockReturnValue({ skip: findSkip });
        findByIdLean = jest.fn().mockResolvedValue(createdRule);
        updateLean = jest.fn().mockResolvedValue(updatedRule);
        model = {
            create: jest.fn().mockResolvedValue(createdRule),
            find: jest.fn().mockReturnValue({ lean: findLean, sort: findSort }),
            countDocuments: jest.fn().mockResolvedValue(0),
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
        it('returns a bounded page with the total Rule count', async () => {
            const rules = [createdRule, updatedRule];
            findLean.mockResolvedValue(rules);
            model.countDocuments.mockResolvedValue(12);

            await expect(service.findAll('2', '5')).resolves.toEqual({
                items: rules, total: 12, page: 2, limit: 5, totalPages: 3,
            });

            expect(model.find).toHaveBeenCalledWith({});
            expect(findSort).toHaveBeenCalledWith({ _id: 1 });
            expect(findSkip).toHaveBeenCalledWith(5);
            expect(findLimit).toHaveBeenCalledWith(5);
            expect(model.countDocuments).toHaveBeenCalledWith({});
        });

        it('defaults pagination and rejects invalid or excessive page sizes', async () => {
            await expect(service.findAll()).resolves.toMatchObject({ page: 1, limit: 20 });
            await expect(service.findAll('0', '20')).rejects.toThrow(BadRequestException);
            await expect(service.findAll('1', '101')).rejects.toThrow(BadRequestException);
            await expect(service.findAll('1.5', '20')).rejects.toThrow(BadRequestException);
        });
    });

    describe('findOne()', () => {
        it('returns the requested Rule', async () => {
            await expect(service.findOne(ruleId)).resolves.toBe(createdRule);

            expect(model.findById).toHaveBeenCalledWith(ruleId);
        });

        it('rejects malformed IDs as a client error', async () => {
            await expect(service.findOne('not-an-object-id')).rejects.toThrow(BadRequestException);
            expect(model.findById).not.toHaveBeenCalled();
        });

        it('throws NotFoundException when the Rule does not exist', async () => {
            findByIdLean.mockResolvedValue(null);

            await expect(service.findOne(ruleId)).rejects.toThrow(NotFoundException);
        });
    });

    describe('update()', () => {
        it('updates a Rule, invalidates the active Rule cache, and returns the updated Rule', async () => {
            await expect(service.update(ruleId, updateDto)).resolves.toBe(updatedRule);

            expect(model.findByIdAndUpdate).toHaveBeenCalledWith(ruleId, updateDto, { new: true, runValidators: true });
            expect(redis.invalidateRulesCache).toHaveBeenCalledTimes(1);
        });

        it('throws NotFoundException and keeps the cache when the Rule does not exist', async () => {
            updateLean.mockResolvedValue(null);

            await expect(service.update(ruleId, updateDto)).rejects.toThrow(NotFoundException);

            expect(redis.invalidateRulesCache).not.toHaveBeenCalled();
        });

        it('rejects malformed IDs before updating Mongo', async () => {
            await expect(service.update('invalid-id', updateDto)).rejects.toThrow(BadRequestException);
            expect(model.findByIdAndUpdate).not.toHaveBeenCalled();
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

        it('rejects malformed IDs before deleting from Mongo', async () => {
            await expect(service.remove('invalid-id')).rejects.toThrow(BadRequestException);
            expect(model.findByIdAndDelete).not.toHaveBeenCalled();
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
