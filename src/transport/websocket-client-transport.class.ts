import { DEFAULT_MULTIPLEXER_OPTIONS, MultiplexerOptions } from '../multiplexer/multiplexer-options.interface.js';
import { PulseStreamMultiplexer } from '../multiplexer/pulse-stream-multiplexer.class.js';
import { IPulseClientTransport } from './pulse-client-transport.interface.js';
import { IPulseSession } from './pulse-session.interface.js';
import { WebSocketByteChannel } from './websocket-byte-channel.class.js';
import { createWebSocket } from '../websocket.wrapper.js';

export interface WebSocketClientTransportOptions extends MultiplexerOptions {
    connectTimeoutMs: number;
}

const DEFAULT_WEBSOCKET_TRANSPORT_OPTIONS: WebSocketClientTransportOptions = {
    ...DEFAULT_MULTIPLEXER_OPTIONS,
    connectTimeoutMs: 5000,
};

export class WebSocketClientTransport implements IPulseClientTransport {
    public readonly name = 'websocket';

    private readonly options: WebSocketClientTransportOptions;

    constructor(options?: Partial<WebSocketClientTransportOptions>) {
        this.options = { ...DEFAULT_WEBSOCKET_TRANSPORT_OPTIONS, ...options };
    }

    public async connect(
        endpoint: URL,
        authToken: string | undefined,
        queryParameters: Readonly<Record<string, string>> | undefined,
        abortSignal: AbortSignal,
    ): Promise<IPulseSession> {
        const webSocketUrl = this.buildWebSocketUrl(endpoint, queryParameters);
        const webSocket = createWebSocket(webSocketUrl);

        await this.waitForOpen(webSocket, abortSignal);

        const byteChannel = new WebSocketByteChannel(webSocket);
        const multiplexer = new PulseStreamMultiplexer(
            byteChannel,
            false,
            'websocket',
            this.options,
            queryParameters,
            { webSocket },
        );

        multiplexer.start();
        return multiplexer;
    }

    private buildWebSocketUrl(
        endpoint: URL,
        queryParameters: Readonly<Record<string, string>> | undefined,
    ): URL {
        const url = new URL(endpoint.toString());
        if (url.protocol === 'http:') url.protocol = 'ws:';
        else if (url.protocol === 'https:') url.protocol = 'wss:';

        if (queryParameters) {
            for (const [key, value] of Object.entries(queryParameters)) {
                url.searchParams.set(key, value);
            }
        }

        return url;
    }

    private async waitForOpen(webSocket: WebSocket, abortSignal: AbortSignal): Promise<void> {
        if (webSocket.readyState === WebSocket.OPEN) return;

        return new Promise<void>((resolve, reject) => {
            const cleanup = (): void => {
                webSocket.removeEventListener('open', onOpen);
                webSocket.removeEventListener('error', onError);
                abortSignal.removeEventListener('abort', onAbort);
                clearTimeout(timeoutHandle);
            };

            const onOpen = (): void => {
                cleanup();
                resolve();
            };
            const onError = (event: Event): void => {
                cleanup();
                reject(new Error(`WebSocket connect failed: ${event.type}`));
            };
            const onAbort = (): void => {
                cleanup();
                try { webSocket.close(); } catch { /* ignore */ }
                reject(new DOMException('Aborted', 'AbortError'));
            };

            const timeoutHandle = setTimeout(() => {
                cleanup();
                try { webSocket.close(); } catch { /* ignore */ }
                reject(new Error(`WebSocket connect timed out after ${this.options.connectTimeoutMs}ms`));
            }, this.options.connectTimeoutMs);

            webSocket.addEventListener('open', onOpen, { once: true });
            webSocket.addEventListener('error', onError, { once: true });
            if (abortSignal.aborted) onAbort();
            else abortSignal.addEventListener('abort', onAbort, { once: true });
        });
    }
}
