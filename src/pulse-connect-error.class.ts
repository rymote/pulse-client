export class PulseConnectError extends Error {
    public readonly transportFailures: ReadonlyArray<{ transportName: string; error: unknown }>;

    constructor(message: string, transportFailures: Array<{ transportName: string; error: unknown }>) {
        super(message);
        this.name = 'PulseConnectError';
        this.transportFailures = transportFailures;
    }
}
