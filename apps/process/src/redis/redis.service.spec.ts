import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import { RedisService } from './redis.service';

const mockRedisClient = {
    get: jest.fn(),
    set: jest.fn(),
    del: jest.fn(),
    eval: jest.fn(),
    disconnect: jest.fn(),
    connect: jest.fn(),
    on: jest.fn(),
};

jest.mock('ioredis', () => ({
    __esModule: true,
    default: jest.fn().mockImplementation(() => mockRedisClient),
}));

describe('RedisService', () => {
    const rules = [{ _id: 'rule-1', eventName: 'temperature', operator: '>', value: 80 }];

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
        mockRedisClient.eval.mockResolvedValue('OK');
        mockRedisClient.disconnect.mockReturnValue(undefined);
        mockRedisClient.connect.mockResolvedValue(undefined);
        mockRedisClient.on.mockReturnValue(mockRedisClient);
        jest.spyOn(console, 'warn').mockImplementation(() => undefined);
        jest.spyOn(console, 'log').mockImplementation(() => undefined);
        jest.spyOn(console, 'error').mockImplementation(() => undefined);
        jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
        jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
        service = createService();
    });

    afterEach(() => {
        service?.onModuleDestroy();
        jest.restoreAllMocks();
    });

    it('serializes and restores active Rules using the rules key and configured TTL', async () => {
        await expect(service.getRulesCacheVersion()).resolves.toBe('0');
        expect(mockRedisClient.get).toHaveBeenCalledWith('active_rules:version');
        await service.setCachedRules(rules, '0');
        expect(mockRedisClient.eval).toHaveBeenCalledWith(
            expect.stringContaining("redis.call('SET'"),
            2,
            'active_rules:version',
            'active_rules',
            '0',
            JSON.stringify(rules),
            '3600',
        );

        mockRedisClient.get.mockResolvedValueOnce(JSON.stringify(rules));
        await expect(service.getCachedRules()).resolves.toEqual(rules);
        expect(mockRedisClient.get).toHaveBeenCalledWith('active_rules');
    });

    it('atomically advances the cache version and invalidates the active Rule key', async () => {
        await service.invalidateRulesCache();

        expect(mockRedisClient.eval).toHaveBeenCalledWith(
            expect.stringContaining("redis.call('INCR'"),
            2,
            'active_rules:version',
            'active_rules',
        );
    });

    it.each([undefined, 'invalid', '0', '-5'])(
        'falls back to one hour for missing or invalid TTL value %s',
        async (configuredTtl) => {
            const customService = createService({ REDIS_RULES_TTL_SEC: configuredTtl });

            await customService.setCachedRules(rules, '0');

            expect(mockRedisClient.eval).toHaveBeenCalledWith(
                expect.any(String),
                2,
                'active_rules:version',
                'active_rules',
                '0',
                JSON.stringify(rules),
                '3600',
            );
            customService.onModuleDestroy();
        },
    );

    it('disconnects the Redis client when the module is destroyed', () => {
        service.onModuleDestroy();

        expect(mockRedisClient.disconnect).toHaveBeenCalledTimes(1);
    });

    it('warns when Redis host settings are missing and includes the target in connection errors', () => {
        const warning = jest.spyOn(Logger.prototype, 'warn');
        const errorLog = jest.spyOn(Logger.prototype, 'error');
        const fallbackService = createService();
        const redisErrorHandler = [...mockRedisClient.on.mock.calls]
            .reverse()
            .find(([event]) => event === 'error')?.[1] as ((error: Error) => void) | undefined;

        expect(warning).toHaveBeenCalledWith(expect.stringContaining('REDIS_HOST'));
        expect(redisErrorHandler).toBeDefined();
        redisErrorHandler?.(new Error('ECONNREFUSED'));

        expect(errorLog).toHaveBeenCalledWith(
            expect.stringContaining('Redis connection to localhost:6379 failed: ECONNREFUSED'),
        );
        fallbackService.onModuleDestroy();
    });

    it('fails module startup with the target when Redis cannot become ready', async () => {
        mockRedisClient.connect.mockRejectedValueOnce(new Error('ECONNREFUSED'));
        const config = {
            get: jest.fn((_key: string, defaultValue?: unknown) => defaultValue),
        } as unknown as ConfigService;
        const unavailableService = new RedisService(config);

        await expect(unavailableService.onModuleInit()).rejects.toThrow(
            'Redis startup check failed for localhost:6379: ECONNREFUSED',
        );
        expect(mockRedisClient.disconnect).toHaveBeenCalled();
    });

    it('surfaces invalid cached JSON and Redis command failures', async () => {
        mockRedisClient.get.mockResolvedValueOnce('{not-json');
        await expect(service.getCachedRules()).rejects.toThrow(SyntaxError);
    });
});
