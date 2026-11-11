import { SensorEventMessage } from './schemas/event.schema';

export class InvalidSensorEventError extends Error {
    constructor(message: string) {
        super(`Invalid sensor event: ${message}`);
        this.name = 'InvalidSensorEventError';
    }
}

export function validateSensorEventMessage(value: unknown): asserts value is SensorEventMessage {
    if (!isRecord(value)) {
        throw new InvalidSensorEventError('message must be an object');
    }

    if (typeof value.eventId !== 'string' || value.eventId.trim().length === 0 || value.eventId.length > 256) {
        throw new InvalidSensorEventError('eventId must be a non-empty string up to 256 characters');
    }

    if (typeof value.agentId !== 'string' || value.agentId.trim().length === 0) {
        throw new InvalidSensorEventError('agentId must be a non-empty string');
    }

    if (typeof value.timestamp !== 'string' || !Number.isFinite(Date.parse(value.timestamp))) {
        throw new InvalidSensorEventError('timestamp must be a valid date string');
    }

    if (!isRecord(value.payload)) {
        throw new InvalidSensorEventError('payload must be an object');
    }

    if (typeof value.payload.name !== 'string' || value.payload.name.trim().length === 0) {
        throw new InvalidSensorEventError('payload.name must be a non-empty string');
    }

    if (typeof value.payload.value !== 'number' || !Number.isFinite(value.payload.value)) {
        throw new InvalidSensorEventError('payload.value must be a finite number');
    }
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
