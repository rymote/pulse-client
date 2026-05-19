import { PulseStreamDirection } from './pulse-stream-direction.enum.js';

export interface IPulseStream {
    readonly streamId: number;
    readonly direction: PulseStreamDirection;
    readonly isClosed: boolean;

    readEnvelope(abortSignal?: AbortSignal): Promise<Uint8Array | null>;
    writeEnvelope(envelopeFrame: Uint8Array): Promise<void>;
    completeWrites(): Promise<void>;
    abort(reasonCode: number): Promise<void>;
    dispose(): Promise<void>;
}
