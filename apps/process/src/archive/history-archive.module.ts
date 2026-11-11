import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Event, EventSchema, ArchivedEvent, ArchivedEventSchema } from '../pipeline/schemas/event.schema';
import { MatchedEvent, MatchedEventSchema, ArchivedMatchedEvent, ArchivedMatchedEventSchema } from '../rules/schemas/matched-event.schema';
import { HistoryArchiveService } from './history-archive.service';

@Module({
    imports: [MongooseModule.forFeature([
        { name: Event.name, schema: EventSchema },
        { name: ArchivedEvent.name, schema: ArchivedEventSchema },
        { name: MatchedEvent.name, schema: MatchedEventSchema },
        { name: ArchivedMatchedEvent.name, schema: ArchivedMatchedEventSchema },
    ])],
    providers: [HistoryArchiveService],
    exports: [HistoryArchiveService],
})
export class HistoryArchiveModule { }
