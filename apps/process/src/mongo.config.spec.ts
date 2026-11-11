import { ConfigService } from '@nestjs/config';
import { DEFAULT_MONGO_URI, resolveMongoUri } from './mongo.config';

describe('MongoDB configuration', () => {
    const config = (values: Record<string, string> = {}) => ({
        get: (key: string) => values[key],
    }) as unknown as ConfigService;

    it('uses the configured Mongo URI without logging a fallback warning', () => {
        const warning = jest.fn();

        expect(resolveMongoUri(config({ MONGO_URI: 'mongodb://db.example/events' }), warning))
            .toBe('mongodb://db.example/events');
        expect(warning).not.toHaveBeenCalled();
    });

    it('warns clearly when it falls back to the local Mongo URI', () => {
        const warning = jest.fn();

        expect(resolveMongoUri(config(), warning)).toBe(DEFAULT_MONGO_URI);
        expect(warning).toHaveBeenCalledWith(expect.stringContaining('MONGO_URI is not set'));
        expect(warning).toHaveBeenCalledWith(expect.stringContaining('localhost:27017'));
    });
});
