import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { Transport } from '@nestjs/microservices';
import { bootstrap, runBootstrap } from './main';

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
    let originalExitCode: typeof process.exitCode;
    let app: {
        enableShutdownHooks: jest.Mock;
        useGlobalPipes: jest.Mock;
        connectMicroservice: jest.Mock;
        startAllMicroservices: jest.Mock;
        listen: jest.Mock;
    };

    const create = NestFactory.create as jest.Mock;

    beforeEach(() => {
        jest.clearAllMocks();
        originalExitCode = process.exitCode;
        originalEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
        process.env.PROCESS_ROLE = 'both';
        process.env.PORT = '4317';
        process.env.RABBITMQ_URL = 'amqp://test-broker';
        process.env.RMQ_INGESTION_QUEUE = 'test-ingestion';
        process.env.RMQ_EVALUATION_QUEUE = 'test-evaluation';
        jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);

        app = {
            enableShutdownHooks: jest.fn(),
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
        process.exitCode = originalExitCode;
    });

    it('starts both queues and the HTTP server for the both role', async () => {
        await bootstrap('both');

        expect(app.enableShutdownHooks).toHaveBeenCalledTimes(1);
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
        expect(Logger.prototype.log).toHaveBeenCalledWith(
            'role=both HTTP server listening on port=4317',
        );
        expect(app.startAllMicroservices.mock.invocationCallOrder[0]).toBeLessThan(
            app.listen.mock.invocationCallOrder[0],
        );
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
        expect(Logger.prototype.log).toHaveBeenCalledWith(
            'role=evaluate evaluation worker listening to RabbitMQ queue=test-evaluation',
        );
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

    it('logs a clear startup error and exits unsuccessfully when bootstrap rejects', async () => {
        const errorLog = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
        const error = new Error('broker initialization failed');
        create.mockRejectedValueOnce(error);

        await expect(runBootstrap()).resolves.toBe(false);

        expect(errorLog).toHaveBeenCalledWith(
            'Process startup failed: Error: broker initialization failed',
        );
        expect(process.exitCode).toBe(1);
    });

    it('logs circular rejection details without throwing from the error handler', async () => {
        const errorLog = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
        const error: Record<string, unknown> = {};
        error.cause = error;
        create.mockRejectedValueOnce(error);

        await expect(runBootstrap()).resolves.toBe(false);

        expect(errorLog).toHaveBeenCalledWith(
            'Process startup failed: [unserializable error details]',
        );
        expect(process.exitCode).toBe(1);
    });
});
