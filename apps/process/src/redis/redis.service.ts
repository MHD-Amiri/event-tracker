import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
    private client: Redis;
    private readonly RULES_CACHE_KEY = 'active_rules';

    constructor(private configService: ConfigService) { }

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
        // Cache for 1 hour or until invalidated
        await this.client.set(this.RULES_CACHE_KEY, JSON.stringify(rules), 'EX', 3600);
    }

    async invalidateRulesCache(): Promise<void> {
        await this.client.del(this.RULES_CACHE_KEY);
    }

    // --- Agent ranking cache ---
    // Cache-aside over the Mongo aggregation: Mongo is the source of truth,
    // entries expire after 1 hour and the next request rebuilds them.

    async getRankingCache(ruleId: string): Promise<{ agentId: string; totalMatches: number }[] | null> {
        const data = await this.client.get(`ranking:${ruleId}`);
        return data ? JSON.parse(data) : null;
    }

    async setRankingCache(ruleId: string, ranking: { agentId: string; totalMatches: number }[]): Promise<void> {
        await this.client.set(`ranking:${ruleId}`, JSON.stringify(ranking), 'EX', 3600);
    }
}
