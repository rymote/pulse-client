import { AsyncQueue } from './async-queue.class.js';
import { IByteChannel } from './byte-channel.interface.js';

export class WebSocketByteChannel implements IByteChannel {
    private readonly webSocket: WebSocket;
    private readonly incomingChunks: AsyncQueue<Uint8Array>;
    private readonly outgoingBuffer: Uint8Array[] = [];

    private pendingChunk: Uint8Array | null = null;
    private pendingChunkOffset = 0;
    private receiveEnded = false;
    private outgoingBufferedLength = 0;

    constructor(webSocket: WebSocket) {
        this.webSocket = webSocket;
        this.webSocket.binaryType = 'arraybuffer';
        this.incomingChunks = new AsyncQueue<Uint8Array>();

        this.webSocket.addEventListener('message', (messageEvent) => this.handleMessage(messageEvent));
        this.webSocket.addEventListener('close', () => this.handleClose());
        this.webSocket.addEventListener('error', () => this.handleClose());
    }

    private handleMessage(messageEvent: MessageEvent): void {
        const data = messageEvent.data;
        if (typeof data === 'string') return;
        let chunk: Uint8Array;
        if (data instanceof ArrayBuffer) {
            chunk = new Uint8Array(data);
        } else if (data instanceof Uint8Array) {
            chunk = data;
        } else if (typeof Blob !== 'undefined' && data instanceof Blob) {
            void data.arrayBuffer().then((arrayBuffer) => this.incomingChunks.enqueue(new Uint8Array(arrayBuffer)));
            return;
        } else {
            return;
        }
        this.incomingChunks.enqueue(chunk);
    }

    private handleClose(): void {
        if (this.receiveEnded) return;
        this.receiveEnded = true;
        this.incomingChunks.close();
    }

    public async read(buffer: Uint8Array, abortSignal: AbortSignal): Promise<number> {
        if (this.pendingChunk === null || this.pendingChunkOffset >= this.pendingChunk.length) {
            if (this.receiveEnded && this.pendingChunk === null) return 0;
            const nextChunk = await this.incomingChunks.dequeue(abortSignal);
            if (nextChunk === null) return 0;
            this.pendingChunk = nextChunk;
            this.pendingChunkOffset = 0;
        }

        const bytesAvailable = this.pendingChunk.length - this.pendingChunkOffset;
        const bytesToCopy = Math.min(buffer.length, bytesAvailable);
        buffer.set(this.pendingChunk.subarray(this.pendingChunkOffset, this.pendingChunkOffset + bytesToCopy), 0);
        this.pendingChunkOffset += bytesToCopy;
        return bytesToCopy;
    }

    public async write(data: Uint8Array): Promise<void> {
        this.outgoingBuffer.push(data);
        this.outgoingBufferedLength += data.length;
    }

    public async flush(): Promise<void> {
        if (this.outgoingBufferedLength === 0) return;

        const combined = new Uint8Array(this.outgoingBufferedLength);
        let offset = 0;
        for (const chunk of this.outgoingBuffer) {
            combined.set(chunk, offset);
            offset += chunk.length;
        }
        this.outgoingBuffer.length = 0;
        this.outgoingBufferedLength = 0;

        if (this.webSocket.readyState !== WebSocket.OPEN) {
            throw new Error('WebSocket is not open.');
        }

        this.webSocket.send(combined);
    }

    public async close(): Promise<void> {
        try {
            if (this.webSocket.readyState === WebSocket.OPEN || this.webSocket.readyState === WebSocket.CONNECTING) {
                this.webSocket.close(1000, 'pulse-client closing');
            }
        } catch {
            // best-effort
        }
        this.handleClose();
    }
}
