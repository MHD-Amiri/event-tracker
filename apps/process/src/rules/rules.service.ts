import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Rule, RuleDocument } from './schemas/rule.schema';
import { CreateRuleDto } from './dto/create-rule.dto';
import { UpdateRuleDto } from './dto/update-rule.dto';
import { RedisService } from '../redis/redis.service';

const DEFAULT_RULE_PAGE_SIZE = 20;
const MAX_RULE_PAGE_SIZE = 100;

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

    async findAll(pageRaw = '1', limitRaw = String(DEFAULT_RULE_PAGE_SIZE)) {
        const page = this.parsePositiveInteger(pageRaw, 'page');
        const limit = this.parsePositiveInteger(limitRaw, 'limit');
        if (limit > MAX_RULE_PAGE_SIZE) {
            throw new BadRequestException(`limit must not exceed ${MAX_RULE_PAGE_SIZE}.`);
        }
        const skip = (page - 1) * limit;
        if (!Number.isSafeInteger(skip)) {
            throw new BadRequestException('Requested page is too large.');
        }

        const filter = {};
        const [items, total] = await Promise.all([
            this.ruleModel.find(filter).sort({ _id: 1 }).skip(skip).limit(limit).lean(),
            this.ruleModel.countDocuments(filter),
        ]);

        return { items, total, page, limit, totalPages: Math.ceil(total / limit) };
    }

    async findOne(id: string): Promise<Rule> {
        this.assertValidId(id);
        const rule = await this.ruleModel.findById(id).lean();
        if (!rule) throw new NotFoundException(`Rule #${id} not found`);
        return rule;
    }

    async update(id: string, dto: UpdateRuleDto): Promise<Rule> {
        this.assertValidId(id);
        const updated = await this.ruleModel.findByIdAndUpdate(id, dto, { new: true, runValidators: true }).lean();
        if (!updated) throw new NotFoundException(`Rule #${id} not found`);
        await this.redisService.invalidateRulesCache();
        return updated;
    }

    async remove(id: string): Promise<{ success: boolean }> {
        this.assertValidId(id);
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

    private parsePositiveInteger(raw: string, name: string): number {
        if (!/^\d+$/.test(raw)) {
            throw new BadRequestException(`${name} must be a positive integer.`);
        }
        const value = Number(raw);
        if (!Number.isSafeInteger(value) || value < 1) {
            throw new BadRequestException(`${name} must be a positive integer.`);
        }
        return value;
    }

    private assertValidId(id: string): void {
        if (!Types.ObjectId.isValid(id)) {
            throw new BadRequestException('Invalid rule id format.');
        }
    }
}
