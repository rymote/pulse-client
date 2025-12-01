import pulseEnvelopeSerializer from './pulse-serializer.class';
import { PulseClientOptions } from './pulse-client-options.interface';
import { PulseKind } from './pulse-kind.enum';
import { PulseEnvelope } from './pulse-envelope.class';

import { EventListener } from './event-listener.type';
import { createWebSocket } from './websocket.wrapper';

const WORKBENCH_INTERNAL_INVOKE = Symbol.for('__WORKBENCH__INTERNAL__INVOKE__');
const WORKBENCH_INTERNAL_SEND = Symbol.for('__WORKBENCH__INTERNAL__SEND__');
const WORKBENCH_INTERNAL_ON = Symbol.for('__WORKBENCH__INTERNAL__ON__');
const WORKBENCH_LISTENERS = Symbol.for('__WORKBENCH__LISTENERS__');

export type PendingEntry<T = any> = {
    resolve: (data: T) => void;
    reject: (error: any) => void;
};

export class PulseClient {
    public messageSequenceNumber = 0;

    private _webSocketConnection: WebSocket | null = null;
    private _pendingRequests = new Map<string, PendingEntry>();
    private _eventHandlers = new Map<string, Array<EventListener>>();
    private _clientOptions: PulseClientOptions;
    private _reconnectAttempts: number = 0;
    private _reconnectTimer: NodeJS.Timeout | null = null;
    private _connected: boolean = false;
    private _onConnectHandlers: Array<() => void> = [];
    private _onDisconnectHandlers: Array<() => void> = [];

    public generateCorrelationId(): string {
        return `${this.messageSequenceNumber++}`;
    }

    constructor(
        private url: string,
        options?: PulseClientOptions,
    ) {
        this._clientOptions = options || {};
        (this as any)[WORKBENCH_LISTENERS] = [];
    }

    get connected(): boolean {
        return this._connected && this._webSocketConnection !== null && this._webSocketConnection.readyState === WebSocket.OPEN;
    }

    async connect(options?: PulseClientOptions): Promise<void> {
        this._clientOptions = options || this._clientOptions;
        this._webSocketConnection = createWebSocket(this.url, this._clientOptions.queryParameters);
        this._webSocketConnection.binaryType = 'arraybuffer';

        return new Promise((resolve, reject) => {
            this._webSocketConnection!.onopen = () => {
                this._connected = true;
                this._reconnectAttempts = 0;
                this.emitConnect();
                resolve();
            };

            this._webSocketConnection!.onclose = () => {
                this._connected = false;
                this.emitDisconnect();
                if (this._clientOptions.autoReconnect) this.tryReconnect();
            };

            this._webSocketConnection!.onmessage = (event) => this.handleMessage(event.data);
            this._webSocketConnection!.onerror = (error) => reject(error);
        });
    }

    public disconnect(code = 1000, reason = 'client disconnect'): void {
        if (this._reconnectTimer) {
            clearTimeout(this._reconnectTimer);
            this._reconnectTimer = null;
        }

        this._reconnectAttempts = 0;

        if (this._webSocketConnection && this._webSocketConnection.readyState <= WebSocket.OPEN) {
            this._webSocketConnection.close(code, reason);
        }

        this._webSocketConnection = null;
        this._connected = false;
        this.emitDisconnect();

        for (const [, entry] of this._pendingRequests) {
            entry.reject(new Error('Client disconnected'));
        }

        this._pendingRequests.clear();
    }

    public onConnect(callback: () => void): void {
        this._onConnectHandlers.push(callback);
    }

    public offConnect(callback: () => void): void {
        const index = this._onConnectHandlers.indexOf(callback);
        if (index !== -1) {
            this._onConnectHandlers.splice(index, 1);
        }
    }

    public onDisconnect(callback: () => void): void {
        this._onDisconnectHandlers.push(callback);
    }

    public offDisconnect(callback: () => void): void {
        const index = this._onDisconnectHandlers.indexOf(callback);
        if (index !== -1) {
            this._onDisconnectHandlers.splice(index, 1);
        }
    }

    private emitConnect(): void {
        for (const handler of this._onConnectHandlers) {
            handler();
        }
    }

    private emitDisconnect(): void {
        for (const handler of this._onDisconnectHandlers) {
            handler();
        }
    }

    public on(handle: string, callback: EventListener): void {
        const list = this._eventHandlers.get(handle) ?? [];
        list.push(callback);
        this._eventHandlers.set(handle, list);
    }

    public off(handle: string, callback: EventListener): void {
        const list = this._eventHandlers.get(handle);
        if (!list) return;
        const index = list.indexOf(callback);
        if (index !== -1) list.splice(index, 1);
    }

    public send<TPayload>(handle: string, payload: TPayload, version = 'v1', authorizationTokenOverride?: string): void {
        const envelope = new PulseEnvelope<TPayload>();
        envelope.handle = handle;
        envelope.body = payload;
        envelope.authToken = authorizationTokenOverride ?? this._clientOptions?.authToken ?? '';
        envelope.kind = PulseKind.EVENT;
        envelope.version = version;
        this._webSocketConnection!.send(pulseEnvelopeSerializer.packEnvelope(envelope));
    }

    public invoke<TRequest, TResponse>(
        handle: string,
        payload: TRequest,
        version = 'v1',
        authorizationTokenOverride?: string,
    ): Promise<TResponse | void> {
        const correlationId = this.generateCorrelationId();
        const envelope = new PulseEnvelope<TRequest>();
        envelope.handle = handle;
        envelope.body = payload;
        envelope.authToken = authorizationTokenOverride ?? this._clientOptions?.authToken ?? '';
        envelope.kind = PulseKind.RPC;
        envelope.version = version;
        envelope.clientCorrelationId = correlationId;

        return new Promise((resolve, reject) => {
            this._pendingRequests.set(correlationId, { resolve, reject });
            this._webSocketConnection!.send(pulseEnvelopeSerializer.packEnvelope(envelope));
            setTimeout(() => {
                if (this._pendingRequests.has(correlationId)) {
                    this._pendingRequests.delete(correlationId);
                    reject(new Error('Request timed out'));
                }
            }, this._clientOptions?.requestTimeoutMs ?? 15000);
        });
    }

    private handleMessage(frameData: ArrayBuffer | string): void {
        if (typeof frameData === 'string') return;

        const rawBuffer = new Uint8Array(frameData);
        let decodedEnvelope: PulseEnvelope<any>;

        try {
            decodedEnvelope = pulseEnvelopeSerializer.unpackEnvelope(rawBuffer);
        } catch {
            return;
        }

        const workbenchListeners: Array<(envelope: PulseEnvelope<any>) => void> = (this as any)[WORKBENCH_LISTENERS] ?? [];
        for (const callback of workbenchListeners) callback(decodedEnvelope);

        const correlationId = decodedEnvelope.clientCorrelationId;
        const pendingEntry = correlationId ? this._pendingRequests.get(correlationId) : undefined;

        if (pendingEntry) {
            pendingEntry.resolve(decodedEnvelope.body);
            this._pendingRequests.delete(correlationId!);
            return;
        }

        for (const [pattern, callbacks] of this._eventHandlers.entries()) {
            const params = this.matchHandle(pattern, decodedEnvelope.handle);

            if (params) {
                for (const callback of callbacks) {
                    callback(decodedEnvelope.body, { params });
                }
            }
        }
    }

    private tryReconnect(): void {
        if (this._clientOptions.maxReconnectAttempts && this._reconnectAttempts >= this._clientOptions.maxReconnectAttempts) {
            return;
        }

        this._reconnectAttempts++;
        const interval = this._clientOptions.reconnectIntervalMs || 2000;
        this._reconnectTimer = setTimeout(() => {
            this.connect().catch(() => {
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
    const correlationId = (this as any).generateCorrelationId();
    const requestEnvelope = new PulseEnvelope<TRequest>();
    requestEnvelope.handle = handle;
    requestEnvelope.body = payload;
    requestEnvelope.authToken = (this as any)._clientOptions?.authToken ?? '';
    requestEnvelope.kind = PulseKind.RPC;
    requestEnvelope.version = version;
    requestEnvelope.clientCorrelationId = correlationId;
    (this as any)['_webSocketConnection']!.send(pulseEnvelopeSerializer.packEnvelope(requestEnvelope));
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
    envelope.authToken = (this as any)['_clientOptions']?.authToken ?? '';
    envelope.kind = PulseKind.EVENT;
    envelope.version = version;
    (this as any)['_webSocketConnection']!.send(pulseEnvelopeSerializer.packEnvelope(envelope));
    return envelope;
};

(PulseClient.prototype as any)[WORKBENCH_INTERNAL_ON] = function (this: PulseClient, callback: (envelope: PulseEnvelope<any>) => void) {
    const bucket: Array<(envelope: PulseEnvelope<any>) => void> = (this as any)[WORKBENCH_LISTENERS];
    bucket.push(callback);
};
