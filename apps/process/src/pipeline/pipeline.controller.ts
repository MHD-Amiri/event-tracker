import { Controller, Logger } from '@nestjs/common';
import { EventPattern, Payload, Ctx, RmqContext } from '@nestjs/microservices';
import { ConfigService } from '@nestjs/config';
import { queueNames } from '@app/rmq';
import { PipelineService } from './pipeline.service';
import { SensorEventMessage } from './schemas/event.schema';
import { InvalidSensorEventError, validateSensorEventMessage } from './sensor-event.validation';
import { RmqRetryService } from './rmq-retry.service';

/**
 * The two RMQ consumers of the pipeline. Ack/nack policy lives here, next to
 * the code it protects — the retry semantics each half of the pipeline
 * depends on are not visible anywhere else.
 *
 * event_created → ingest(): persist and forward; failures use bounded retry
 *                           queues and then a dead-letter queue.
 *
 * evaluate_event → evaluate(): persist matches idempotently; failures use the
 *                              same bounded retry/DLQ policy.
 */
@Controller()
export class PipelineController {
    private readonly logger = new Logger(PipelineController.name);

    constructor(
        private readonly pipelineService: PipelineService,
        private readonly retryService: RmqRetryService,
        private readonly config: ConfigService,
    ) {}

    @EventPattern('event_created')
    async handleEventCreated(@Payload() data: SensorEventMessage, @Ctx() context: RmqContext) {
        const channel = context.getChannelRef();
        const originalMsg = context.getMessage();
        try {
            validateSensorEventMessage(data);
            await this.pipelineService.ingest(data);
            channel.ack(originalMsg);
        } catch (err) {
            await this.routeFailure(context, queueNames(this.config).ingestion, err);
        }
    }

    @EventPattern('evaluate_event')
    async handleEvaluation(@Payload() data: SensorEventMessage, @Ctx() context: RmqContext) {
        const channel = context.getChannelRef();
        const originalMsg = context.getMessage();
        try {
            validateSensorEventMessage(data);
            await this.pipelineService.evaluate(data);
            channel.ack(originalMsg);
        } catch (err) {
            await this.routeFailure(context, queueNames(this.config).evaluation, err);
        }
    }

    private async routeFailure(context: RmqContext, queue: string, error: unknown): Promise<void> {
        const permanent = error instanceof InvalidSensorEventError;
        const safeError = error instanceof Error ? error : new Error(String(error));
        this.logger.error(
            permanent
                ? 'Invalid sensor event; sending to dead-letter queue'
                : 'Sensor event processing failed; scheduling retry',
            safeError.stack,
        );

        try {
            await this.retryService.handleFailure(context, queue, error, permanent);
        } catch (forwardError) {
            const channel = context.getChannelRef();
            const message = context.getMessage();
            this.logger.error(
                'Could not forward failed delivery; leaving it for broker recovery',
                forwardError instanceof Error ? forwardError.stack : String(forwardError),
            );
            channel.nack(message, false, true);
        }
    }
}
