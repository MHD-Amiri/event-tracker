import { Logger, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { PipelineModule } from './pipeline/pipeline.module';
import { RedisModule } from './redis/redis.module';
import { RulesModule } from './rules/rules.module';
import { ReportsModule } from './reports/reports.module';
import { resolveMongoUri } from './mongo.config';

const mongoLogger = new Logger('MongoDB');

@Module({
    imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        MongooseModule.forRootAsync({
            imports: [ConfigModule],
            inject: [ConfigService],
            useFactory: (config: ConfigService) => ({
                uri: resolveMongoUri(config),
                connectionFactory: (connection) => {
                    connection.on('connected', () => mongoLogger.log('Connected to MongoDB.'));
                    connection.on('error', (error: Error) => {
                        mongoLogger.error(`MongoDB connection failed: ${error.message}`);
                    });
                    return connection;
                },
            }),
        }),
        PipelineModule,
        RedisModule,
        RulesModule,
        ReportsModule,
    ],
})
export class AppModule { }
