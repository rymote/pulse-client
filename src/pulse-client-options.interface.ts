import { IPulseClientTransport } from './transport/pulse-client-transport.interface.js';
import { PulseQueryParameters } from './pulse-query-parameters.type.js';

export interface PulseClientOptions {
    endpoint: string | URL;
    transports: IPulseClientTransport[];
    authToken?: string;
    queryParameters?: PulseQueryParameters;
    autoReconnect?: boolean;
    reconnectInitialDelayMs?: number;
    reconnectMaxDelayMs?: number;
    maxReconnectAttempts?: number;
    connectTimeoutMs?: number;
    requestTimeoutMs?: number;
}
