export interface MultiplexerOptions {
    maxFramePayloadSizeInBytes: number;
    maxDatagramEnvelopeSizeInBytes: number;
    datagramsEnabled: boolean;
}

export const DEFAULT_MULTIPLEXER_OPTIONS: MultiplexerOptions = {
    maxFramePayloadSizeInBytes: 10 * 1024 * 1024,
    maxDatagramEnvelopeSizeInBytes: 1200,
    datagramsEnabled: true,
};
