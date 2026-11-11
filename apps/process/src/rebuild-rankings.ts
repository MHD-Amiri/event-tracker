import { Logger, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { MongooseModule } from '@nestjs/mongoose';
import { resolveMongoUri } from './mongo.config';
import { RankingModule } from './ranking/ranking.module';
import { RankingService } from './ranking/ranking.service';

@Module({
    imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        MongooseModule.forRootAsync({
            imports: [ConfigModule],
            inject: [ConfigService],
            useFactory: (config: ConfigService) => ({ uri: resolveMongoUri(config) }),
        }),
        RankingModule,
    ],
})
class RankingMaintenanceModule { }

async function rebuildRankings(): Promise<void> {
    const app = await NestFactory.createApplicationContext(RankingMaintenanceModule);
    try {
        await app.get(RankingService).rebuildFromMatchHistory();
        Logger.log('Ranking projection rebuilt from Match history.', 'RankingMaintenance');
    } finally {
        await app.close();
    }
}

void rebuildRankings().catch((error: unknown) => {
    const detail = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    Logger.error(`Ranking rebuild failed: ${detail}`, undefined, 'RankingMaintenance');
    process.exitCode = 1;
});
