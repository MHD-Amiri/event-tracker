export interface SensorEventPayload {
    name: string;
    value: number;
}

export interface SensorEventMessage {
    agentId: string;
    timestamp: string; // ISO 8601
    payload: SensorEventPayload;
}
