import { IPulseSession } from './transport/pulse-session.interface.js';
import { IPulseStream } from './transport/pulse-stream.interface.js';
import { PulseClientEventHandlerRegistry } from './pulse-client-event-handler-registry.class.js';
import { PulseStreamResetError } from './transport/pulse-stream-reset-error.class.js';

export class PulseClientSessionPipeline {
    public static async run(
        session: IPulseSession,
        registry: PulseClientEventHandlerRegistry,
        abortSignal: AbortSignal,
    ): Promise<void> {
        const streamLoop = this.acceptStreams(session, registry, abortSignal);
        const datagramLoop = session.datagrams !== null
            ? this.acceptDatagrams(session, registry, abortSignal)
            : Promise.resolve();

        await Promise.all([streamLoop, datagramLoop]);
    }

    private static async acceptStreams(
        session: IPulseSession,
        registry: PulseClientEventHandlerRegistry,
        abortSignal: AbortSignal,
    ): Promise<void> {
        while (!abortSignal.aborted) {
            let stream: IPulseStream | null;
            try {
                stream = await session.acceptStream(abortSignal);
            } catch {
                break;
            }
            if (stream === null) break;

            void this.handleIncomingStream(stream, session, registry, abortSignal);
        }
    }

    private static async handleIncomingStream(
        stream: IPulseStream,
        session: IPulseSession,
        registry: PulseClientEventHandlerRegistry,
        abortSignal: AbortSignal,
    ): Promise<void> {
        try {
            const envelopeBytes = await stream.readEnvelope(abortSignal);
            if (envelopeBytes === null) return;
            await registry.dispatch(envelopeBytes, session.transportName);
        } catch (error) {
            if (error instanceof PulseStreamResetError) return;
            // ignore other errors — server may have aborted the push
        } finally {
            await stream.dispose();
        }
    }

    private static async acceptDatagrams(
        session: IPulseSession,
        registry: PulseClientEventHandlerRegistry,
        abortSignal: AbortSignal,
    ): Promise<void> {
        const channel = session.datagrams;
        if (channel === null) return;

        while (!abortSignal.aborted) {
            let envelopeBytes: Uint8Array | null;
            try {
                envelopeBytes = await channel.receiveDatagram(abortSignal);
            } catch {
                break;
            }
            if (envelopeBytes === null) break;

            void registry.dispatch(envelopeBytes, session.transportName);
        }
    }
}
