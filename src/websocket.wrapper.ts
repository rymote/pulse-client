export function getWebSocketConstructor(): typeof WebSocket {
    if (typeof window === 'undefined') {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        return require('ws');
    } else {
        return WebSocket;
    }
}
