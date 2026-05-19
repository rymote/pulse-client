import { AsyncQueue } from '../transport/async-queue.class.js';
import { IPulseStream } from '../transport/pulse-stream.interface.js';
import { PulseStreamDirection } from '../transport/pulse-stream-direction.enum.js';
import { PulseStreamResetError } from '../transport/pulse-stream-reset-error.class.js';
import { MultiplexerOutboundFrame } from './multiplexer-outbound-frame.class.js';
import { MULTIPLEXER_FRAME_OPS } from './multiplexer-frame-ops.js';

export interface IMultiplexerStreamOwner {
    readonly isServerSide: boolean;
    queueOutboundFrame(frame: MultiplexerOutboundFrame): Promise<void>;
    onStreamDisposed(streamId: number): void;
}

export class VirtualPulseStream implements IPulseStream {
    public readonly streamId: number;
    public readonly direction: PulseStreamDirection;
    public get isClosed(): boolean {
        return this._isClosed;
    }

    private _isClosed = false;
    private writeCompleted = false;
    private disposed = false;
    private readonly multiplexer: IMultiplexerStreamOwner;
    private readonly incomingEnvelopes: AsyncQueue<Uint8Array>;

    constructor(multiplexer: IMultiplexerStreamOwner, streamId: number, direction: PulseStreamDirection) {
        this.multiplexer = multiplexer;
        this.streamId = streamId;
        this.direction = direction;
        this.incomingEnvelopes = new AsyncQueue<Uint8Array>();
    }

    public async readEnvelope(abortSignal?: AbortSignal): Promise<Uint8Array | null> {
        if (this.direction === PulseStreamDirection.UnidirectionalClientToServer && !this.multiplexer.isServerSide) {
            throw new Error('Client cannot read from a client-to-server uni stream.');
        }
        if (this.direction === PulseStreamDirection.UnidirectionalServerToClient && this.multiplexer.isServerSide) {
            throw new Error('Server cannot read from a server-to-client uni stream.');
        }

        return this.incomingEnvelopes.dequeue(abortSignal);
    }

    public async writeEnvelope(envelopeFrame: Uint8Array): Promise<void> {
        if (this.direction === PulseStreamDirection.UnidirectionalClientToServer && this.multiplexer.isServerSide) {
            throw new Error('Server cannot write to a client-to-server uni stream.');
        }
        if (this.direction === PulseStreamDirection.UnidirectionalServerToClient && !this.multiplexer.isServerSide) {
            throw new Error('Client cannot write to a server-to-client uni stream.');
        }
        if (this.writeCompleted) throw new Error('Stream write side already completed.');
        if (this._isClosed) throw new Error('Stream is closed.');

        await this.multiplexer.queueOutboundFrame(
            new MultiplexerOutboundFrame(this.streamId, MULTIPLEXER_FRAME_OPS.DATA, envelopeFrame),
        );
    }

    public async completeWrites(): Promise<void> {
        if (this.writeCompleted) return;
        this.writeCompleted = true;
        await this.multiplexer.queueOutboundFrame(
            new MultiplexerOutboundFrame(this.streamId, MULTIPLEXER_FRAME_OPS.FIN, new Uint8Array(0)),
        );
    }

    public async abort(reasonCode: number): Promise<void> {
        this._isClosed = true;
        this.incomingEnvelopes.close(new PulseStreamResetError(reasonCode));
        await this.multiplexer.queueOutboundFrame(MultiplexerOutboundFrame.reset(this.streamId, reasonCode));
    }

    public async dispose(): Promise<void> {
        if (this.disposed) return;
        this.disposed = true;
        this._isClosed = true;
        this.incomingEnvelopes.close();
        this.multiplexer.onStreamDisposed(this.streamId);
    }

    public onFinFromPeer(): void {
        this.incomingEnvelopes.close();
    }

    public onResetFromPeer(reasonCode: number): void {
        this._isClosed = true;
        this.incomingEnvelopes.close(new PulseStreamResetError(reasonCode));
    }

    public enqueueIncomingEnvelope(envelopeFrame: Uint8Array): void {
        this.incomingEnvelopes.enqueue(envelopeFrame);
    }
}
