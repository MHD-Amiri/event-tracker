import { Controller, Logger } from '@nestjs/common';
import { EventPattern, Payload, Ctx, RmqContext } from '@nestjs/microservices';
import { EventsService, IncomingEventDto } from './events.service';

@Controller()
export class EventsController {
    private readonly logger = new Logger(EventsController.name);

    constructor(private readonly eventsService: EventsService) { }

    @EventPattern('event_created')
    async handleEventCreated(@Payload() data: any, @Ctx() context: RmqContext) {
        const channel = context.getChannelRef();
        const originalMsg = context.getMessage();
        try {
            await this.eventsService.create(data);
            channel.ack(originalMsg);
        } catch (err) {
            this.logger.error('Failed to process event, requeueing for retry', err as Error);
            // Requeue (true) so a transient failure (e.g. broker hiccup on the
            // evaluation emit) redelivers instead of dropping the event
            channel.nack(originalMsg, false, true);
        }
    }
}
