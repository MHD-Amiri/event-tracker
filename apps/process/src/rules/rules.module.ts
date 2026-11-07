import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Rule, RuleSchema } from './schemas/rule.schema';
import { MatchedEvent, MatchedEventSchema } from './schemas/matched-event.schema';
import { RulesService } from './rules.service';
import { RulesController } from './rules.controller';

@Module({
    imports: [
        MongooseModule.forFeature([
            { name: Rule.name, schema: RuleSchema },
            { name: MatchedEvent.name, schema: MatchedEventSchema },
        ]),
    ],
    controllers: [RulesController],
    providers: [RulesService],
    exports: [RulesService, MongooseModule],
})
export class RulesModule { }
