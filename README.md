<div align="center">
    <a href="https://github.com/rymote/pulse-client"><img src="https://github.com/rymote/pulse-client/blob/master/.github/rymote-pulse-client-cover.png" alt="rymote/pulse-client" /></a>
</div>
<br />

<div align="center">
  @rymote/pulse-client - TypeScript client library for Rymote.Pulse
</div>

<div align="center">
  <sub>
    Brought to you by
    <a href="https://github.com/jovanivanovic">@jovanivanovic</a>,
    <a href="https://github.com/rymote">@rymote</a>
  </sub>
</div>

## Overview

`@rymote/pulse-client` is the TypeScript client library for [Rymote.Pulse](https://github.com/rymote/pulse-server), a high-performance real-time messaging framework for .NET. It wraps a native `WebSocket` connection with MessagePack-framed envelopes, correlation-id matching, automatic reconnect, and a strongly-typed API for RPC, streaming, and event-driven patterns.

## Features

- **WebSocket transport** — built on top of the platform `WebSocket` API; runs in browsers, Node.js (via `ws`), and Edge runtimes.
- **MessagePack envelopes** — compact binary frames produced by `msgpackr` with correlation-id matching for in-flight requests.
- **Multiple communication patterns** — RPC (request/response), client streaming, server streaming, fire-and-forget events.
- **Auto-reconnect** — configurable backoff with hook callbacks for `onConnect` / `onDisconnect`.
- **Typed event listeners** — register handlers for named events with the original payload type preserved end-to-end.
- **Query-parameter authentication** — pass tokens and tenant hints through the WebSocket upgrade query string.
- **TypeScript-first** — every public symbol ships with type definitions; ESM-only module output.

## Installation

```bash
npm install @rymote/pulse-client
# or
yarn add @rymote/pulse-client
```

## Quick start

```typescript
import { PulseClient } from '@rymote/pulse-client';

const pulse = new PulseClient('wss://api.example.com/pulse', {
    autoReconnect: true,
    queryParameters: { token: 'session-token' },
});

await pulse.connect();

// RPC (request/response)
const response = await pulse.invoke<CalculateResponse>('calculator.add', {
    a: 2,
    b: 3,
});
console.log(response.result);

// Event listener
pulse.on<NotificationEvent>('user.notification', (event) => {
    console.log(event.message);
});

// Fire-and-forget event
await pulse.send('analytics.track', { action: 'page_view' });
```

## Communication patterns

### RPC (request/response)

```typescript
const user = await pulse.invoke<UserResponse>('users.get', { userId: 'u-42' });
```

### Server streaming

```typescript
const stream = pulse.stream<PriceUpdate>('prices.subscribe', { symbol: 'AAPL' });
for await (const update of stream) {
    console.log(update.symbol, update.price);
}
```

### Event listener

```typescript
const disposeListener = pulse.on<NotificationEvent>('user.notification', (event) => {
    showToast(event.message);
});

// Later
disposeListener();
```

### Fire-and-forget

```typescript
await pulse.send('analytics.track', { action: 'click', target: 'cta' });
```

## Connection lifecycle

```typescript
pulse.onConnect(() => console.log('connected'));
pulse.onDisconnect(() => console.log('disconnected'));

await pulse.connect();

// Force a clean shutdown
pulse.disconnect();
```

When `autoReconnect: true`, the client retries with backoff after an unexpected close. Each successful (re)connection fires `onConnect`; each close fires `onDisconnect`.

## Options

`PulseClientOptions` controls connection and reconnect behaviour:

| Option | Type | Description |
|---|---|---|
| `autoReconnect` | `boolean` | Reconnect after unexpected close. |
| `reconnectDelayMs` | `number` | Base delay between reconnect attempts. |
| `maxReconnectAttempts` | `number` | Maximum reconnect attempts before giving up. |
| `queryParameters` | `PulseQueryParameters` | Key/value map sent as the WebSocket query string (e.g. `?token=…`). |

## API surface

| Member | Description |
|---|---|
| `new PulseClient(url, options?)` | Construct a client bound to a `wss://` (or `ws://`) endpoint. |
| `connect(options?)` | Open the WebSocket. Returns a promise that resolves on `open`. |
| `disconnect(code?, reason?)` | Close the connection cleanly and stop reconnect attempts. |
| `connected` | `true` when the underlying socket is `OPEN`. |
| `invoke<TResponse>(handle, payload)` | Send an RPC and await the matching response envelope. |
| `stream<TItem>(handle, payload)` | Open a server-streamed response as an `AsyncIterable<TItem>`. |
| `send(handle, payload)` | Fire-and-forget envelope; resolves once the frame is flushed. |
| `on<T>(eventName, listener)` | Register an event listener; returns a disposer function. |
| `off(eventName, listener)` | Remove a previously registered listener. |
| `onConnect(handler)` / `onDisconnect(handler)` | Lifecycle hooks. |

## Support the project

If `@rymote/pulse-client` has helped you ship faster, please consider supporting ongoing development:

- [Patreon](https://www.patreon.com/rymote)
- [Open Collective](https://opencollective.com/rymote)

## License

This project is licensed under the BSD 3-Clause License — see [LICENSE.md](./LICENSE.md) for details.

## Support

- Issues: [GitHub Issues](https://github.com/rymote/pulse-client/issues)
- Discussions: [GitHub Discussions](https://github.com/rymote/pulse-client/discussions)
