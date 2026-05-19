export const MULTIPLEXER_FRAME_OPS = {
    OPEN_BIDI: 0x01,
    OPEN_UNI: 0x02,
    DATA: 0x03,
    FIN: 0x04,
    RESET: 0x05,
    DATAGRAM: 0x10,
    PING: 0x20,
    PONG: 0x21,
    GOAWAY: 0x22,
} as const;
