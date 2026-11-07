import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

const RULES_CACHE_KEY = 'active_rules';

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
    private client: Redis;
    private readonly RULES_CACHE_KEY = RULES_CACHE_KEY;

    private readonly rulesTtl: number;
    private readonly rankingTtl: number;

    constructor(private configService: ConfigService) {
        this.rulesTtl = this.readTtl('REDIS_RULES_TTL_SEC', 3600);
        this.rankingTtl = this.readTtl('REDIS_RANKING_TTL_SEC', 3600);
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

    onModuleInit() {
        const host = this.configService.get<string>('REDIS_HOST', 'localhost');
        const port = this.configService.get<number>('REDIS_PORT', 6379);

        this.client = new Redis({
            host,
            port,
            retryStrategy: (times) => Math.min(times * 100, 3000),
        });

        this.client.on('connect', () => console.log('✅ Connected to Redis'));
        this.client.on('error', (err) => console.error('❌ Redis Error:', err.message));
    }

    onModuleDestroy() {
        this.client?.disconnect();
    }

    async getCachedRules(): Promise<any[] | null> {
        const data = await this.client.get(this.RULES_CACHE_KEY);
        return data ? JSON.parse(data) : null;
    }

    async setCachedRules(rules: any[]): Promise<void> {
        // Cached until TTL expiry or explicit invalidation on rule changes
        await this.client.set(this.RULES_CACHE_KEY, JSON.stringify(rules), 'EX', this.rulesTtl);
    }

    async invalidateRulesCache(): Promise<void> {
        await this.client.del(this.RULES_CACHE_KEY);
    }

    // --- Agent ranking cache ---
    // Cache-aside over the Mongo aggregation: Mongo is the source of truth,
    // entries expire after the configured TTL and the next request rebuilds them.

    async getRankingCache(ruleId: string): Promise<{ agentId: string; totalMatches: number }[] | null> {
        const data = await this.client.get(`ranking:${ruleId}`);
        return data ? JSON.parse(data) : null;
    }

    async setRankingCache(ruleId: string, ranking: { agentId: string; totalMatches: number }[]): Promise<void> {
        await this.client.set(`ranking:${ruleId}`, JSON.stringify(ranking), 'EX', this.rankingTtl);
    }
}
