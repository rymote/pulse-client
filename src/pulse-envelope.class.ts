import { PulseKind } from './pulse-kind.enum';
import { PulseStatus } from './pulse-status.enum';

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
