import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Rule, RuleDocument, RuleOperator } from './schemas/rule.schema';
import { MatchedEvent, MatchedEventDocument } from './schemas/matched-event.schema';
import { CreateRuleDto } from './dto/create-rule.dto';
import { UpdateRuleDto } from './dto/update-rule.dto';
import { RedisService } from '../redis/redis.service';

@Injectable()
export class RulesService {
    constructor(
        @InjectModel(Rule.name) private ruleModel: Model<RuleDocument>,
        @InjectModel(MatchedEvent.name) private matchedEventModel: Model<MatchedEventDocument>,
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

    // --- Engine / Evaluation ---

    async getActiveRules(): Promise<Rule[]> {
        const cached = await this.redisService.getCachedRules();
        if (cached) return cached;

        const activeRules = await this.ruleModel.find({ isActive: true }).lean();
        await this.redisService.setCachedRules(activeRules);
        return activeRules;
    }

    async evaluateEvent(event: { agentId: string; payload: { name: string; value: number }; timestamp?: Date }) {
        const rules = await this.getActiveRules();
        if (!rules || rules.length === 0) return;

        const matchesToInsert: Partial<MatchedEvent>[] = [];

        for (const rule of rules as (Rule & { _id: Types.ObjectId | string })[]) {
            if (rule.eventName === event.payload.name) {
                if (this.checkCondition(event.payload.value, rule.operator, rule.value)) {
                    matchesToInsert.push({
                        // _id is a plain string when rules come from the Redis cache
                        // (JSON.stringify), so cast back to ObjectId to keep the ref intact
                        ruleId: new Types.ObjectId(rule._id as string),
                        ruleName: rule.name,
                        agentId: event.agentId,
                        eventName: event.payload.name,
                        eventValue: event.payload.value,
                        matchedAt: event.timestamp ? new Date(event.timestamp) : new Date(),
                    });
                }
            }
        }

        if (matchesToInsert.length > 0) {
            await this.matchedEventModel.insertMany(matchesToInsert);
            console.log(`🎯 Stored ${matchesToInsert.length} rule match(es) for agent ${event.agentId}`);
        }
    }

    private checkCondition(val: number, op: RuleOperator, target: number): boolean {
        switch (op) {
            case RuleOperator.EQUALS: return val === target;
            case RuleOperator.NOT_EQUALS: return val !== target;
            case RuleOperator.GREATER_THAN: return val > target;
            case RuleOperator.GREATER_THAN_OR_EQUAL: return val >= target;
            case RuleOperator.LESS_THAN: return val < target;
            case RuleOperator.LESS_THAN_OR_EQUAL: return val <= target;
            default: return false;
        }
    }
}
