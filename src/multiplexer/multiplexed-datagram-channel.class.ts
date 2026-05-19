import { AsyncQueue } from '../transport/async-queue.class.js';
import { IPulseDatagramChannel } from '../transport/pulse-datagram-channel.interface.js';
import { IMultiplexerStreamOwner } from './virtual-pulse-stream.class.js';
import { MultiplexerOutboundFrame } from './multiplexer-outbound-frame.class.js';
import { MULTIPLEXER_FRAME_OPS } from './multiplexer-frame-ops.js';

export class MultiplexedDatagramChannel implements IPulseDatagramChannel {
    public readonly maxDatagramEnvelopeSizeInBytes: number;

    private readonly multiplexer: IMultiplexerStreamOwner;
    private readonly incomingDatagrams: AsyncQueue<Uint8Array>;

    constructor(multiplexer: IMultiplexerStreamOwner, maxDatagramEnvelopeSizeInBytes: number) {
        this.multiplexer = multiplexer;
        this.maxDatagramEnvelopeSizeInBytes = maxDatagramEnvelopeSizeInBytes;
        this.incomingDatagrams = new AsyncQueue<Uint8Array>();
    }

    public async receiveDatagram(abortSignal?: AbortSignal): Promise<Uint8Array | null> {
        return this.incomingDatagrams.dequeue(abortSignal);
    }

    public async sendDatagram(envelopeFrame: Uint8Array): Promise<void> {
        if (envelopeFrame.length > this.maxDatagramEnvelopeSizeInBytes) {
            throw new Error(
                `Datagram envelope (${envelopeFrame.length} bytes) exceeds maxDatagramEnvelopeSizeInBytes (${this.maxDatagramEnvelopeSizeInBytes}).`,
            );
        }

        await this.multiplexer.queueOutboundFrame(
            new MultiplexerOutboundFrame(0, MULTIPLEXER_FRAME_OPS.DATAGRAM, envelopeFrame),
        );
    }

    public enqueueIncoming(envelopeFrame: Uint8Array): void {
        this.incomingDatagrams.enqueue(envelopeFrame);
    }

    public complete(): void {
        this.incomingDatagrams.close();
    }
}
