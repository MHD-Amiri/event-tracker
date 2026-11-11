import { ConfigService } from '@nestjs/config';
import { RedisService } from './redis.service';

const mockRedisClient = {
    get: jest.fn(),
    set: jest.fn(),
    del: jest.fn(),
    disconnect: jest.fn(),
    on: jest.fn(),
};

jest.mock('ioredis', () => ({
    __esModule: true,
    default: jest.fn().mockImplementation(() => mockRedisClient),
}));

describe('RedisService', () => {
    const ruleId = '507f1f77bcf86cd799439011';
    const rules = [{ _id: 'rule-1', eventName: 'temperature', operator: '>', value: 80 }];
    const ranking = [
        { agentId: 'agent-1', totalMatches: 12 },
        { agentId: 'agent-2', totalMatches: 5 },
    ];

    let service: RedisService;

    const createService = (values: Record<string, string | number | undefined> = {}) => {
        const config = {
            get: jest.fn((key: string, defaultValue?: unknown) => values[key] ?? defaultValue),
        } as unknown as ConfigService;
        const instance = new RedisService(config);
        instance.onModuleInit();
        return instance;
    };

    beforeEach(() => {
        jest.clearAllMocks();
        mockRedisClient.get.mockResolvedValue(null);
        mockRedisClient.set.mockResolvedValue('OK');
        mockRedisClient.del.mockResolvedValue(1);
        mockRedisClient.disconnect.mockReturnValue(undefined);
        mockRedisClient.on.mockReturnValue(mockRedisClient);
        jest.spyOn(console, 'warn').mockImplementation(() => undefined);
        jest.spyOn(console, 'log').mockImplementation(() => undefined);
        jest.spyOn(console, 'error').mockImplementation(() => undefined);
        service = createService();
    });

    afterEach(() => {
        service?.onModuleDestroy();
        jest.restoreAllMocks();
    });

    it('serializes and restores active Rules using the rules key and configured TTL', async () => {
        await service.setCachedRules(rules);
        expect(mockRedisClient.set).toHaveBeenCalledWith('active_rules', JSON.stringify(rules), 'EX', 3600);

        mockRedisClient.get.mockResolvedValueOnce(JSON.stringify(rules));
        await expect(service.getCachedRules()).resolves.toEqual(rules);
        expect(mockRedisClient.get).toHaveBeenCalledWith('active_rules');
    });

    it('invalidates the active Rule cache key', async () => {
        await service.invalidateRulesCache();

        expect(mockRedisClient.del).toHaveBeenCalledWith('active_rules');
    });

    it('serializes and restores a ranking under its per-Rule key', async () => {
        const customService = createService({ REDIS_RANKING_TTL_SEC: '90' });

        await customService.setRankingCache(ruleId, ranking);
        expect(mockRedisClient.set).toHaveBeenCalledWith(
            `ranking:${ruleId}`,
            JSON.stringify(ranking),
            'EX',
            90,
        );

        mockRedisClient.get.mockResolvedValueOnce(JSON.stringify(ranking));
        await expect(customService.getRankingCache(ruleId)).resolves.toEqual(ranking);
        expect(mockRedisClient.get).toHaveBeenCalledWith(`ranking:${ruleId}`);
        customService.onModuleDestroy();
    });

    it('uses each configured TTL for its own cache', async () => {
        const customService = createService({
            REDIS_RULES_TTL_SEC: '120',
            REDIS_RANKING_TTL_SEC: '45',
        });

        await customService.setCachedRules(rules);
        await customService.setRankingCache(ruleId, ranking);

        expect(mockRedisClient.set).toHaveBeenNthCalledWith(
            1,
            'active_rules',
            JSON.stringify(rules),
            'EX',
            120,
        );
        expect(mockRedisClient.set).toHaveBeenNthCalledWith(
            2,
            `ranking:${ruleId}`,
            JSON.stringify(ranking),
            'EX',
            45,
        );
        customService.onModuleDestroy();
    });

    it.each([undefined, 'invalid', '0', '-5'])(
        'falls back to one hour for missing or invalid TTL value %s',
        async (configuredTtl) => {
            const customService = createService({
                REDIS_RULES_TTL_SEC: configuredTtl,
                REDIS_RANKING_TTL_SEC: configuredTtl,
            });

            await customService.setCachedRules(rules);
            await customService.setRankingCache(ruleId, ranking);

            expect(mockRedisClient.set).toHaveBeenNthCalledWith(
                1,
                'active_rules',
                JSON.stringify(rules),
                'EX',
                3600,
            );
            expect(mockRedisClient.set).toHaveBeenNthCalledWith(
                2,
                `ranking:${ruleId}`,
                JSON.stringify(ranking),
                'EX',
                3600,
            );
            customService.onModuleDestroy();
        },
    );

    it('disconnects the Redis client when the module is destroyed', () => {
        service.onModuleDestroy();

        expect(mockRedisClient.disconnect).toHaveBeenCalledTimes(1);
    });

    it('surfaces invalid cached JSON and Redis command failures', async () => {
        mockRedisClient.get.mockResolvedValueOnce('{not-json');
        await expect(service.getCachedRules()).rejects.toThrow(SyntaxError);

        const redisError = new Error('Redis unavailable');
        mockRedisClient.get.mockRejectedValueOnce(redisError);
        await expect(service.getRankingCache(ruleId)).rejects.toBe(redisError);
    });
});
