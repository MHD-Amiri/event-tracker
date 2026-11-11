import { InvalidSensorEventError, validateSensorEventMessage } from './sensor-event.validation';
import { SensorEventMessage } from './schemas/event.schema';

describe('validateSensorEventMessage()', () => {
    const validEvent: SensorEventMessage = {
        eventId: 'event-1',
        agentId: 'agent-1',
        timestamp: '2026-11-09T00:00:00.000Z',
        payload: { name: 'temperature', value: 22.5 },
    };

    it('accepts a well-formed sensor event', () => {
        expect(() => validateSensorEventMessage(validEvent)).not.toThrow();
    });

    it.each([
        null,
        {},
        { ...validEvent, eventId: '' },
        { ...validEvent, agentId: '' },
        { ...validEvent, timestamp: 'yesterday' },
        { ...validEvent, payload: null },
        { ...validEvent, payload: { name: '', value: 1 } },
        { ...validEvent, payload: { name: 'temperature', value: Number.NaN } },
    ])('rejects malformed broker input: %j', (input) => {
        expect(() => validateSensorEventMessage(input)).toThrow(InvalidSensorEventError);
    });
});
