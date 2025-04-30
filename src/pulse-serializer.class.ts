import { Packr, Unpackr } from 'msgpackr';
import { PulseEnvelope } from './pulse-envelope.class';

function u8ToHex(u8arr: Uint8Array, { separator = ' ' } = {}) {
    return Array.from(u8arr)
        .map((b) => b.toString(16).padStart(2, '0'))
        .join(separator);
}

export class PulseSerializer {
    private readonly packer: Packr;
    private readonly unpacker: Unpackr;

    constructor() {
        this.packer = new Packr({ useRecords: false });
        this.unpacker = new Unpackr({ useRecords: false });
    }

    public packEnvelope<T>(envelope: PulseEnvelope<T>): Uint8Array {
        const bodyPlain = envelope.body && typeof envelope.body === 'object' ? { ...(envelope.body as any) } : envelope.body;

        const envelopeArray = [
            envelope.id ?? null,
            envelope.handle,
            bodyPlain,
            envelope.authToken ?? null,
            envelope.kind,
            envelope.version,
            envelope.clientCorrelationId ?? null,
            envelope.status ?? null,
            envelope.error ?? null,
            envelope.isStreamChunk ?? false,
            envelope.endOfStream ?? false,
        ];

        const packedData = this.packer.pack(envelopeArray);
        return packedData;
    }

    public unpackEnvelope<T>(data: ArrayBuffer | Uint8Array): PulseEnvelope<T> {
        const buffer = data instanceof ArrayBuffer ? new Uint8Array(data) : data;
        console.log('data', buffer.toString());
        console.log('Unpack hex:', u8ToHex(buffer as Uint8Array));

        const array = this.unpacker.unpack(buffer) as any[];
        const envelope = new PulseEnvelope<T>();

        envelope.id = array[0] ?? undefined;
        envelope.handle = array[1];
        envelope.body = array[2] as T;
        envelope.authToken = array[3] ?? undefined;
        envelope.kind = array[4];
        envelope.version = array[5];
        envelope.clientCorrelationId = array[6] ?? undefined;
        envelope.status = array[7] ?? undefined;
        envelope.error = array[8] ?? undefined;
        envelope.isStreamChunk = array[9] ?? false;
        envelope.endOfStream = array[10] ?? false;

        return envelope;
    }
}

export default new PulseSerializer();
