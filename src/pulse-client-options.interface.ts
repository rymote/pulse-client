import { PulseQueryParameters } from './pulse-query-parameters.type.js';

export interface PulseClientOptions {
    reconnectIntervalMs?: number;
    maxReconnectAttempts?: number;
    authToken?: string;
    requestTimeoutMs?: number;
    autoReconnect?: boolean;
    queryParameters?: PulseQueryParameters;
}
