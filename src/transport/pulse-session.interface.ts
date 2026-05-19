import { IPulseDatagramChannel } from './pulse-datagram-channel.interface.js';
import { IPulseStream } from './pulse-stream.interface.js';
import { PulseStreamDirection } from './pulse-stream-direction.enum.js';

export interface IPulseSession {
    readonly sessionId: string;
    readonly transportName: string;
    readonly isOpen: boolean;
    readonly queryParameters: Readonly<Record<string, string>>;
    readonly initialMetadata: Readonly<Record<string, unknown>>;
    readonly datagrams: IPulseDatagramChannel | null;

    acceptStream(abortSignal?: AbortSignal): Promise<IPulseStream | null>;
    openStream(direction: PulseStreamDirection, abortSignal?: AbortSignal): Promise<IPulseStream>;
    close(reasonCode: number, drainTimeoutMs: number): Promise<void>;
    dispose(): Promise<void>;
}
