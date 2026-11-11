import { Logger } from '@nestjs/common';
import { RmqContext } from '@nestjs/microservices';
import { PipelineController } from './pipeline.controller';
import { PipelineService } from './pipeline.service';
import { SensorEventMessage } from './schemas/event.schema';

describe('PipelineController', () => {
    let ingest: jest.Mock;
    let evaluate: jest.Mock;
    let ack: jest.Mock;
    let nack: jest.Mock;
    let controller: PipelineController;

    const sensorEvent: SensorEventMessage = {
        agentId: 'agent-1',
        timestamp: '2026-11-09T00:00:00.000Z',
        payload: { name: 'temperature', value: 42.5 },
    };
    const originalMessage = { content: Buffer.from('sensor event') };

    const createContext = () => ({
        getChannelRef: () => ({ ack, nack }),
        getMessage: () => originalMessage,
    }) as unknown as RmqContext;

    beforeEach(() => {
        ingest = jest.fn().mockResolvedValue(undefined);
        evaluate = jest.fn().mockResolvedValue(undefined);
        ack = jest.fn();
        nack = jest.fn();
        jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
        controller = new PipelineController({ ingest, evaluate } as unknown as PipelineService);
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    describe('handleEventCreated()', () => {
        it('delegates the SensorEvent once and acknowledges the broker message on success', async () => {
            await controller.handleEventCreated(sensorEvent, createContext());

            expect(ingest).toHaveBeenCalledTimes(1);
            expect(ingest).toHaveBeenCalledWith(sensorEvent);
            expect(ack).toHaveBeenCalledWith(originalMessage);
            expect(nack).not.toHaveBeenCalled();
        });

        it('nacks with requeue enabled when ingestion fails', async () => {
            ingest.mockRejectedValue(new Error('temporary database failure'));

            await controller.handleEventCreated(sensorEvent, createContext());

            expect(ingest).toHaveBeenCalledTimes(1);
            expect(ingest).toHaveBeenCalledWith(sensorEvent);
            expect(ack).not.toHaveBeenCalled();
            expect(nack).toHaveBeenCalledWith(originalMessage, false, true);
        });
    });

    describe('handleEvaluation()', () => {
        it('delegates the SensorEvent once and acknowledges the broker message on success', async () => {
            await controller.handleEvaluation(sensorEvent, createContext());

            expect(evaluate).toHaveBeenCalledTimes(1);
            expect(evaluate).toHaveBeenCalledWith(sensorEvent);
            expect(ack).toHaveBeenCalledWith(originalMessage);
            expect(nack).not.toHaveBeenCalled();
        });

        it('nacks without requeue when evaluation fails', async () => {
            evaluate.mockRejectedValue(new Error('invalid cached Rule'));

            await controller.handleEvaluation(sensorEvent, createContext());

            expect(evaluate).toHaveBeenCalledTimes(1);
            expect(evaluate).toHaveBeenCalledWith(sensorEvent);
            expect(ack).not.toHaveBeenCalled();
            expect(nack).toHaveBeenCalledWith(originalMessage, false, false);
        });
    });
});
