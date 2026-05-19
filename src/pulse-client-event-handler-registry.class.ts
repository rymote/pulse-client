import pulseSerializer from './pulse-serializer.class.js';
import { PulseClientEventContext } from './pulse-client-event-context.class.js';
import { PulseClientEventHandler } from './pulse-client-event-handler.type.js';
import { PulseEnvelope } from './pulse-envelope.class.js';

interface RegisteredHandler {
    handlePattern: string;
    handler: PulseClientEventHandler<unknown>;
    regex: RegExp;
    groupNames: string[];
}

export class PulseClientEventHandlerRegistry {
    private readonly registered: RegisteredHandler[] = [];

    public register<TEvent>(handlePattern: string, handler: PulseClientEventHandler<TEvent>): void {
        const { regex, groupNames } = this.compilePattern(handlePattern);
        this.registered.push({
            handlePattern,
            handler: handler as PulseClientEventHandler<unknown>,
            regex,
            groupNames,
        });
    }

    public unregister(handlePattern: string, handler: PulseClientEventHandler<unknown>): void {
        const index = this.registered.findIndex(
            (entry) => entry.handlePattern === handlePattern && entry.handler === handler,
        );
        if (index >= 0) this.registered.splice(index, 1);
    }

    public async dispatch(rawEnvelopeBytes: Uint8Array, transportName: string): Promise<void> {
        let envelope: PulseEnvelope<unknown>;
        try {
            envelope = pulseSerializer.unpackEnvelope<unknown>(rawEnvelopeBytes);
        } catch {
            return;
        }

        for (const entry of this.registered) {
            const match = entry.regex.exec(envelope.handle);
            if (!match) continue;

            const parameters: Record<string, string> = {};
            for (const groupName of entry.groupNames) {
                const captured = match.groups?.[groupName];
                if (captured !== undefined) parameters[groupName] = captured;
            }

            const context = new PulseClientEventContext(envelope.handle, parameters, envelope, transportName);
            try {
                await entry.handler(envelope.body, context);
            } catch {
                // isolate handler errors so one bad handler doesn't kill the session loop
            }
        }
    }

    private compilePattern(handlePattern: string): { regex: RegExp; groupNames: string[] } {
        const groupNames: string[] = [];
        const escaped = handlePattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
        const regexSource = escaped.replace(/\\\{(\w+)\\\}/g, (_match, captured) => {
            groupNames.push(captured);
            return `(?<${captured}>[^/]+)`;
        });
        return { regex: new RegExp(`^${regexSource}$`), groupNames };
    }
}
