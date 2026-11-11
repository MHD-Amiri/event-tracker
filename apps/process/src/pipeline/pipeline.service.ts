import { Injectable, Inject, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientProxy } from '@nestjs/microservices';
import { Model, Types } from 'mongoose';
import { Event, EventDocument, SensorEventMessage } from './schemas/event.schema';
import { Rule } from '../rules/schemas/rule.schema';
import { RuleOperator } from '../rules/schemas/rule.schema';
import { MatchedEvent } from '../rules/schemas/matched-event.schema';
import { RulesService } from '../rules/rules.service';
import { validateSensorEventMessage } from './sensor-event.validation';
import { RankingService } from '../ranking/ranking.service';

/**
 * The sensor-event pipeline, in one place.
 *
 * Two entries, one module — matching the two queue consumers so
 * PROCESS_ROLE can still scale ingest and evaluate independently:
 *
 *   ingest(event)   events_queue consumer: persist (idempotently, so a
 *                   redelivery is a no-op) then hand off to the evaluation
 *                   queue. A failure in either step rejects, and the
 *                   consumer routes it through bounded retry/DLQ handling.
 *
 *   evaluate(event) events_evaluation_queue consumer: match the event
 *                   against active rules and persist the matches.
 *
 * Event storage, validation, forwarding, rule selection, and match details
 * stay behind these entry points; durable Match/count writes are delegated to
 * RankingService so their transaction and repair behavior has one owner.
 */
@Injectable()
export class PipelineService {
    private readonly logger = new Logger(PipelineService.name);

    constructor(
        @InjectModel(Event.name) private readonly eventModel: Model<EventDocument>,
        @Inject('INTERNAL_RABBITMQ_SERVICE') private readonly rmqClient: ClientProxy,
        private readonly rulesService: RulesService,
        private readonly rankingService: RankingService,
    ) {}

    async ingest(dto: SensorEventMessage): Promise<void> {
        validateSensorEventMessage(dto);

        // Agent-generated event IDs survive redelivery and do not collapse
        // two distinct events that happen to have identical readings.
        const createdEvent = new this.eventModel({
            _id: dto.eventId,
            agentId: dto.agentId,
            timestamp: new Date(dto.timestamp),
            payload: dto.payload,
        });

        try {
            await createdEvent.save();
        } catch (err) {
            // 11000 = duplicate key — this message was already persisted on a
            // previous delivery; safe to continue to the emit
            if ((err as any)?.code !== 11000) throw err;
        }

        // Awaiting the emit: resolves once the message is written to the
        // broker, rejects on failure so the consumer schedules a bounded
        // retry of the original message.
        await new Promise<void>((resolve, reject) => {
            this.rmqClient.emit('evaluate_event', dto).subscribe({
                next: () => resolve(),
                error: reject,
                complete: () => resolve(),
            });
        });
    }

    async evaluate(event: SensorEventMessage): Promise<void> {
        validateSensorEventMessage(event);
        const rules = await this.rulesService.getActiveRules();
        if (!rules || rules.length === 0) return;

        const matchesToInsert: Partial<MatchedEvent>[] = [];

        for (const rule of rules as (Rule & { _id: Types.ObjectId | string })[]) {
            if (rule.eventName === event.payload.name) {
                if (checkCondition(event.payload.value, rule.operator, rule.value)) {
                    matchesToInsert.push({
                        eventId: event.eventId,
                        // _id is a plain string when rules come from the Redis cache
                        // (JSON.stringify), so cast back to ObjectId to keep the ref intact
                        ruleId: new Types.ObjectId(rule._id as string),
                        ruleSnapshot: {
                            name: rule.name,
                            eventName: rule.eventName,
                            operator: rule.operator,
                            value: rule.value,
                        },
                        agentId: event.agentId,
                        eventName: event.payload.name,
                        eventValue: event.payload.value,
                        matchedAt: event.timestamp ? new Date(event.timestamp) : new Date(),
                    });
                }
            }
        }

        if (matchesToInsert.length > 0) {
            await this.rankingService.recordMatches(
                matchesToInsert as {
                    ruleId: Types.ObjectId;
                    eventId: string;
                    agentId: string;
                }[],
            );
            this.logger.log(
                `Stored ${matchesToInsert.length} rule match(es) for agent ${event.agentId}`,
            );
        }
    }
}

// Pure: the operator semantics of a rule. Exported for direct testing;
// the interesting bugs (cache shape, ObjectId casting, snapshot fields)
// live in evaluate(), which is tested through PipelineService's interface.
export function checkCondition(val: number, op: RuleOperator, target: number): boolean {
    switch (op) {
        case RuleOperator.EQUALS:
            return val === target;
        case RuleOperator.NOT_EQUALS:
            return val !== target;
        case RuleOperator.GREATER_THAN:
            return val > target;
        case RuleOperator.GREATER_THAN_OR_EQUAL:
            return val >= target;
        case RuleOperator.LESS_THAN:
            return val < target;
        case RuleOperator.LESS_THAN_OR_EQUAL:
            return val <= target;
        default:
            return false;
    }
}
