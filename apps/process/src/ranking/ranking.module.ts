import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
    MatchedEvent,
    MatchedEventSchema,
    ArchivedMatchedEvent,
    ArchivedMatchedEventSchema,
} from '../rules/schemas/matched-event.schema';
import { RuleAgentCount, RuleAgentCountSchema } from './rule-agent-count.schema';
import { RankingService } from './ranking.service';

@Module({
    imports: [
        MongooseModule.forFeature([
            { name: MatchedEvent.name, schema: MatchedEventSchema },
            { name: ArchivedMatchedEvent.name, schema: ArchivedMatchedEventSchema },
            { name: RuleAgentCount.name, schema: RuleAgentCountSchema },
        ]),
    ],
    providers: [RankingService],
    exports: [RankingService],
})
export class RankingModule {}
