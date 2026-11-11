import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';
import {
    MatchedEvent,
    MatchedEventSchema,
    ArchivedMatchedEvent,
    ArchivedMatchedEventSchema,
} from '../rules/schemas/matched-event.schema';
import { RankingModule } from '../ranking/ranking.module';

@Module({
    imports: [
        MongooseModule.forFeature([
            { name: MatchedEvent.name, schema: MatchedEventSchema },
            { name: ArchivedMatchedEvent.name, schema: ArchivedMatchedEventSchema },
        ]),
        RankingModule,
    ],
    controllers: [ReportsController],
    providers: [ReportsService],
})
export class ReportsModule {}
