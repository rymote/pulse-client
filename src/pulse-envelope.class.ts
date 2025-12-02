import { PulseKind } from './pulse-kind.enum.js';
import { PulseStatus } from './pulse-status.enum.js';

export class PulseEnvelope<T> {
    id!: string;
    handle!: string;
    body!: T;
    authToken?: string;
    kind!: PulseKind;
    version!: string;
    clientCorrelationId?: string;
    status?: PulseStatus;
    error?: string;
}
