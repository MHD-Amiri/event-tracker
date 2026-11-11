import mongoose, { type Connection } from 'mongoose';

export interface MongoTestConnection {
    connection: Connection;
    close(): Promise<void>;
}

/**
 * Integration tests require an explicitly supplied replica set. A separate
 * database name keeps Jest workers isolated when they share that replica set.
 */
export async function openMongoTestConnection(databaseName: string): Promise<MongoTestConnection> {
    const testUri = process.env.MONGO_TEST_URI;
    if (!testUri) {
        throw new Error(
            'MONGO_TEST_URI is required for integration tests. Start a MongoDB replica set and set MONGO_TEST_URI.',
        );
    }
    const connection = await mongoose
        .createConnection(testUri, { dbName: databaseName })
        .asPromise();

    return {
        connection,
        async close() {
            await connection.dropDatabase();
            await connection.close();
        },
    };
}
