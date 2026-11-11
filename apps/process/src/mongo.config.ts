export const DEFAULT_MONGO_URI = 'mongodb://localhost:27017/event_tracker?replicaSet=rs0';

interface MongoConfigReader {
    get<T = string>(key: string, defaultValue?: T): T;
}

export function resolveMongoUri(
    config: MongoConfigReader,
    warn: (message: string) => void = console.warn,
): string {
    const uri = config.get<string>('MONGO_URI');
    if (uri) return uri;

    warn(
        '⚠️ MONGO_URI is not set; using the local MongoDB default at localhost:27017/event_tracker. ' +
        'Set MONGO_URI to use another database.',
    );
    return DEFAULT_MONGO_URI;
}
