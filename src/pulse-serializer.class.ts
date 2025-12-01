import { Packr, Unpackr } from 'msgpackr';
import { ChaCha20Poly1305 } from '@stablelib/chacha20poly1305';
import { PulseEnvelope } from './pulse-envelope.class';

export class PulseSerializer {
    private static readonly NONCE_LENGTH = 12;
    private static readonly TAG_LENGTH = 16;
    private static readonly KEY_BYTES = new Uint8Array([
        0xf3, 0xb4, 0xd8, 0x9e, 0x3a, 0x6c, 0x2b, 0x75, 0xa1, 0xee, 0x4c, 0x6d, 0x90, 0xf8, 0xa2, 0x13, 0x4d, 0xd8, 0x9e, 0x3a, 0xa1, 0xbc,
        0x67, 0x42, 0x3f, 0xf4, 0xb6, 0x21, 0x84, 0xce, 0x93, 0xde,
    ]);

    private readonly packer: Packr;
    private readonly unpacker: Unpackr;
    private readonly cipher: ChaCha20Poly1305;

    constructor() {
        this.packer = new Packr({ useRecords: false });
        this.unpacker = new Unpackr({ useRecords: false });
        this.cipher = new ChaCha20Poly1305(PulseSerializer.KEY_BYTES);
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
        ];

        const plaintext = this.packer.pack(envelopeArray);

        const nonce = crypto.getRandomValues(new Uint8Array(PulseSerializer.NONCE_LENGTH));
        const sealed = this.cipher.seal(nonce, plaintext);

        const frame = new Uint8Array(nonce.length + sealed.length);
        frame.set(nonce, 0);
        frame.set(sealed, nonce.length);

        return frame;
    }

    public unpackEnvelope<T>(data: ArrayBuffer | Uint8Array): PulseEnvelope<T> {
        const buffer = data instanceof ArrayBuffer ? new Uint8Array(data) : data;

        if (buffer.length <= PulseSerializer.NONCE_LENGTH + PulseSerializer.TAG_LENGTH) {
            throw new Error('Frame too short');
        }

        const nonce = buffer.subarray(0, PulseSerializer.NONCE_LENGTH);
        const sealed = buffer.subarray(PulseSerializer.NONCE_LENGTH);

        const plaintext = this.cipher.open(nonce, sealed);
        if (plaintext === null) {
            throw new Error('Authentication failed');
        }

        const array = this.unpacker.unpack(plaintext) as any[];

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

        return envelope;
    }
}

export default new PulseSerializer();
