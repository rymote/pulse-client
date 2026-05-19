<div align="center">
    <a href="https://github.com/rymote/pulse-client"><img src="https://github.com/rymote/pulse-client/blob/master/.github/rymote-pulse-client-cover.png" alt="rymote/pulse-client" /></a>
</div>
<br />

<div align="center">
  @rymote/pulse-client — TypeScript client library for Rymote.Pulse v3
</div>

<div align="center">
  <sub>
    Brought to you by
    <a href="https://github.com/jovanivanovic">@jovanivanovic</a>,
    <a href="https://github.com/rymote">@rymote</a>
  </sub>
</div>

## Overview

`@rymote/pulse-client` is the TypeScript client for [Rymote.Pulse v3](https://github.com/rymote/pulse-server). v3 introduces a stream-per-RPC protocol: each RPC owns its own bidirectional stream, events use unidirectional streams, and the client multiplexes many concurrent streams over a single transport. The library ships with a WebSocket transport that runs in browsers and Node, and a pluggable `IPulseClientTransport` contract for custom transports.

## Features

- **Stream-per-RPC** — each `invoke()` opens its own virtual stream; no more correlation-id matching.
- **Server streaming** — `invokeStream()` returns an `AsyncIterable<TResponse>` backed by a bidirectional stream.
- **Fire-and-forget events** — `send()` over a uni stream (reliable) or, on transports that support it, over the datagram channel (lossy).
- **Pluggable transports** — register one or more `IPulseClientTransport` implementations; the client tries them in order on `connect()`.
- **WebSocket built in** — runs natively in browsers and in Node (via `ws`).
- **Auto-reconnect** — exponential backoff with `onConnect` / `onDisconnect` hooks.
- **Authenticated encryption** — MessagePack envelopes wrapped in ChaCha20-Poly1305 AEAD, matching the server wire byte-for-byte.
- **TypeScript-first** — every public symbol ships with type definitions; ESM-only module output.

## Installation

```bash
npm install @rymote/pulse-client
# or
yarn add @rymote/pulse-client
```

## Quick start

```typescript
import { PulseClient, WebSocketClientTransport } from '@rymote/pulse-client';

const client = new PulseClient({
    endpoint: 'wss://api.example.com/pulse',
    transports: [new WebSocketClientTransport()],
    authToken: 'session-token',
    autoReconnect: true,
});

await client.connect();

// RPC (request/response)
const response = await client.invoke<CalculateRequest, CalculateResponse>(
    'calculator.add',
    { a: 2, b: 3 },
);
console.log(response.result);

// Server streaming
for await (const update of client.invokeStream<PriceSubscription, PriceUpdate>(
    'prices.subscribe',
    { symbol: 'AAPL' },
)) {
    console.log(update.symbol, update.price);
}

// Listen for server-pushed events
client.on<NotificationEvent>('user.notification', (event) => {
    console.log(event.message);
});

// Fire-and-forget
await client.send('analytics.track', { action: 'page_view' });
```

## Communication patterns

### RPC (request/response)

```typescript
const user = await client.invoke<GetUserRequest, UserResponse>('users.get', { userId: 'u-42' });
```

### Server streaming

```typescript
for await (const update of client.invokeStream<Subscription, PriceUpdate>('prices.subscribe', { symbol: 'AAPL' })) {
    console.log(update);
}
```

### Server-pushed events

```typescript
client.on<NotificationEvent>('user.notification', (notification, context) => {
    console.log(notification.message);
    console.log('via transport:', context.transportName);
});
```

Handlers can also use brace-style route parameters:

```typescript
client.on<UserPresenceEvent>('users.{userId}.presence', (event, context) => {
    console.log(`user ${context.parameters.userId} is ${event.state}`);
});
```

### Fire-and-forget

```typescript
// Reliable (default) — sent over a unidirectional stream
await client.send('analytics.track', { action: 'click', target: 'cta' });

// Lossy datagram — only succeeds if the active transport exposes a datagram channel
await client.send('user.cursor', { x: 123, y: 456 }, 'v1', 'datagram');
```

## Transport fallback

Register multiple transports in priority order. `connect()` tries each one; the first to succeed becomes the active transport.

```typescript
import { PulseClient, WebSocketClientTransport } from '@rymote/pulse-client';

const client = new PulseClient({
    endpoint: 'wss://api.example.com/pulse',
    transports: [
        // Try other transports first (e.g. a custom WebTransport implementation)
        // ...
        new WebSocketClientTransport(),
    ],
});
```

Any class that implements `IPulseClientTransport` can be plugged in.

## Connection lifecycle

```typescript
client.onConnect(() => console.log('connected via', client.activeTransportName));
client.onDisconnect(() => console.log('disconnected'));

await client.connect();
await client.disconnect();
```

When `autoReconnect: true` (the default), the client retries with exponential backoff after an unexpected close. Each successful (re)connection fires `onConnect`; each close fires `onDisconnect`. Set `autoReconnect: false` to opt out.

## Options

`PulseClientOptions` controls connection, transport, and reconnect behaviour:

| Option | Type | Description |
|---|---|---|
| `endpoint` | `string \| URL` | Server endpoint. `http(s)://` is normalised to `ws(s)://` for the WebSocket transport. |
| `transports` | `IPulseClientTransport[]` | Ordered list of transports to try on `connect()`. Required, at least one entry. |
| `authToken` | `string` | Bearer token sent with each envelope's `authToken` field. |
| `queryParameters` | `PulseQueryParameters` | Key/value map appended to the connection URL. |
| `autoReconnect` | `boolean` | Reconnect after unexpected close (default `true`). |
| `reconnectInitialDelayMs` | `number` | Initial reconnect delay (default `1000`). |
| `reconnectMaxDelayMs` | `number` | Maximum reconnect delay (default `30000`). |
| `maxReconnectAttempts` | `number` | Cap on reconnect attempts; unset = unlimited. |
| `connectTimeoutMs` | `number` | Per-transport connect timeout (default `5000`). |
| `requestTimeoutMs` | `number` | Per-RPC response timeout (default `15000`). |

## API surface

| Member | Description |
|---|---|
| `new PulseClient(options)` | Construct a client bound to `options.endpoint` with `options.transports`. |
| `connect()` | Try each transport in order until one succeeds. Throws `PulseConnectError` if all fail. |
| `disconnect()` | Close the active session and stop auto-reconnect. |
| `connected` | `true` when an active session is open. |
| `activeTransportName` | Name of the currently active transport (`"websocket"`, etc.) or `null`. |
| `invoke<TRequest, TResponse>(handle, payload, version?, authOverride?)` | Send an RPC over a fresh bidi stream and await the response. |
| `invokeStream<TRequest, TResponse>(handle, payload, version?, authOverride?)` | Open a server-streaming RPC; returns an `AsyncIterableIterator<TResponse>`. |
| `send<TPayload>(handle, payload, version?, deliveryMode?, authOverride?)` | Fire-and-forget. `deliveryMode = 'datagram'` uses the lossy channel if available. |
| `on<TEvent>(handlePattern, handler)` | Register a server-pushed event handler. Pattern supports `{name}` placeholders. |
| `off<TEvent>(handlePattern, handler)` | Remove a previously registered handler. |
| `onConnect(handler)` / `offConnect(handler)` | Connection lifecycle hooks. |
| `onDisconnect(handler)` / `offDisconnect(handler)` | Connection lifecycle hooks. |

## v2 → v3 migration

v3 is a **hard cut**. The wire format is incompatible with v2 — clients and servers must upgrade together. Key changes for TypeScript callers:

- Constructor now takes an options object: `new PulseClient({ endpoint, transports, ... })` instead of `new PulseClient(url, options?)`.
- `transports: IPulseClientTransport[]` is required — pass `[new WebSocketClientTransport()]` for the v2-equivalent setup.
- `pulse.stream(...)` → `pulse.invokeStream(...)`, returning an `AsyncIterableIterator` instead of an `AsyncIterable`.
- `pulse.send(handle, payload, version?, deliveryMode?, authOverride?)` adds the `deliveryMode` parameter.
- `pulse.on(handle, listener)` listener signature changed: `(body, context) => void | Promise<void>` where `context` is a `PulseClientEventContext` with `handle`, `parameters`, `untypedEnvelope`, and `transportName`.
- `pulse.disconnect()` no longer takes `code`/`reason` arguments — it closes the active session.
- `reconnectIntervalMs` is replaced by `reconnectInitialDelayMs` + `reconnectMaxDelayMs` (exponential backoff).

## Support the project

If `@rymote/pulse-client` has helped you ship faster, please consider supporting ongoing development:

- [Patreon](https://www.patreon.com/rymote)
- [Open Collective](https://opencollective.com/rymote)

## License

BSD 3-Clause License — see [LICENSE.md](./LICENSE.md) for details.

## Support

- Issues: [GitHub Issues](https://github.com/rymote/pulse-client/issues)
- Discussions: [GitHub Discussions](https://github.com/rymote/pulse-client/discussions)
