export interface IPulseDatagramChannel {
    readonly maxDatagramEnvelopeSizeInBytes: number;

    receiveDatagram(abortSignal?: AbortSignal): Promise<Uint8Array | null>;
    sendDatagram(envelopeFrame: Uint8Array): Promise<void>;
}
