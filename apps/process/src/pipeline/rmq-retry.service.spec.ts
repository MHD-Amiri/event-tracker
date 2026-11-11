import { ConfigService } from '@nestjs/config';
import { RmqContext } from '@nestjs/microservices';
import { RmqRetryService } from './rmq-retry.service';

describe('RmqRetryService', () => {
    let service: RmqRetryService;
    let channel: {
        assertQueue: jest.Mock;
        sendToQueue: jest.Mock;
        ack: jest.Mock;
    };
    let message: any;
    let context: RmqContext;

    beforeEach(() => {
        channel = {
            assertQueue: jest.fn().mockResolvedValue(undefined),
            sendToQueue: jest.fn().mockReturnValue(true),
            ack: jest.fn(),
        };
        message = {
            content: Buffer.from('{"pattern":"event_created"}'),
            properties: {
                contentType: 'application/json',
                headers: { traceId: 'trace-1' },
            },
        };
        context = {
            getChannelRef: () => channel,
            getMessage: () => message,
        } as unknown as RmqContext;
        service = new RmqRetryService({
            get: (_key: string, fallback: unknown) => fallback,
        } as ConfigService);
    });

    it('sends a transient failure to a delayed retry queue and acknowledges the source', async () => {
        await service.handleFailure(context, 'events_queue', new Error('temporary database error'));

        expect(channel.assertQueue).toHaveBeenCalledWith('events_queue.retry', {
            durable: true,
            arguments: {
                'x-message-ttl': 5000,
                'x-dead-letter-exchange': '',
                'x-dead-letter-routing-key': 'events_queue',
            },
        });
        expect(channel.sendToQueue).toHaveBeenCalledWith(
            'events_queue.retry',
            message.content,
            expect.objectContaining({
                persistent: true,
                headers: { traceId: 'trace-1', 'x-event-tracker-retry-count': 1 },
            }),
        );
        expect(channel.ack).toHaveBeenCalledWith(message);
    });

    it('sends a permanent failure directly to the dead-letter queue', async () => {
        await service.handleFailure(context, 'events_queue', new Error('invalid event'), true);

        expect(channel.assertQueue).toHaveBeenCalledWith('events_queue.dlq', { durable: true });
        expect(channel.sendToQueue).toHaveBeenCalledWith(
            'events_queue.dlq',
            message.content,
            expect.objectContaining({
                persistent: true,
                headers: expect.objectContaining({
                    traceId: 'trace-1',
                    'x-event-tracker-failure': 'invalid event',
                }),
            }),
        );
        expect(channel.ack).toHaveBeenCalledWith(message);
    });

    it('dead-letters a transient message after the retry limit is reached', async () => {
        message.properties.headers['x-event-tracker-retry-count'] = 3;

        await service.handleFailure(
            context,
            'events_evaluation_queue',
            new Error('database unavailable'),
        );

        expect(channel.assertQueue).toHaveBeenCalledWith('events_evaluation_queue.dlq', {
            durable: true,
        });
        expect(channel.sendToQueue).toHaveBeenCalledWith(
            'events_evaluation_queue.dlq',
            message.content,
            expect.objectContaining({
                headers: expect.objectContaining({ 'x-event-tracker-retry-count': 3 }),
            }),
        );
        expect(channel.ack).toHaveBeenCalledWith(message);
    });

    it('does not acknowledge the source if forwarding to the retry queue fails', async () => {
        channel.assertQueue.mockRejectedValueOnce(new Error('broker unavailable'));

        await expect(
            service.handleFailure(context, 'events_queue', new Error('temporary')),
        ).rejects.toThrow('broker unavailable');
        expect(channel.ack).not.toHaveBeenCalled();
    });
});
