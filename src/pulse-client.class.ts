import pulseSerializer from './pulse-serializer.class.js';
import { IPulseClientTransport } from './transport/pulse-client-transport.interface.js';
import { IPulseSession } from './transport/pulse-session.interface.js';
import { PulseClientEventHandler } from './pulse-client-event-handler.type.js';
import { PulseClientEventHandlerRegistry } from './pulse-client-event-handler-registry.class.js';
import { PulseClientOptions } from './pulse-client-options.interface.js';
import { PulseClientSessionPipeline } from './pulse-client-session-pipeline.class.js';
import { PulseConnectError } from './pulse-connect-error.class.js';
import { PulseEnvelope } from './pulse-envelope.class.js';
import { PulseKind } from './pulse-kind.enum.js';
import { PulseQueryParameters } from './pulse-query-parameters.type.js';
import { PulseStatus } from './pulse-status.enum.js';
import { PulseStreamDirection } from './transport/pulse-stream-direction.enum.js';
import { PulseStreamResetError } from './transport/pulse-stream-reset-error.class.js';

export type DeliveryMode = 'reliable' | 'datagram';

export class PulseClient {
    private readonly options: PulseClientOptions;
    private readonly eventHandlerRegistry = new PulseClientEventHandlerRegistry();
    private readonly onConnectHandlers: Array<() => void> = [];
    private readonly onDisconnectHandlers: Array<() => void> = [];

    private session: IPulseSession | null = null;
    private activeTransport: IPulseClientTransport | null = null;
    private sessionAbortController: AbortController | null = null;
    private sessionPipelinePromise: Promise<void> | null = null;
    private reconnectAttempts = 0;
    private explicitlyDisconnected = false;

    constructor(options: PulseClientOptions) {
        if (!options.transports || options.transports.length === 0) {
            throw new Error('PulseClient requires at least one transport in options.transports.');
        }
        this.options = options;
    }

    public get connected(): boolean {
        return this.session !== null && this.session.isOpen;
    }

    public get activeTransportName(): string | null {
        return this.activeTransport?.name ?? null;
    }

    public async connect(): Promise<void> {
        this.explicitlyDisconnected = false;
        await this.connectInternal();
    }

    private async connectInternal(): Promise<void> {
        const endpoint = this.normaliseEndpoint();
        const queryParameters = this.flattenQueryParameters(this.options.queryParameters);
        const failures: Array<{ transportName: string; error: unknown }> = [];

        for (const transport of this.options.transports) {
            const connectAbortController = new AbortController();
            const connectTimeoutMs = this.options.connectTimeoutMs ?? 5000;
            const timeoutHandle = setTimeout(() => connectAbortController.abort(), connectTimeoutMs);

            try {
                const newSession = await transport.connect(
                    endpoint,
                    this.options.authToken,
                    queryParameters,
                    connectAbortController.signal,
                );
                clearTimeout(timeoutHandle);

                this.session = newSession;
                this.activeTransport = transport;
                this.sessionAbortController = new AbortController();
                this.sessionPipelinePromise = this.runSessionLoop(newSession, this.sessionAbortController.signal);

                this.reconnectAttempts = 0;
                this.emitConnect();
                return;
            } catch (transportError) {
                clearTimeout(timeoutHandle);
                failures.push({ transportName: transport.name, error: transportError });
            }
        }

        throw new PulseConnectError('All Pulse client transports failed to connect.', failures);
    }

    public async disconnect(): Promise<void> {
        this.explicitlyDisconnected = true;
        this.sessionAbortController?.abort();

        if (this.session !== null) {
            try {
                await this.session.close(1000, 0);
            } catch {
                // best-effort
            }
            try {
                await this.session.dispose();
            } catch {
                // best-effort
            }
        }

        if (this.sessionPipelinePromise !== null) {
            try { await this.sessionPipelinePromise; }
            catch { /* shutdown */ }
        }

        this.session = null;
        this.activeTransport = null;
        this.sessionAbortController = null;
        this.sessionPipelinePromise = null;
        this.emitDisconnect();
    }

    public onConnect(handler: () => void): void {
        this.onConnectHandlers.push(handler);
    }

    public offConnect(handler: () => void): void {
        const index = this.onConnectHandlers.indexOf(handler);
        if (index >= 0) this.onConnectHandlers.splice(index, 1);
    }

    public onDisconnect(handler: () => void): void {
        this.onDisconnectHandlers.push(handler);
    }

    public offDisconnect(handler: () => void): void {
        const index = this.onDisconnectHandlers.indexOf(handler);
        if (index >= 0) this.onDisconnectHandlers.splice(index, 1);
    }

    public on<TEvent>(handlePattern: string, handler: PulseClientEventHandler<TEvent>): void {
        this.eventHandlerRegistry.register(handlePattern, handler);
    }

    public off<TEvent>(handlePattern: string, handler: PulseClientEventHandler<TEvent>): void {
        this.eventHandlerRegistry.unregister(handlePattern, handler as PulseClientEventHandler<unknown>);
    }

    public async invoke<TRequest, TResponse>(
        handle: string,
        payload: TRequest,
        version = 'v1',
        authorizationTokenOverride?: string,
    ): Promise<TResponse> {
        const session = this.requireSession();

        const requestEnvelope = new PulseEnvelope<TRequest>();
        requestEnvelope.id = crypto.randomUUID();
        requestEnvelope.handle = handle;
        requestEnvelope.body = payload;
        requestEnvelope.authToken = authorizationTokenOverride ?? this.options.authToken;
        requestEnvelope.kind = PulseKind.RPC;
        requestEnvelope.version = version;

        const requestBytes = pulseSerializer.packEnvelope(requestEnvelope);
        const stream = await session.openStream(PulseStreamDirection.Bidirectional);

        try {
            await stream.writeEnvelope(requestBytes);
            await stream.completeWrites();

            const requestTimeoutMs = this.options.requestTimeoutMs ?? 15000;
            const requestAbortController = new AbortController();
            const timeoutHandle = setTimeout(() => requestAbortController.abort(), requestTimeoutMs);

            try {
                const responseBytes = await stream.readEnvelope(requestAbortController.signal);
                if (responseBytes === null) {
                    throw new Error(`RPC '${handle}' closed without sending a response.`);
                }
                const responseEnvelope = pulseSerializer.unpackEnvelope<TResponse>(responseBytes);

                if (responseEnvelope.status !== undefined && responseEnvelope.status !== PulseStatus.OK) {
                    throw new Error(responseEnvelope.error ?? `RPC '${handle}' failed with status ${responseEnvelope.status}.`);
                }

                return responseEnvelope.body;
            } finally {
                clearTimeout(timeoutHandle);
            }
        } finally {
            await stream.dispose();
        }
    }

    public async *invokeStream<TRequest, TResponse>(
        handle: string,
        payload: TRequest,
        version = 'v1',
        authorizationTokenOverride?: string,
    ): AsyncIterableIterator<TResponse> {
        const session = this.requireSession();

        const requestEnvelope = new PulseEnvelope<TRequest>();
        requestEnvelope.id = crypto.randomUUID();
        requestEnvelope.handle = handle;
        requestEnvelope.body = payload;
        requestEnvelope.authToken = authorizationTokenOverride ?? this.options.authToken;
        requestEnvelope.kind = PulseKind.RPC_STREAM;
        requestEnvelope.version = version;

        const requestBytes = pulseSerializer.packEnvelope(requestEnvelope);
        const stream = await session.openStream(PulseStreamDirection.Bidirectional);

        try {
            await stream.writeEnvelope(requestBytes);
            await stream.completeWrites();

            while (true) {
                let envelopeBytes: Uint8Array | null;
                try {
                    envelopeBytes = await stream.readEnvelope();
                } catch (error) {
                    if (error instanceof PulseStreamResetError) return;
                    throw error;
                }
                if (envelopeBytes === null) return;

                const responseEnvelope = pulseSerializer.unpackEnvelope<TResponse>(envelopeBytes);
                if (responseEnvelope.status !== undefined && responseEnvelope.status !== PulseStatus.OK) {
                    throw new Error(responseEnvelope.error ?? `RPC stream '${handle}' failed with status ${responseEnvelope.status}.`);
                }

                yield responseEnvelope.body;
            }
        } finally {
            await stream.dispose();
        }
    }

    public async send<TPayload>(
        handle: string,
        payload: TPayload,
        version = 'v1',
        deliveryMode: DeliveryMode = 'reliable',
        authorizationTokenOverride?: string,
    ): Promise<void> {
        const session = this.requireSession();

        const envelope = new PulseEnvelope<TPayload>();
        envelope.id = crypto.randomUUID();
        envelope.handle = handle;
        envelope.body = payload;
        envelope.authToken = authorizationTokenOverride ?? this.options.authToken;
        envelope.kind = deliveryMode === 'datagram' ? PulseKind.DATAGRAM_EVENT : PulseKind.EVENT;
        envelope.version = version;

        const envelopeBytes = pulseSerializer.packEnvelope(envelope);

        if (deliveryMode === 'datagram') {
            if (session.datagrams === null) {
                throw new Error(`Transport '${session.transportName}' does not support datagrams.`);
            }
            await session.datagrams.sendDatagram(envelopeBytes);
            return;
        }

        const stream = await session.openStream(PulseStreamDirection.UnidirectionalClientToServer);
        try {
            await stream.writeEnvelope(envelopeBytes);
            await stream.completeWrites();
        } finally {
            await stream.dispose();
        }
    }

    private async runSessionLoop(session: IPulseSession, abortSignal: AbortSignal): Promise<void> {
        try {
            await PulseClientSessionPipeline.run(session, this.eventHandlerRegistry, abortSignal);
        } catch {
            // session ended — fall through to reconnect path
        }

        if (this.explicitlyDisconnected) return;
        if (this.options.autoReconnect === false) return;

        void this.scheduleReconnect();
    }

    private async scheduleReconnect(): Promise<void> {
        const maxAttempts = this.options.maxReconnectAttempts;
        if (maxAttempts !== undefined && this.reconnectAttempts >= maxAttempts) return;

        const initialDelay = this.options.reconnectInitialDelayMs ?? 1000;
        const maxDelay = this.options.reconnectMaxDelayMs ?? 30000;
        const delay = Math.min(initialDelay * Math.pow(2, this.reconnectAttempts), maxDelay);
        this.reconnectAttempts++;

        this.emitDisconnect();
        this.session = null;
        this.activeTransport = null;

        await new Promise((resolve) => setTimeout(resolve, delay));
        if (this.explicitlyDisconnected) return;

        try {
            await this.connectInternal();
        } catch {
            void this.scheduleReconnect();
        }
    }

    private requireSession(): IPulseSession {
        if (this.session === null || !this.session.isOpen) {
            throw new Error('Pulse client is not connected. Call connect() first.');
        }
        return this.session;
    }

    private normaliseEndpoint(): URL {
        if (this.options.endpoint instanceof URL) return this.options.endpoint;
        return new URL(this.options.endpoint);
    }

    private flattenQueryParameters(
        queryParameters: PulseQueryParameters | undefined,
    ): Record<string, string> | undefined {
        if (!queryParameters) return undefined;
        const flattened: Record<string, string> = {};
        for (const [key, value] of Object.entries(queryParameters)) {
            if (Array.isArray(value)) {
                flattened[key] = value.map(String).join(',');
            } else {
                flattened[key] = String(value);
            }
        }
        return flattened;
    }

    private emitConnect(): void {
        for (const handler of this.onConnectHandlers) {
            try { handler(); } catch { /* isolate */ }
        }
    }

    private emitDisconnect(): void {
        for (const handler of this.onDisconnectHandlers) {
            try { handler(); } catch { /* isolate */ }
        }
    }
}
