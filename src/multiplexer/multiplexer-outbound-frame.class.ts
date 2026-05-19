import { MULTIPLEXER_FRAME_OPS } from './multiplexer-frame-ops.js';

export class MultiplexerOutboundFrame {
    public readonly streamId: number;
    public readonly op: number;
    public readonly payload: Uint8Array;

    constructor(streamId: number, op: number, payload: Uint8Array) {
        this.streamId = streamId;
        this.op = op;
        this.payload = payload;
    }

    public static reset(streamId: number, reasonCode: number): MultiplexerOutboundFrame {
        const payload = new Uint8Array(4);
        const dataView = new DataView(payload.buffer);
        dataView.setUint32(0, reasonCode, false);
        return new MultiplexerOutboundFrame(streamId, MULTIPLEXER_FRAME_OPS.RESET, payload);
    }
}
