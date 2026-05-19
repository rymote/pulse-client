export class PulseStreamResetError extends Error {
    public readonly reasonCode: number;

    constructor(reasonCode: number, message?: string) {
        super(message ?? `Pulse stream reset with reason code ${reasonCode}.`);
        this.reasonCode = reasonCode;
        this.name = 'PulseStreamResetError';
    }
}
