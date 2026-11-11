import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

const RULES_CACHE_KEY = 'active_rules';
const RULES_CACHE_VERSION_KEY = 'active_rules:version';
const SET_RULES_IF_VERSION_MATCHES = `
    if redis.call('GET', KEYS[1]) == ARGV[1] or
       (not redis.call('GET', KEYS[1]) and ARGV[1] == '0') then
        return redis.call('SET', KEYS[2], ARGV[2], 'EX', ARGV[3])
    end
    return 0
`;
const INVALIDATE_RULES_CACHE = `
    redis.call('INCR', KEYS[1])
    return redis.call('DEL', KEYS[2])
`;

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
    private readonly logger = new Logger(RedisService.name);
    private client: Redis;
    private readonly RULES_CACHE_KEY = RULES_CACHE_KEY;

    private readonly rulesTtl: number;

    constructor(private configService: ConfigService) {
        this.rulesTtl = this.readTtl('REDIS_RULES_TTL_SEC', 3600);
    }

    // Parse a TTL in seconds, guarding against a malformed value silently
    // becoming NaN (Redis would then set the key without expiry)
    private readTtl(key: string, fallback: number): number {
        const raw = this.configService.get<string>(key);
        const parsed = raw ? Number(raw) : fallback;
        if (!Number.isFinite(parsed) || parsed <= 0) {
            console.warn(`⚠️ Invalid ${key} "${raw}", falling back to ${fallback}s`);
            return fallback;
        }
        return parsed;
    }

    async onModuleInit(): Promise<void> {
        const configuredHost = this.configService.get<string>('REDIS_HOST');
        const configuredPort = this.configService.get<string | number>('REDIS_PORT');
        const missingSettings = [
            !configuredHost && 'REDIS_HOST',
            !configuredPort && 'REDIS_PORT',
        ].filter(Boolean);
        if (missingSettings.length) {
            this.logger.warn(
                `${missingSettings.join(' and ')} not set; using localhost:6379 defaults where missing.`,
            );
        }

        const host = configuredHost || 'localhost';
        const parsedPort = Number(configuredPort ?? 6379);
        const port = Number.isInteger(parsedPort) && parsedPort > 0 && parsedPort <= 65535
            ? parsedPort
            : 6379;
        if (configuredPort && port !== parsedPort) {
            this.logger.warn(`Invalid REDIS_PORT "${configuredPort}"; using default port 6379.`);
        }

        this.client = new Redis({
            host,
            port,
            lazyConnect: true,
            retryStrategy: (times) => Math.min(times * 100, 3000),
        });

        this.client.on('connect', () => this.logger.log(`Connected to Redis at ${host}:${port}.`));
        this.client.on('error', (err) => {
            this.logger.error(`Redis connection to ${host}:${port} failed: ${err.message}`);
        });
        try {
            await this.client.connect();
        } catch (error) {
            this.client.disconnect();
            const detail = error instanceof Error ? error.message : String(error);
            throw new Error(`Redis startup check failed for ${host}:${port}: ${detail}`);
        }
    }

    onModuleDestroy() {
        this.client?.disconnect();
    }

    async getCachedRules(): Promise<any[] | null> {
        const data = await this.client.get(this.RULES_CACHE_KEY);
        return data ? JSON.parse(data) : null;
    }

    async getRulesCacheVersion(): Promise<string> {
        return (await this.client.get(RULES_CACHE_VERSION_KEY)) ?? '0';
    }

    async setCachedRules(rules: any[], expectedVersion: string): Promise<boolean> {
        const result = await this.client.eval(
            SET_RULES_IF_VERSION_MATCHES,
            2,
            RULES_CACHE_VERSION_KEY,
            this.RULES_CACHE_KEY,
            expectedVersion,
            JSON.stringify(rules),
            String(this.rulesTtl),
        );
        return result === 'OK';
    }

    async invalidateRulesCache(): Promise<void> {
        await this.client.eval(INVALIDATE_RULES_CACHE, 2, RULES_CACHE_VERSION_KEY, this.RULES_CACHE_KEY);
    }

}
