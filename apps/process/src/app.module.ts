import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { PipelineModule } from './pipeline/pipeline.module';
import { RedisModule } from './redis/redis.module';
import { RulesModule } from './rules/rules.module';
import { ReportsModule } from './reports/reports.module';

@Module({
    imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        MongooseModule.forRoot(
            process.env.MONGO_URI || 'mongodb://localhost:27017/event_tracker',
        ),
        PipelineModule,
        RedisModule,
        RulesModule,
        ReportsModule
    ],
})
export class AppModule { }
