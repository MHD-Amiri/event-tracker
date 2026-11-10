import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Rule, RuleDocument } from './schemas/rule.schema';
import { CreateRuleDto } from './dto/create-rule.dto';
import { UpdateRuleDto } from './dto/update-rule.dto';
import { RedisService } from '../redis/redis.service';

@Injectable()
export class RulesService {
    constructor(
        @InjectModel(Rule.name) private ruleModel: Model<RuleDocument>,
        private readonly redisService: RedisService,
    ) { }

    // --- CRUD Operations ---

    async create(dto: CreateRuleDto): Promise<Rule> {
        const created = await this.ruleModel.create(dto);
        await this.redisService.invalidateRulesCache();
        return created;
    }

    async findAll(): Promise<Rule[]> {
        return this.ruleModel.find().lean();
    }

    async findOne(id: string): Promise<Rule> {
        const rule = await this.ruleModel.findById(id).lean();
        if (!rule) throw new NotFoundException(`Rule #${id} not found`);
        return rule;
    }

    async update(id: string, dto: UpdateRuleDto): Promise<Rule> {
        const updated = await this.ruleModel.findByIdAndUpdate(id, dto, { new: true }).lean();
        if (!updated) throw new NotFoundException(`Rule #${id} not found`);
        await this.redisService.invalidateRulesCache();
        return updated;
    }

    async remove(id: string): Promise<{ success: boolean }> {
        const res = await this.ruleModel.findByIdAndDelete(id);
        if (!res) throw new NotFoundException(`Rule #${id} not found`);
        await this.redisService.invalidateRulesCache();
        return { success: true };
    }

    // --- Active-rule source ---
    // The evaluation pipeline (pipeline.service.ts) reads rules through
    // this interface; administration writes above invalidate what it reads.

    async getActiveRules(): Promise<Rule[]> {
        const cached = await this.redisService.getCachedRules();
        if (cached) return cached;

        const activeRules = await this.ruleModel.find({ isActive: true }).lean();
        await this.redisService.setCachedRules(activeRules);
        return activeRules;
    }
}
