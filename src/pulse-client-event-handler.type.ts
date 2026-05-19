import { PulseClientEventContext } from './pulse-client-event-context.class.js';

export type PulseClientEventHandler<TEvent = unknown> = (
    body: TEvent,
    context: PulseClientEventContext,
) => void | Promise<void>;
