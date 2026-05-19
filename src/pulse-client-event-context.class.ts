import { PulseEnvelope } from './pulse-envelope.class.js';

export class PulseClientEventContext {
    public readonly handle: string;
    public readonly parameters: Readonly<Record<string, string>>;
    public readonly untypedEnvelope: PulseEnvelope<unknown>;
    public readonly transportName: string;

    constructor(
        handle: string,
        parameters: Record<string, string>,
        untypedEnvelope: PulseEnvelope<unknown>,
        transportName: string,
    ) {
        this.handle = handle;
        this.parameters = parameters;
        this.untypedEnvelope = untypedEnvelope;
        this.transportName = transportName;
    }
}
