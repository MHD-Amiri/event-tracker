import { Controller, Logger } from '@nestjs/common';
import { EventPattern, Payload } from '@nestjs/microservices';
import { EventsService, IncomingEventDto } from './events.service';

@Controller()
export class EventsController {
    private readonly logger = new Logger(EventsController.name);

    constructor(private readonly eventsService: EventsService) { }

    @EventPattern('event_created')
    async handleEventCreated(@Payload() data: IncomingEventDto) {
        try {
            await this.eventsService.create(data);
            // We log periodically or keep it minimal so we don't spam the console at 5 req/s
        } catch (err) {
            this.logger.error(`Failed to store event: ${err.message}`, err.stack);
        }
    }
}
