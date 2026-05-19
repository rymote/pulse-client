interface AsyncQueueWaiter<T> {
    resolve: (value: T | null) => void;
    reject: (reason: unknown) => void;
}

export class AsyncQueue<T> {
    private readonly buffer: T[] = [];
    private readonly waiters: Array<AsyncQueueWaiter<T>> = [];
    private closed = false;
    private closeError: unknown = null;

    public enqueue(item: T): boolean {
        if (this.closed) return false;
        const nextWaiter = this.waiters.shift();
        if (nextWaiter) {
            nextWaiter.resolve(item);
        } else {
            this.buffer.push(item);
        }
        return true;
    }

    public async dequeue(abortSignal?: AbortSignal): Promise<T | null> {
        if (this.buffer.length > 0) return this.buffer.shift()!;
        if (this.closed) {
            if (this.closeError) throw this.closeError;
            return null;
        }

        return new Promise<T | null>((resolve, reject) => {
            const waiter: AsyncQueueWaiter<T> = { resolve, reject };
            this.waiters.push(waiter);

            if (abortSignal) {
                const abortHandler = (): void => {
                    const index = this.waiters.indexOf(waiter);
                    if (index >= 0) this.waiters.splice(index, 1);
                    reject(new DOMException('Aborted', 'AbortError'));
                };
                if (abortSignal.aborted) {
                    abortHandler();
                } else {
                    abortSignal.addEventListener('abort', abortHandler, { once: true });
                }
            }
        });
    }

    public close(error?: unknown): void {
        if (this.closed) return;
        this.closed = true;
        this.closeError = error ?? null;

        const pendingWaiters = this.waiters.slice();
        this.waiters.length = 0;
        for (const waiter of pendingWaiters) {
            if (error) waiter.reject(error);
            else waiter.resolve(null);
        }
    }

    public get isClosed(): boolean {
        return this.closed;
    }
}
