export interface PulseClientOptions {
    reconnectIntervalMs?: number;
    maxReconnectAttempts?: number;
    authToken?: string;
    requestTimeoutMs?: number;
}
