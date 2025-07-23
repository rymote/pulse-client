import {PulseQueryParameters} from "./pulse-query-parameters.type";

export function getWebSocketConstructor(): typeof WebSocket {
    if (typeof window === 'undefined') {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        return require('ws');
    } else {
        return WebSocket;
    }
}

export function createWebSocket(url: string | URL, queryParameters?: PulseQueryParameters): WebSocket {
    const WebSocketConstructor = getWebSocketConstructor();
    const urlObject = typeof url === 'string' ? new URL(url) : new URL(url.toString());

    if (queryParameters) {
        const keyValuePairs: Array<[string, string]> = [];

        for (const [parameterKey, parameterValue] of Object.entries(queryParameters)) {
            if (Array.isArray(parameterValue)) {
                for (const singleValue of parameterValue) {
                    keyValuePairs.push([parameterKey, String(singleValue)]);
                }
            } else {
                keyValuePairs.push([parameterKey, String(parameterValue)]);
            }
        }

        for (const [parameterKey, parameterStringValue] of keyValuePairs) {
            urlObject.searchParams.append(parameterKey, parameterStringValue);
        }
    }

    return new WebSocketConstructor(urlObject.toString());
}