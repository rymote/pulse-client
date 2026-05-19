export interface IByteChannel {
    read(buffer: Uint8Array, abortSignal: AbortSignal): Promise<number>;
    write(data: Uint8Array): Promise<void>;
    flush(): Promise<void>;
    close(): Promise<void>;
}
