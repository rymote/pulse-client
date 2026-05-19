import { IPulseSession } from './pulse-session.interface.js';

export interface IPulseClientTransport {
    readonly name: string;

    connect(
        endpoint: URL,
        authToken: string | undefined,
        queryParameters: Readonly<Record<string, string>> | undefined,
        abortSignal: AbortSignal,
    ): Promise<IPulseSession>;
}
