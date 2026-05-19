import { AsyncQueue } from '../transport/async-queue.class.js';
import { IByteChannel } from '../transport/byte-channel.interface.js';
import { IPulseDatagramChannel } from '../transport/pulse-datagram-channel.interface.js';
import { IPulseSession } from '../transport/pulse-session.interface.js';
import { IPulseStream } from '../transport/pulse-stream.interface.js';
import { PulseStreamDirection } from '../transport/pulse-stream-direction.enum.js';
import { MultiplexedDatagramChannel } from './multiplexed-datagram-channel.class.js';
import { MultiplexerOptions } from './multiplexer-options.interface.js';
import { MultiplexerOutboundFrame } from './multiplexer-outbound-frame.class.js';
import { MULTIPLEXER_FRAME_OPS } from './multiplexer-frame-ops.js';
import { IMultiplexerStreamOwner, VirtualPulseStream } from './virtual-pulse-stream.class.js';

const HEADER_LENGTH = 9;
const STREAM_ID_RESERVED_CONTROL = 0;

export class PulseStreamMultiplexer implements IPulseSession, IMultiplexerStreamOwner {
    public readonly sessionId: string;
    public readonly transportName: string;
    public readonly isServerSide: boolean;
    public readonly queryParameters: Readonly<Record<string, string>>;
    public readonly initialMetadata: Readonly<Record<string, unknown>>;
    public get isOpen(): boolean {
        return !this.disposed;
    }
    public get datagrams(): IPulseDatagramChannel | null {
        return this.datagramChannel;
    }

    private readonly byteChannel: IByteChannel;
    private readonly options: MultiplexerOptions;
    private readonly activeStreams = new Map<number, VirtualPulseStream>();
    private readonly incomingStreams: AsyncQueue<IPulseStream>;
    private readonly outboundFrames: AsyncQueue<MultiplexerOutboundFrame>;
    private readonly datagramChannel: MultiplexedDatagramChannel | null;
    private nextOutgoingStreamId: number;
    private readonly shutdownAbortController = new AbortController();
    private disposed = false;

    constructor(
        byteChannel: IByteChannel,
        isServerSide: boolean,
        transportName: string,
        options: MultiplexerOptions,
        queryParameters?: Readonly<Record<string, string>>,
        initialMetadata?: Readonly<Record<string, unknown>>,
    ) {
        this.byteChannel = byteChannel;
        this.isServerSide = isServerSide;
        this.transportName = transportName;
        this.options = options;
        this.queryParameters = queryParameters ?? {};
        this.initialMetadata = initialMetadata ?? {};
        this.sessionId = crypto.randomUUID();
        this.nextOutgoingStreamId = isServerSide ? 0 : -1;

        this.incomingStreams = new AsyncQueue<IPulseStream>();
        this.outboundFrames = new AsyncQueue<MultiplexerOutboundFrame>();
        this.datagramChannel = options.datagramsEnabled
            ? new MultiplexedDatagramChannel(this, options.maxDatagramEnvelopeSizeInBytes)
            : null;
    }

    public start(): void {
        void this.runReader();
        void this.runWriter();
    }

    public async acceptStream(abortSignal?: AbortSignal): Promise<IPulseStream | null> {
        return this.incomingStreams.dequeue(abortSignal);
    }

    public async openStream(direction: PulseStreamDirection): Promise<IPulseStream> {
        const newStreamId = this.allocateOutgoingStreamId();
        const virtualStream = new VirtualPulseStream(this, newStreamId, direction);
        this.activeStreams.set(newStreamId, virtualStream);

        const op = direction === PulseStreamDirection.Bidirectional
            ? MULTIPLEXER_FRAME_OPS.OPEN_BIDI
            : MULTIPLEXER_FRAME_OPS.OPEN_UNI;

        await this.queueOutboundFrame(new MultiplexerOutboundFrame(newStreamId, op, new Uint8Array(0)));
        return virtualStream;
    }

    public async close(reasonCode: number, drainTimeoutMs: number): Promise<void> {
        const goawayPayload = new Uint8Array(4);
        new DataView(goawayPayload.buffer).setUint32(0, Math.max(0, drainTimeoutMs), false);

        try {
            await this.queueOutboundFrame(new MultiplexerOutboundFrame(STREAM_ID_RESERVED_CONTROL, MULTIPLEXER_FRAME_OPS.GOAWAY, goawayPayload));
        } catch {
            // best-effort
        }

        if (drainTimeoutMs > 0) {
            await new Promise((resolve) => setTimeout(resolve, drainTimeoutMs));
        }

        await this.dispose();
    }

    public async dispose(): Promise<void> {
        if (this.disposed) return;
        this.disposed = true;

        this.shutdownAbortController.abort();
        this.outboundFrames.close();
        this.incomingStreams.close();
        this.datagramChannel?.complete();

        try {
            await this.byteChannel.close();
        } catch {
            // best-effort
        }
    }

    public async queueOutboundFrame(frame: MultiplexerOutboundFrame): Promise<void> {
        if (!this.outboundFrames.enqueue(frame)) {
            throw new Error('Multiplexer is shut down.');
        }
    }

    public onStreamDisposed(streamId: number): void {
        this.activeStreams.delete(streamId);
    }

    private allocateOutgoingStreamId(): number {
        this.nextOutgoingStreamId += 2;
        return this.nextOutgoingStreamId;
    }

    private async runReader(): Promise<void> {
        const headerBuffer = new Uint8Array(HEADER_LENGTH);
        const abortSignal = this.shutdownAbortController.signal;

        try {
            while (!abortSignal.aborted) {
                if (!(await this.readExactly(headerBuffer, abortSignal))) break;

                const dataView = new DataView(headerBuffer.buffer, headerBuffer.byteOffset, headerBuffer.byteLength);
                const streamId = dataView.getUint32(0, false);
                const op = headerBuffer[4];
                const payloadLength = dataView.getUint32(5, false);

                if (payloadLength > this.options.maxFramePayloadSizeInBytes) break;

                let payload: Uint8Array;
                if (payloadLength === 0) {
                    payload = new Uint8Array(0);
                } else {
                    payload = new Uint8Array(payloadLength);
                    if (!(await this.readExactly(payload, abortSignal))) break;
                }

                this.routeFrame(streamId, op, payload);
            }
        } catch {
            // shutdown / connection error
        } finally {
            this.completeIncomingState();
        }
    }

    private async readExactly(buffer: Uint8Array, abortSignal: AbortSignal): Promise<boolean> {
        let bytesRead = 0;
        while (bytesRead < buffer.length) {
            const chunk = await this.byteChannel.read(buffer.subarray(bytesRead), abortSignal);
            if (chunk <= 0) return false;
            bytesRead += chunk;
        }
        return true;
    }

    private routeFrame(streamId: number, op: number, payload: Uint8Array): void {
        switch (op) {
            case MULTIPLEXER_FRAME_OPS.OPEN_BIDI:
                this.openIncomingStream(streamId, PulseStreamDirection.Bidirectional);
                break;
            case MULTIPLEXER_FRAME_OPS.OPEN_UNI: {
                const uniDirection = this.isServerSide
                    ? PulseStreamDirection.UnidirectionalClientToServer
                    : PulseStreamDirection.UnidirectionalServerToClient;
                this.openIncomingStream(streamId, uniDirection);
                break;
            }
            case MULTIPLEXER_FRAME_OPS.DATA: {
                const dataStream = this.activeStreams.get(streamId);
                if (dataStream) dataStream.enqueueIncomingEnvelope(payload);
                break;
            }
            case MULTIPLEXER_FRAME_OPS.FIN: {
                const finStream = this.activeStreams.get(streamId);
                if (finStream) finStream.onFinFromPeer();
                break;
            }
            case MULTIPLEXER_FRAME_OPS.RESET: {
                const reasonCode = payload.length >= 4
                    ? new DataView(payload.buffer, payload.byteOffset, payload.byteLength).getUint32(0, false)
                    : 0;
                const resetStream = this.activeStreams.get(streamId);
                if (resetStream) {
                    this.activeStreams.delete(streamId);
                    resetStream.onResetFromPeer(reasonCode);
                }
                break;
            }
            case MULTIPLEXER_FRAME_OPS.DATAGRAM:
                this.datagramChannel?.enqueueIncoming(payload);
                break;
            case MULTIPLEXER_FRAME_OPS.PING:
                this.outboundFrames.enqueue(
                    new MultiplexerOutboundFrame(0, MULTIPLEXER_FRAME_OPS.PONG, payload),
                );
                break;
            case MULTIPLEXER_FRAME_OPS.PONG:
                // keepalive timer reset would go here
                break;
            case MULTIPLEXER_FRAME_OPS.GOAWAY:
                this.completeIncomingState();
                break;
            default:
                // unknown op — drop silently
                break;
        }
    }

    private openIncomingStream(streamId: number, direction: PulseStreamDirection): void {
        if (this.activeStreams.has(streamId)) {
            void this.queueOutboundFrame(MultiplexerOutboundFrame.reset(streamId, 3));
            return;
        }

        const virtualStream = new VirtualPulseStream(this, streamId, direction);
        this.activeStreams.set(streamId, virtualStream);
        this.incomingStreams.enqueue(virtualStream);
    }

    private async runWriter(): Promise<void> {
        const headerBuffer = new Uint8Array(HEADER_LENGTH);
        const headerView = new DataView(headerBuffer.buffer);

        try {
            while (true) {
                const frame = await this.outboundFrames.dequeue();
                if (frame === null) break;

                headerView.setUint32(0, frame.streamId, false);
                headerBuffer[4] = frame.op;
                headerView.setUint32(5, frame.payload.length, false);

                await this.byteChannel.write(headerBuffer);
                if (frame.payload.length > 0) {
                    await this.byteChannel.write(frame.payload);
                }
                await this.byteChannel.flush();
            }
        } catch {
            // shutdown / connection error
        }
    }

    private completeIncomingState(): void {
        this.incomingStreams.close();
        for (const virtualStream of this.activeStreams.values()) {
            virtualStream.onFinFromPeer();
        }
        this.datagramChannel?.complete();
    }
}
