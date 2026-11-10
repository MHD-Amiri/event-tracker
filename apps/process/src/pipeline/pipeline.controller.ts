import { Controller, Logger } from '@nestjs/common';
import { EventPattern, Payload, Ctx, RmqContext } from '@nestjs/microservices';
import { PipelineService } from './pipeline.service';
import { SensorEventMessage } from './schemas/event.schema';

/**
 * The two RMQ consumers of the pipeline. Ack/nack policy lives here, next to
 * the code it protects — the retry semantics each half of the pipeline
 * depends on are not visible anywhere else.
 *
 * event_created → ingest():  requeue on failure (transient broker/Mongo
 *                           errors redeliver; ingest() is idempotent, so a
 *                           redelivery is a no-op, not a duplicate)
 *
 * evaluate_event → evaluate(): drop on failure (no requeue — a poison
 *                           message would otherwise loop forever; the source
 *                           event is already safely persisted by ingest())
 */
@Controller()
export class PipelineController {
    private readonly logger = new Logger(PipelineController.name);

    constructor(private readonly pipelineService: PipelineService) { }

    @EventPattern('event_created')
    async handleEventCreated(@Payload() data: SensorEventMessage, @Ctx() context: RmqContext) {
        const channel = context.getChannelRef();
        const originalMsg = context.getMessage();
        try {
            await this.pipelineService.ingest(data);
            channel.ack(originalMsg);
        } catch (err) {
            this.logger.error('Failed to process event, requeueing for retry', err as Error);
            // Requeue (true) so a transient failure (e.g. broker hiccup on the
            // evaluation emit) redelivers instead of dropping the event
            channel.nack(originalMsg, false, true);
        }
    }

    @EventPattern('evaluate_event')
    async handleEvaluation(@Payload() data: SensorEventMessage, @Ctx() context: RmqContext) {
        const channel = context.getChannelRef();
        const originalMsg = context.getMessage();
        try {
            await this.pipelineService.evaluate(data);
            channel.ack(originalMsg);
        } catch (err) {
            this.logger.error('Error evaluating rule, dropping message', err as Error);
            // Negative acknowledgement without re-queueing to avoid poison message loops
            channel.nack(originalMsg, false, false);
        }
    }
}
