/**
 * Promise-based mutex for serializing async operations.
 *
 * Provides a simple lock mechanism using native Promise mechanics.
 * No external dependencies required.
 *
 * @module kdco-primitives/mutex
 */

/**
 * Simple promise-based mutex interface for serializing async operations.
 *
 * Uses a queue of pending waiters to ensure fair ordering.
 * Each waiter is resolved in FIFO order when the lock is released.
 *
 * @example
 * const mutex = createMutex()
 * await mutex.acquire()
 * try {
 *   await criticalSection()
 * } finally {
 *   mutex.release()
 * }
 */
export interface Mutex {
  /** Acquire the mutex lock */
  acquire(): Promise<void>;
  /** Release the mutex lock */
  release(): void;
  /** Execute a function exclusively under mutex protection */
  runExclusive<T>(fn: () => Promise<T>): Promise<T>;
}

/**
 * Create a promise-based mutex for serializing async operations.
 *
 * Uses closures instead of class to avoid Bun/JavaScriptCore bug
 * where class constructors lose [[Construct]] through plugin module proxy.
 *
 * @returns A new Mutex instance
 *
 * @example
 * const mutex = createMutex()
 * const result = await mutex.runExclusive(async () => {
 *   return await criticalSection()
 * })
 */
export function createMutex(): Mutex {
  let locked = false;
  const queue: (() => void)[] = [];

  async function acquire(): Promise<void> {
    if (!locked) {
      locked = true;
      return;
    }
    return new Promise<void>((resolve) => {
      queue.push(resolve);
    });
  }

  function release(): void {
    const next = queue.shift();
    if (next) {
      next();
    } else {
      locked = false;
    }
  }

  async function runExclusive<T>(fn: () => Promise<T>): Promise<T> {
    await acquire();
    try {
      return await fn();
    } finally {
      release();
    }
  }

  return { acquire, release, runExclusive };
}
