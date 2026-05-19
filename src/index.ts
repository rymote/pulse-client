import pulseSerializer from './pulse-serializer.class.js';

// Wire-format types
export { PulseKind } from './pulse-kind.enum.js';
export { PulseStatus } from './pulse-status.enum.js';
export { PulseEnvelope } from './pulse-envelope.class.js';
export { pulseSerializer as PulseSerializer };

// Top-level client
export { PulseClient } from './pulse-client.class.js';
export type { PulseClientOptions } from './pulse-client-options.interface.js';
export type { DeliveryMode } from './pulse-client.class.js';
export { PulseConnectError } from './pulse-connect-error.class.js';
export { PulseClientEventContext } from './pulse-client-event-context.class.js';
export type { PulseClientEventHandler } from './pulse-client-event-handler.type.js';

// Transport contracts (so consumers can build custom transports)
export type { IPulseClientTransport } from './transport/pulse-client-transport.interface.js';
export type { IPulseSession } from './transport/pulse-session.interface.js';
export type { IPulseStream } from './transport/pulse-stream.interface.js';
export type { IPulseDatagramChannel } from './transport/pulse-datagram-channel.interface.js';
export { PulseStreamDirection } from './transport/pulse-stream-direction.enum.js';
export { PulseStreamResetError } from './transport/pulse-stream-reset-error.class.js';

// Built-in WebSocket transport
export { WebSocketClientTransport } from './transport/websocket-client-transport.class.js';
export type { WebSocketClientTransportOptions } from './transport/websocket-client-transport.class.js';
