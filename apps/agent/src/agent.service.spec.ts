import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ClientProxy } from '@nestjs/microservices';
import { faker } from '@faker-js/faker';
import * as rmq from '@app/rmq';
import { AgentService } from './agent.service';
import { SensorEventMessage } from './sensor-event.interface';

jest.mock('@app/rmq', () => ({
    ...jest.requireActual('@app/rmq'),
    clientProxy: jest.fn(),
}));

describe('AgentService', () => {
    const metrics = ['temperature', 'pressure', 'humidity', 'voltage', 'cpu_load'];

    let client: {
        connect: jest.Mock;
        close: jest.Mock;
        emit: jest.Mock;
    };
    let config: ConfigService;
    let service: AgentService;
    const clientProxyMock = rmq.clientProxy as jest.Mock;

    const createConfig = (values: Record<string, string> = {}) => ({
        get: jest.fn((key: string, defaultValue?: unknown) => values[key] ?? defaultValue),
    }) as unknown as ConfigService;

    beforeEach(() => {
        jest.clearAllMocks();
        jest.useFakeTimers();
        jest.setSystemTime(new Date('2026-11-09T12:34:56.000Z'));
        jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
        faker.seed(1234);

        client = {
            connect: jest.fn().mockResolvedValue(undefined),
            close: jest.fn(),
            emit: jest.fn(),
        };
        config = createConfig();
        clientProxyMock.mockReturnValue(client as unknown as ClientProxy);
        service = new AgentService(config);
    });

    afterEach(() => {
        service?.onModuleDestroy();
        jest.useRealTimers();
        jest.restoreAllMocks();
    });

    it('connects through the shared ingestion queue and emits a documented SensorEvent', async () => {
        await service.onModuleInit();

        expect(clientProxyMock).toHaveBeenCalledWith('events_queue', config);
        expect(client.connect).toHaveBeenCalledTimes(1);

        await jest.advanceTimersByTimeAsync(200);

        expect(client.emit).toHaveBeenCalledTimes(1);
        expect(client.emit).toHaveBeenCalledWith('event_created', expect.objectContaining({
            agentId: 'agent-default-1',
            timestamp: '2026-11-09T12:34:56.200Z',
            payload: expect.objectContaining({
                name: expect.any(String),
                value: expect.any(Number),
            }),
        } satisfies Partial<SensorEventMessage>));

        const [, sensorEvent] = client.emit.mock.calls[0] as [string, SensorEventMessage];
        expect(metrics).toContain(sensorEvent.payload.name);
        expect(sensorEvent.payload.value).toBeGreaterThanOrEqual(10);
        expect(sensorEvent.payload.value).toBeLessThanOrEqual(120);
        expect(sensorEvent.payload.value).toBe(Number(sensorEvent.payload.value.toFixed(2)));
        expect(new Date(sensorEvent.timestamp).toISOString()).toBe(sensorEvent.timestamp);
    });

    it('uses the configured agent ID and emission interval', async () => {
        config = createConfig({ AGENT_ID: 'sensor-west-3', AGENT_EMIT_INTERVAL_MS: '50' });
        service = new AgentService(config);

        await service.onModuleInit();
        await jest.advanceTimersByTimeAsync(149);
        expect(client.emit).toHaveBeenCalledTimes(2);

        const emitted = client.emit.mock.calls.map(([, sensorEvent]) => sensorEvent as SensorEventMessage);
        expect(emitted.every((sensorEvent) => sensorEvent.agentId === 'sensor-west-3')).toBe(true);
    });

    it('waits for the broker connection before starting emission', async () => {
        let resolveConnect!: () => void;
        client.connect.mockReturnValueOnce(new Promise<void>((resolve) => {
            resolveConnect = resolve;
        }));

        const initialization = service.onModuleInit();
        await jest.advanceTimersByTimeAsync(1000);
        expect(client.emit).not.toHaveBeenCalled();

        resolveConnect();
        await initialization;
        await jest.advanceTimersByTimeAsync(200);
        expect(client.emit).toHaveBeenCalledTimes(1);
    });

    it('does not start emission when the broker connection fails', async () => {
        client.connect.mockRejectedValueOnce(new Error('broker unavailable'));

        await expect(service.onModuleInit()).rejects.toThrow('broker unavailable');
        await jest.advanceTimersByTimeAsync(1000);

        expect(client.emit).not.toHaveBeenCalled();
    });

    it('clears the emission interval and closes the broker client on shutdown', async () => {
        await service.onModuleInit();
        await jest.advanceTimersByTimeAsync(200);
        expect(client.emit).toHaveBeenCalledTimes(1);

        service.onModuleDestroy();
        await jest.advanceTimersByTimeAsync(1000);

        expect(client.close).toHaveBeenCalledTimes(1);
        expect(client.emit).toHaveBeenCalledTimes(1);
    });
});
