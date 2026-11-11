import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Event, EventDocument, ArchivedEvent } from '../pipeline/schemas/event.schema';
import {
    MatchedEvent,
    MatchedEventDocument,
    ArchivedMatchedEvent,
} from '../rules/schemas/matched-event.schema';

const DEFAULT_RETENTION_DAYS = 90;
const DEFAULT_BATCH_SIZE = 200;
const MAX_BATCH_SIZE = 1000;

@Injectable()
export class HistoryArchiveService {
    private readonly retentionDays: number;
    private readonly batchSize: number;

    constructor(
        @InjectModel(Event.name) private readonly eventModel: Model<EventDocument>,
        @InjectModel(ArchivedEvent.name) private readonly archivedEventModel: Model<EventDocument>,
        @InjectModel(MatchedEvent.name)
        private readonly matchedEventModel: Model<MatchedEventDocument>,
        @InjectModel(ArchivedMatchedEvent.name)
        private readonly archivedMatchedEventModel: Model<MatchedEventDocument>,
        config: ConfigService,
    ) {
        this.retentionDays = this.readPositiveSetting(
            config,
            'HISTORY_RETENTION_DAYS',
            DEFAULT_RETENTION_DAYS,
            36_500,
        );
        this.batchSize = this.readPositiveSetting(
            config,
            'HISTORY_ARCHIVE_BATCH_SIZE',
            DEFAULT_BATCH_SIZE,
            MAX_BATCH_SIZE,
        );
    }

    async archiveExpired(
        asOf = new Date(),
    ): Promise<{ cutoff: Date; eventsArchived: number; matchesArchived: number }> {
        const cutoff = new Date(asOf.getTime() - this.retentionDays * 24 * 60 * 60 * 1000);
        const eventsArchived = await this.moveExpired(
            this.eventModel,
            this.archivedEventModel,
            'timestamp',
            cutoff,
        );
        const matchesArchived = await this.moveExpired(
            this.matchedEventModel,
            this.archivedMatchedEventModel,
            'matchedAt',
            cutoff,
        );
        return { cutoff, eventsArchived, matchesArchived };
    }

    private async moveExpired<T extends { _id: unknown }>(
        source: Model<T>,
        archive: Model<T>,
        timeField: 'timestamp' | 'matchedAt',
        cutoff: Date,
    ): Promise<number> {
        let moved = 0;
        while (true) {
            const expired = (await source
                .find({ [timeField]: { $lt: cutoff } })
                .sort({ [timeField]: 1, _id: 1 })
                .limit(this.batchSize)
                .lean()) as (T & { _id: unknown })[];
            if (expired.length === 0) return moved;

            const ids = expired.map((document) => document._id);
            const session = await source.db.startSession();
            let deletedInBatch = 0;
            try {
                await session.withTransaction(async () => {
                    await archive.bulkWrite(
                        expired.map((document) => ({
                            replaceOne: {
                                filter: { _id: document._id },
                                replacement: document as never,
                                upsert: true,
                            },
                        })) as never,
                        { session, ordered: true },
                    );
                    const result = await source.deleteMany({ _id: { $in: ids } }, { session });
                    deletedInBatch = result.deletedCount;
                });
                moved += deletedInBatch;
            } finally {
                await session.endSession();
            }
        }
    }

    private readPositiveSetting(
        config: ConfigService,
        key: string,
        fallback: number,
        maximum = Number.MAX_SAFE_INTEGER,
    ): number {
        const raw = config.get<string>(key);
        if (raw === undefined) return fallback;
        if (!/^\d+$/.test(raw)) throw new Error(`${key} must be a positive integer.`);
        const value = Number(raw);
        if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
            throw new Error(`${key} must be between 1 and ${maximum}.`);
        }
        return value;
    }
}
