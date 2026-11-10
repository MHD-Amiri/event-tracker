import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ClientsModule } from '@nestjs/microservices';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { publisherClientConfig, queueNames } from '@app/rmq';
import { Event, EventSchema } from './schemas/event.schema';
import { MatchedEvent, MatchedEventSchema } from '../rules/schemas/matched-event.schema';
import { RulesModule } from '../rules/rules.module';
import { PipelineService } from './pipeline.service';
import { PipelineController } from './pipeline.controller';

@Module({
    imports: [
        MongooseModule.forFeature([
            { name: Event.name, schema: EventSchema },
            { name: MatchedEvent.name, schema: MatchedEventSchema },
        ]),
        ClientsModule.registerAsync([
            {
                name: 'INTERNAL_RABBITMQ_SERVICE',
                imports: [ConfigModule],
                inject: [ConfigService],
                useFactory: (config: ConfigService) =>
                    publisherClientConfig(queueNames(config).evaluation, config),
            },
        ]),
        RulesModule,
    ],
    controllers: [PipelineController],
    providers: [PipelineService],
})
export class PipelineModule { }
