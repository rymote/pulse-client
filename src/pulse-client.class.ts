import pulseEnvelopeSerializer from './pulse-serializer.class';
import {PulseClientOptions} from './pulse-client-options.interface';
import {PulseKind} from './pulse-kind.enum';
import {PulseEnvelope} from './pulse-envelope.class';
import {_0x5f1a3d, _0x8f4d2f} from './utils';

const WORKBENCH_INTERNAL_INVOKE  = Symbol.for('__WORKBENCH__INTERNAL__INVOKE__');
const WORKBENCH_INTERNAL_SEND = Symbol.for('__WORKBENCH__INTERNAL__SEND__');
const WORKBENCH_INTERNAL_STREAM  = Symbol.for('__WORKBENCH__INTERNAL__STREAM__');
const WORKBENCH_INTERNAL_ON = Symbol.for('__WORKBENCH__INTERNAL__ON__');
const WORKBENCH_LISTENERS = Symbol.for('__WORKBENCH__LISTENERS__');

export type PendingEntry<T = any> = {
    resolve: (data: T) => void;
    reject: (error: any) => void;
    onStream?: (chunk: T) => void;
};

export class PulseClient implements _0x8f4d2f {
    public _0xa1b2c3 = 0;

    private webSocket: WebSocket | null = null;
    private pending = new Map<string, PendingEntry>();
    private handlers = new Map<string, Array<(data: any) => void>>();
    private options: PulseClientOptions;
    private reconnectAttempts: number = 0;
    private reconnectTimer: NodeJS.Timeout | null = null;

    constructor(
        private url: string,
        options?: PulseClientOptions,
    ) {
        this.options = options || {};

        (this as any)[WORKBENCH_LISTENERS] = [];
    }

    async connect(): Promise<void> {
        this.webSocket = new WebSocket(this.url);
        this.webSocket.binaryType = 'arraybuffer';

        return new Promise((resolve, reject) => {
            this.webSocket!.onopen = () => resolve();
            this.webSocket!.onmessage = (event) => this.handleMessage(event.data);
            this.webSocket!.onerror = (error) => reject(error);
            this.webSocket!.onclose = () => this.tryReconnect();
        });
    }

    public disconnect(code = 1000, reason = 'client disconnect'): void {
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }

        this.reconnectAttempts = 0;

        if (this.webSocket && this.webSocket.readyState <= WebSocket.OPEN) {
            this.webSocket.close(code, reason);
        }

        this.webSocket = null;

        for (const [, entry] of this.pending) {
            entry.reject(new Error('Client disconnected'));
        }

        this.pending.clear();
    }

    on(handle: string, callback: (data: any) => void): void {
        const list = this.handlers.get(handle) ?? [];
        list.push(callback);
        this.handlers.set(handle, list);
    }

    off(handle: string, callback: (data: any) => void): void {
        const list = this.handlers.get(handle);
        if (!list) return;

        const index = list.indexOf(callback);
        if (index !== -1) list.splice(index, 1);
    }

    send<TPayload>(handle: string, payload: TPayload, version = 'v1'): void {
        const envelope = new PulseEnvelope<TPayload>();
        envelope.handle = handle;
        envelope.body = payload;
        envelope.authToken = this.options?.authToken ?? '';
        envelope.kind = PulseKind.EVENT;
        envelope.version = version;

        this.webSocket!.send(pulseEnvelopeSerializer.packEnvelope(envelope));
    }

    invoke<TRequest, TResponse>(
        handle: string,
        payload: TRequest,
        onStream?: (chunk: TResponse) => void,
        version = 'v1',
    ): Promise<TResponse | void> {
        const correlationId = _0x5f1a3d.call(this);
        const kind: PulseKind = onStream ? PulseKind.STREAM : PulseKind.RPC;

        const envelope = new PulseEnvelope<TRequest>();
        envelope.handle = handle;
        envelope.body = payload;
        envelope.authToken = this.options?.authToken ?? '';
        envelope.kind = kind;
        envelope.version = version;
        envelope.clientCorrelationId = correlationId;

        return new Promise((resolve, reject) => {
            this.pending.set(correlationId, {resolve, reject, onStream});
            this.webSocket!.send(pulseEnvelopeSerializer.packEnvelope(envelope));

            setTimeout(() => {
                if (this.pending.has(correlationId)) {
                    this.pending.delete(correlationId);
                    reject(new Error('Request timed out'));
                }
            }, this.options?.requestTimeoutMs ?? 15000);
        });
    }

    async stream<TChunk>(handle: string, chunkGenerator: AsyncIterable<TChunk>, version = 'v1'): Promise<void> {
        const correlationId = _0x5f1a3d.call(this);

        const initEnvelope = new PulseEnvelope<null>();
        initEnvelope.handle = handle;
        initEnvelope.body = null;
        initEnvelope.authToken = this.options?.authToken ?? '';
        initEnvelope.kind = PulseKind.STREAM;
        initEnvelope.version = version;
        initEnvelope.clientCorrelationId = correlationId;

        this.webSocket!.send(pulseEnvelopeSerializer.packEnvelope(initEnvelope));

        for await (const chunk of chunkGenerator) {
            const chunkEnvelope = new PulseEnvelope<TChunk>();
            chunkEnvelope.handle = handle;
            chunkEnvelope.body = chunk;
            chunkEnvelope.authToken = this.options?.authToken ?? '';
            chunkEnvelope.kind = PulseKind.STREAM;
            chunkEnvelope.version = version;
            chunkEnvelope.clientCorrelationId = correlationId;
            chunkEnvelope.isStreamChunk = true;
            chunkEnvelope.endOfStream = false;

            this.webSocket!.send(pulseEnvelopeSerializer.packEnvelope(chunkEnvelope));
        }

        const endOfStreamEnvelope = new PulseEnvelope<null>();
        endOfStreamEnvelope.handle = handle;
        endOfStreamEnvelope.body = null;
        endOfStreamEnvelope.authToken = this.options?.authToken ?? '';
        endOfStreamEnvelope.kind = PulseKind.STREAM;
        endOfStreamEnvelope.version = version;
        endOfStreamEnvelope.clientCorrelationId = correlationId;
        endOfStreamEnvelope.isStreamChunk = true;
        endOfStreamEnvelope.endOfStream = true;

        this.webSocket!.send(pulseEnvelopeSerializer.packEnvelope(endOfStreamEnvelope));
    }

    private handleMessage(frameData: ArrayBuffer | string): void {
        if (typeof frameData === 'string') {
            console.warn('Received non-binary message from server:', frameData);
            return;
        }

        const rawBuffer = new Uint8Array(frameData);
        let decodedEnvelope: PulseEnvelope<any>;

        try {
            decodedEnvelope = pulseEnvelopeSerializer.unpackEnvelope(rawBuffer);
        } catch (error) {
            console.error('Failed to unpack incoming message as PulseEnvelope:', error, rawBuffer);
            return;
        }

        const workbenchListeners: Array<(envelope: PulseEnvelope<any>) => void> =
            (this as any)[WORKBENCH_LISTENERS] ?? [];

        for (const callback of workbenchListeners) callback(decodedEnvelope);

        const correlationId = decodedEnvelope.clientCorrelationId;
        const pendingEntry = correlationId ? this.pending.get(correlationId) : undefined;

        if (pendingEntry && decodedEnvelope.kind === PulseKind.STREAM && decodedEnvelope.isStreamChunk) {
            if (pendingEntry.onStream) {
                pendingEntry.onStream(decodedEnvelope.body);
            }

            if (decodedEnvelope.endOfStream) {
                pendingEntry.resolve(undefined);
                this.pending.delete(correlationId!);
            }

            return;
        }

        if (pendingEntry) {
            pendingEntry.resolve(decodedEnvelope.body);
            this.pending.delete(correlationId!);
            return;
        }

        const subscriberCallbacks = this.handlers.get(decodedEnvelope.handle) ?? [];
        for (const callback of subscriberCallbacks) {
            callback(decodedEnvelope.body);
        }
    }

    private tryReconnect(): void {
        if (this.options.maxReconnectAttempts && this.reconnectAttempts >= this.options.maxReconnectAttempts) {
            return;
        }

        this.reconnectAttempts++;

        const interval = this.options.reconnectIntervalMs || 2000;
        this.reconnectTimer = setTimeout(() => {
            this.connect().catch((err) => {
                this.tryReconnect();
            });
        }, interval);
    }
}

(PulseClient.prototype as any)[WORKBENCH_INTERNAL_INVOKE] =
    function <TRequest>(
        this: PulseClient,
        handle: string,
        payload: TRequest,
        version = 'v1',
    ): PulseEnvelope<TRequest> {

        const correlationId = _0x5f1a3d.call(this);

        const req = new PulseEnvelope<TRequest>();
        req.handle              = handle;
        req.body                = payload;
        req.authToken           = (this as any).options?.authToken ?? '';
        req.kind                = PulseKind.RPC;
        req.version             = version;
        req.clientCorrelationId = correlationId;

        (this as any).webSocket!.send(pulseEnvelopeSerializer.packEnvelope(req));

        return req;               //  ← only the request is returned
    };

(PulseClient.prototype as any)[WORKBENCH_INTERNAL_SEND] =
    function <TPayload>(
        this: PulseClient,
        handle: string,
        payload: TPayload,
        version = 'v1',
    ) {
        const envelope = new PulseEnvelope<TPayload>();
        envelope.handle    = handle;
        envelope.body      = payload;
        envelope.authToken = (this as any)['options']?.authToken ?? '';
        envelope.kind      = PulseKind.EVENT;
        envelope.version   = version;

        (this as any)['webSocket']!.send(
            pulseEnvelopeSerializer.packEnvelope(envelope),
        );

        return envelope;
    };

(PulseClient.prototype as any)[WORKBENCH_INTERNAL_STREAM] =
    async function <TChunk>(
        this: PulseClient,
        handle: string,
        chunkGenerator: AsyncIterable<TChunk>,
        version = 'v1',
    ): Promise<{ correlationId: string; envelopes: PulseEnvelope<any>[] }> {

        const correlationId = _0x5f1a3d.call(this);
        const envelopes: PulseEnvelope<any>[] = [];

        // initial envelope
        const init = new PulseEnvelope<null>();
        init.handle               = handle;
        init.body                 = null;
        init.authToken            = (this as any).options?.authToken ?? '';
        init.kind                 = PulseKind.STREAM;
        init.version              = version;
        init.clientCorrelationId  = correlationId;

        envelopes.push(init);
        (this as any).webSocket!.send(pulseEnvelopeSerializer.packEnvelope(init));

        // every chunk
        for await (const chunk of chunkGenerator) {
            const chunkEnv = new PulseEnvelope<TChunk>();
            chunkEnv.handle              = handle;
            chunkEnv.body                = chunk;
            chunkEnv.authToken           = (this as any).options?.authToken ?? '';
            chunkEnv.kind                = PulseKind.STREAM;
            chunkEnv.version             = version;
            chunkEnv.clientCorrelationId = correlationId;
            chunkEnv.isStreamChunk       = true;
            chunkEnv.endOfStream         = false;

            envelopes.push(chunkEnv);
            (this as any).webSocket!.send(pulseEnvelopeSerializer.packEnvelope(chunkEnv));
        }

        const end = new PulseEnvelope<null>();
        end.handle               = handle;
        end.body                 = null;
        end.authToken            = (this as any).options?.authToken ?? '';
        end.kind                 = PulseKind.STREAM;
        end.version              = version;
        end.clientCorrelationId  = correlationId;
        end.isStreamChunk        = true;
        end.endOfStream          = true;

        envelopes.push(end);
        (this as any).webSocket!.send(pulseEnvelopeSerializer.packEnvelope(end));

        return { correlationId, envelopes };
    };

(PulseClient.prototype as any)[WORKBENCH_INTERNAL_ON] =
    function (this: PulseClient, callback: (envelope: PulseEnvelope<any>) => void) {
        const bucket: Array<(envelope: PulseEnvelope<any>) => void> =
            (this as any)[WORKBENCH_LISTENERS];

        bucket.push(callback);
    };