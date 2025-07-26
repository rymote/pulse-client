import pulseEnvelopeSerializer from './pulse-serializer.class';
import { PulseClientOptions } from './pulse-client-options.interface';
import { PulseKind } from './pulse-kind.enum';
import { PulseEnvelope } from './pulse-envelope.class';

import { EventListener } from './event-listener.type';
import {createWebSocket} from "./websocket.wrapper";

const WORKBENCH_INTERNAL_INVOKE = Symbol.for('__WORKBENCH__INTERNAL__INVOKE__');
const WORKBENCH_INTERNAL_SEND = Symbol.for('__WORKBENCH__INTERNAL__SEND__');
const WORKBENCH_INTERNAL_STREAM = Symbol.for('__WORKBENCH__INTERNAL__STREAM__');
const WORKBENCH_INTERNAL_ON = Symbol.for('__WORKBENCH__INTERNAL__ON__');
const WORKBENCH_LISTENERS = Symbol.for('__WORKBENCH__LISTENERS__');

export type PendingEntry<T = any> = {
    resolve: (data: T) => void;
    reject: (error: any) => void;
    onStream?: (chunk: T) => void;
};

export class PulseClient {
    public _0xa1b2c3 = 0;

    private _webSocket: WebSocket | null = null;
    private _pending = new Map<string, PendingEntry>();
    private _handlers = new Map<string, Array<EventListener>>();
    private _options: PulseClientOptions;
    private _reconnectAttempts: number = 0;
    private _reconnectTimer: NodeJS.Timeout | null = null;
    private _connected: boolean = false;
    private _connectHandlers: Array<() => void> = [];
    private _disconnectHandlers: Array<() => void> = [];

    public _0x5f1a3d(): string {
        return `${this._0xa1b2c3++}`;
    }

    constructor(private url: string, options?: PulseClientOptions) {
        this._options = options || {};

        (this as any)[WORKBENCH_LISTENERS] = [];
    }

    get connected(): boolean {
        return this._connected && this._webSocket !== null && this._webSocket.readyState === WebSocket.OPEN;
    }

    async connect(options?: PulseClientOptions): Promise<void> {
        this._options = options || this._options;

        this._webSocket = createWebSocket(this.url, this._options.queryParameters);
        this._webSocket.binaryType = 'arraybuffer';

        return new Promise((resolve, reject) => {
            this._webSocket!.onopen = () => {
                this._connected = true;
                this._reconnectAttempts = 0;
                this.emitConnect();
                resolve();
            }

            this._webSocket!.onclose = () => {
                this._connected = false;
                this.emitDisconnect();

                if (this._options.autoReconnect)
                    this.tryReconnect();
            }

            this._webSocket!.onmessage = (event) => this.handleMessage(event.data);
            this._webSocket!.onerror = (error) => reject(error);
        });
    }

    public disconnect(code = 1000, reason = 'client disconnect'): void {
        if (this._reconnectTimer) {
            clearTimeout(this._reconnectTimer);
            this._reconnectTimer = null;
        }

        this._reconnectAttempts = 0;

        if (this._webSocket && this._webSocket.readyState <= WebSocket.OPEN) {
            this._webSocket.close(code, reason);
        }

        this._webSocket = null;
        this._connected = false;
        this.emitDisconnect();

        for (const [, entry] of this._pending) {
            entry.reject(new Error('Client disconnected'));
        }

        this._pending.clear();
    }

    public onConnect(callback: () => void): void {
        this._connectHandlers.push(callback);
    }

    public offConnect(callback: () => void): void {
        const index = this._connectHandlers.indexOf(callback);
        if (index !== -1) {
            this._connectHandlers.splice(index, 1);
        }
    }

    public onDisconnect(callback: () => void): void {
        this._disconnectHandlers.push(callback);
    }

    public offDisconnect(callback: () => void): void {
        const index = this._disconnectHandlers.indexOf(callback);
        if (index !== -1) {
            this._disconnectHandlers.splice(index, 1);
        }
    }

    private emitConnect(): void {
        for (const handler of this._connectHandlers) {
            handler();
        }
    }

    private emitDisconnect(): void {
        for (const handler of this._disconnectHandlers) {
            handler();
        }
    }

    public on(handle: string, callback: EventListener): void {
        const list = this._handlers.get(handle) ?? [];
        list.push(callback);
        this._handlers.set(handle, list);
    }

    public off(handle: string, callback: EventListener): void {
        const list = this._handlers.get(handle);
        if (!list) return;

        const index = list.indexOf(callback);
        if (index !== -1) list.splice(index, 1);
    }

    public send<TPayload>(handle: string, payload: TPayload, version = 'v1'): void {
        const envelope = new PulseEnvelope<TPayload>();
        envelope.handle = handle;
        envelope.body = payload;
        envelope.authToken = this._options?.authToken ?? '';
        envelope.kind = PulseKind.EVENT;
        envelope.version = version;

        this._webSocket!.send(pulseEnvelopeSerializer.packEnvelope(envelope));
    }

    public invoke<TRequest, TResponse>(
        handle: string,
        payload: TRequest,
        onStream?: (chunk: TResponse) => void,
        version = 'v1',
    ): Promise<TResponse | void> {
        const correlationId = this._0x5f1a3d();
        const kind: PulseKind = onStream ? PulseKind.STREAM : PulseKind.RPC;

        const envelope = new PulseEnvelope<TRequest>();
        envelope.handle = handle;
        envelope.body = payload;
        envelope.authToken = this._options?.authToken ?? '';
        envelope.kind = kind;
        envelope.version = version;
        envelope.clientCorrelationId = correlationId;

        return new Promise((resolve, reject) => {
            this._pending.set(correlationId, { resolve, reject, onStream });
            this._webSocket!.send(pulseEnvelopeSerializer.packEnvelope(envelope));

            setTimeout(() => {
                if (this._pending.has(correlationId)) {
                    this._pending.delete(correlationId);
                    reject(new Error('Request timed out'));
                }
            }, this._options?.requestTimeoutMs ?? 15000);
        });
    }

    public async stream<TChunk>(handle: string, chunkGenerator: AsyncIterable<TChunk>, version = 'v1'): Promise<void> {
        const correlationId = this._0x5f1a3d();

        const initialEnvelope = new PulseEnvelope<null>();
        initialEnvelope.handle = handle;
        initialEnvelope.body = null;
        initialEnvelope.authToken = this._options?.authToken ?? '';
        initialEnvelope.kind = PulseKind.STREAM;
        initialEnvelope.version = version;
        initialEnvelope.clientCorrelationId = correlationId;

        this._webSocket!.send(pulseEnvelopeSerializer.packEnvelope(initialEnvelope));

        for await (const chunk of chunkGenerator) {
            const chunkEnvelope = new PulseEnvelope<TChunk>();
            chunkEnvelope.handle = handle;
            chunkEnvelope.body = chunk;
            chunkEnvelope.authToken = this._options?.authToken ?? '';
            chunkEnvelope.kind = PulseKind.STREAM;
            chunkEnvelope.version = version;
            chunkEnvelope.clientCorrelationId = correlationId;
            chunkEnvelope.isStreamChunk = true;
            chunkEnvelope.endOfStream = false;

            this._webSocket!.send(pulseEnvelopeSerializer.packEnvelope(chunkEnvelope));
        }

        const endOfStreamEnvelope = new PulseEnvelope<null>();
        endOfStreamEnvelope.handle = handle;
        endOfStreamEnvelope.body = null;
        endOfStreamEnvelope.authToken = this._options?.authToken ?? '';
        endOfStreamEnvelope.kind = PulseKind.STREAM;
        endOfStreamEnvelope.version = version;
        endOfStreamEnvelope.clientCorrelationId = correlationId;
        endOfStreamEnvelope.isStreamChunk = true;
        endOfStreamEnvelope.endOfStream = true;

        this._webSocket!.send(pulseEnvelopeSerializer.packEnvelope(endOfStreamEnvelope));
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

        const workbenchListeners: Array<(envelope: PulseEnvelope<any>) => void> = (this as any)[WORKBENCH_LISTENERS] ?? [];

        for (const callback of workbenchListeners) callback(decodedEnvelope);

        const correlationId = decodedEnvelope.clientCorrelationId;
        const pendingEntry = correlationId ? this._pending.get(correlationId) : undefined;

        if (pendingEntry && decodedEnvelope.kind === PulseKind.STREAM && decodedEnvelope.isStreamChunk) {
            if (pendingEntry.onStream) {
                pendingEntry.onStream(decodedEnvelope.body);
            }

            if (decodedEnvelope.endOfStream) {
                pendingEntry.resolve(undefined);
                this._pending.delete(correlationId!);
            }

            return;
        }

        if (pendingEntry) {
            pendingEntry.resolve(decodedEnvelope.body);
            this._pending.delete(correlationId!);
            return;
        }

        for (const [pattern, callbacks] of this._handlers.entries()) {
            const params = this.matchHandle(pattern, decodedEnvelope.handle);
            if (params) {
                for (const callback of callbacks) {
                    callback(decodedEnvelope.body, { params });
                }
            }
        }
    }

    private tryReconnect(): void {
        if (this._options.maxReconnectAttempts && this._reconnectAttempts >= this._options.maxReconnectAttempts) {
            return;
        }

        this._reconnectAttempts++;

        const interval = this._options.reconnectIntervalMs || 2000;
        this._reconnectTimer = setTimeout(() => {
            this.connect().catch((err) => {
                this.tryReconnect();
            });
        }, interval);
    }

    private matchHandle(pattern: string, handle: string): { [key: string]: string } | null {
        const patternParts = pattern.split('/');
        const handleParts = handle.split('/');

        if (patternParts.length !== handleParts.length) {
            return null;
        }

        const params: { [key: string]: string } = {};

        for (let index = 0; index < patternParts.length; index++) {
            const patternPart = patternParts[index];
            const handlePart = handleParts[index];

            if (patternPart.startsWith('{') && patternPart.endsWith('}')) {
                const paramName = patternPart.slice(1, -1);
                params[paramName] = handlePart;
            } else if (patternPart !== handlePart) {
                return null;
            }
        }

        return params;
    }
}

(PulseClient.prototype as any)[WORKBENCH_INTERNAL_INVOKE] = function <TRequest>(
    this: PulseClient,
    handle: string,
    payload: TRequest,
    version = 'v1',
): PulseEnvelope<TRequest> {
    const correlationId = this._0x5f1a3d();

    const requestEnvelope = new PulseEnvelope<TRequest>();
    requestEnvelope.handle = handle;
    requestEnvelope.body = payload;
    requestEnvelope.authToken = (this as any).options?.authToken ?? '';
    requestEnvelope.kind = PulseKind.RPC;
    requestEnvelope.version = version;
    requestEnvelope.clientCorrelationId = correlationId;

    (this as any)['_webSocket']!.send(pulseEnvelopeSerializer.packEnvelope(requestEnvelope));

    return requestEnvelope;
};

(PulseClient.prototype as any)[WORKBENCH_INTERNAL_SEND] = function <TPayload>(
    this: PulseClient,
    handle: string,
    payload: TPayload,
    version = 'v1',
) {
    const envelope = new PulseEnvelope<TPayload>();
    envelope.handle = handle;
    envelope.body = payload;
    envelope.authToken = (this as any)['options']?.authToken ?? '';
    envelope.kind = PulseKind.EVENT;
    envelope.version = version;

    (this as any)['_webSocket']!.send(pulseEnvelopeSerializer.packEnvelope(envelope));

    return envelope;
};

(PulseClient.prototype as any)[WORKBENCH_INTERNAL_STREAM] = async function <TChunk>(
    this: PulseClient,
    handle: string,
    chunkGenerator: AsyncIterable<TChunk>,
    version = 'v1',
): Promise<{ correlationId: string; envelopes: PulseEnvelope<any>[] }> {
    const correlationId = this._0x5f1a3d();
    const envelopes: PulseEnvelope<any>[] = [];

    const initialEnvelope = new PulseEnvelope<null>();
    initialEnvelope.handle = handle;
    initialEnvelope.body = null;
    initialEnvelope.authToken = (this as any).options?.authToken ?? '';
    initialEnvelope.kind = PulseKind.STREAM;
    initialEnvelope.version = version;
    initialEnvelope.clientCorrelationId = correlationId;

    envelopes.push(initialEnvelope);
    (this as any)['_webSocket']!.send(pulseEnvelopeSerializer.packEnvelope(initialEnvelope));

    for await (const chunk of chunkGenerator) {
        const chunkEnvelope = new PulseEnvelope<TChunk>();
        chunkEnvelope.handle = handle;
        chunkEnvelope.body = chunk;
        chunkEnvelope.authToken = (this as any).options?.authToken ?? '';
        chunkEnvelope.kind = PulseKind.STREAM;
        chunkEnvelope.version = version;
        chunkEnvelope.clientCorrelationId = correlationId;
        chunkEnvelope.isStreamChunk = true;
        chunkEnvelope.endOfStream = false;

        envelopes.push(chunkEnvelope);
        (this as any)['_webSocket']!.send(pulseEnvelopeSerializer.packEnvelope(chunkEnvelope));
    }

    const endEnvelope = new PulseEnvelope<null>();
    endEnvelope.handle = handle;
    endEnvelope.body = null;
    endEnvelope.authToken = (this as any).options?.authToken ?? '';
    endEnvelope.kind = PulseKind.STREAM;
    endEnvelope.version = version;
    endEnvelope.clientCorrelationId = correlationId;
    endEnvelope.isStreamChunk = true;
    endEnvelope.endOfStream = true;

    envelopes.push(endEnvelope);
    (this as any)['_webSocket']!.send(pulseEnvelopeSerializer.packEnvelope(endEnvelope));

    return { correlationId, envelopes };
};

(PulseClient.prototype as any)[WORKBENCH_INTERNAL_ON] = function (this: PulseClient, callback: (envelope: PulseEnvelope<any>) => void) {
    const bucket: Array<(envelope: PulseEnvelope<any>) => void> = (this as any)[WORKBENCH_LISTENERS];

    bucket.push(callback);
};


