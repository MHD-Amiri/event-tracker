import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { Transport } from '@nestjs/microservices';
import { bootstrap } from './main';

jest.mock('@nestjs/core', () => ({
    NestFactory: { create: jest.fn() },
}));

describe('process bootstrap deployment roles', () => {
    const envKeys = [
        'PROCESS_ROLE',
        'PORT',
        'RABBITMQ_URL',
        'RMQ_INGESTION_QUEUE',
        'RMQ_EVALUATION_QUEUE',
    ];
    let originalEnv: Record<string, string | undefined>;
    let app: {
        useGlobalPipes: jest.Mock;
        connectMicroservice: jest.Mock;
        startAllMicroservices: jest.Mock;
        listen: jest.Mock;
    };

    const create = NestFactory.create as jest.Mock;

    beforeEach(() => {
        jest.clearAllMocks();
        originalEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
        process.env.PROCESS_ROLE = 'both';
        process.env.PORT = '4317';
        process.env.RABBITMQ_URL = 'amqp://test-broker';
        process.env.RMQ_INGESTION_QUEUE = 'test-ingestion';
        process.env.RMQ_EVALUATION_QUEUE = 'test-evaluation';
        jest.spyOn(console, 'log').mockImplementation(() => undefined);

        app = {
            useGlobalPipes: jest.fn(),
            connectMicroservice: jest.fn(),
            startAllMicroservices: jest.fn().mockResolvedValue(undefined),
            listen: jest.fn().mockResolvedValue(undefined),
        };
        create.mockResolvedValue(app);
    });

    afterEach(() => {
        for (const key of envKeys) {
            const value = originalEnv[key];
            if (value === undefined) delete process.env[key];
            else process.env[key] = value;
        }
        jest.restoreAllMocks();
    });

    it('starts both queues and the HTTP server for the both role', async () => {
        await bootstrap('both');

        expect(app.connectMicroservice).toHaveBeenCalledTimes(2);
        expect(app.connectMicroservice).toHaveBeenNthCalledWith(1, {
            transport: Transport.RMQ,
            options: expect.objectContaining({ queue: 'test-ingestion' }),
        });
        expect(app.connectMicroservice).toHaveBeenNthCalledWith(2, {
            transport: Transport.RMQ,
            options: expect.objectContaining({ queue: 'test-evaluation' }),
        });
        expect(app.startAllMicroservices).toHaveBeenCalledTimes(1);
        expect(app.listen).toHaveBeenCalledWith('4317');
        expect(app.startAllMicroservices.mock.invocationCallOrder[0])
            .toBeLessThan(app.listen.mock.invocationCallOrder[0]);
    });

    it('starts ingestion and HTTP, but not evaluation, for the ingest role', async () => {
        await bootstrap('ingest');

        expect(app.connectMicroservice).toHaveBeenCalledTimes(1);
        expect(app.connectMicroservice).toHaveBeenCalledWith({
            transport: Transport.RMQ,
            options: expect.objectContaining({ queue: 'test-ingestion' }),
        });
        expect(app.startAllMicroservices).toHaveBeenCalledTimes(1);
        expect(app.listen).toHaveBeenCalledWith('4317');
    });

    it('starts only evaluation and does not listen over HTTP for the evaluate role', async () => {
        await bootstrap('evaluate');

        expect(app.connectMicroservice).toHaveBeenCalledTimes(1);
        expect(app.connectMicroservice).toHaveBeenCalledWith({
            transport: Transport.RMQ,
            options: expect.objectContaining({ queue: 'test-evaluation' }),
        });
        expect(app.startAllMicroservices).toHaveBeenCalledTimes(1);
        expect(app.listen).not.toHaveBeenCalled();
    });

    it('defaults to the both role when no role is configured', async () => {
        delete process.env.PROCESS_ROLE;

        await bootstrap();

        expect(app.connectMicroservice).toHaveBeenCalledTimes(2);
        expect(app.listen).toHaveBeenCalledWith('4317');
    });

    it('installs strict global validation for every deployment role', async () => {
        await bootstrap('evaluate');

        expect(app.useGlobalPipes).toHaveBeenCalledTimes(1);
        const [pipe] = app.useGlobalPipes.mock.calls[0];
        expect(pipe).toBeInstanceOf(ValidationPipe);
    });
});
