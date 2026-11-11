import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';
import { MatchedEvent, MatchedEventSchema } from '../rules/schemas/matched-event.schema';
import { RankingModule } from '../ranking/ranking.module';

@Module({
    imports: [
        MongooseModule.forFeature([
            { name: MatchedEvent.name, schema: MatchedEventSchema },
        ]),
        RankingModule,
    ],
    controllers: [ReportsController],
    providers: [ReportsService],
})
export class ReportsModule { }
