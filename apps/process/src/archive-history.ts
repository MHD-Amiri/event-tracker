import { Logger, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { MongooseModule } from '@nestjs/mongoose';
import { resolveMongoUri } from './mongo.config';
import { HistoryArchiveModule } from './archive/history-archive.module';
import { HistoryArchiveService } from './archive/history-archive.service';

@Module({
    imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        MongooseModule.forRootAsync({
            imports: [ConfigModule],
            inject: [ConfigService],
            useFactory: (config: ConfigService) => ({ uri: resolveMongoUri(config) }),
        }),
        HistoryArchiveModule,
    ],
})
class HistoryMaintenanceModule {}

async function archiveHistory(): Promise<void> {
    const app = await NestFactory.createApplicationContext(HistoryMaintenanceModule);
    try {
        const result = await app.get(HistoryArchiveService).archiveExpired();
        Logger.log(
            `Archived ${result.eventsArchived} events and ${result.matchesArchived} Matches before ${result.cutoff.toISOString()}.`,
            'HistoryMaintenance',
        );
    } finally {
        await app.close();
    }
}

void archiveHistory().catch((error: unknown) => {
    const detail = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    Logger.error(`History archival failed: ${detail}`, undefined, 'HistoryMaintenance');
    process.exitCode = 1;
});
