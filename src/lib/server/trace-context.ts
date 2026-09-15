import { AsyncLocalStorage } from 'node:async_hooks';
import { v7 as uuidv7, v4 as uuidv4 } from 'uuid';

export interface TraceContext {
  traceId: string;
  spanId: string;
  msgId?: string;
}

/**
 * The AsyncLocalStorage instance shared with LogTape.
 * Stores Record<string, unknown> to match LogTape's ContextLocalStorage interface.
 */
export const traceStorage = new AsyncLocalStorage<Record<string, unknown>>();

/**
 * Generate a UUIDv7 — time-ordered, sortable, B-tree friendly.
 */
export function generateTraceId(): string {
  return uuidv7();
}

/**
 * Generate a UUIDv4 for span ID — no ordering needed within a trace.
 */
export function generateSpanId(): string {
  return uuidv4();
}

/**
 * Get the current trace context from AsyncLocalStorage.
 * Returns undefined if no trace context is active.
 */
export function getCurrentTraceContext(): TraceContext | undefined {
  const store = traceStorage.getStore();
  if (!store) return undefined;
  return {
    traceId: store.traceId as string,
    spanId: store.spanId as string,
  };
}

/**
 * Set the message ID on the current trace context.
 * All subsequent log calls in this trace will carry msgId as a JSON field.
 */
export function setMsgId(msgId: string): void {
  const store = traceStorage.getStore();
  if (store) store.msgId = msgId;
}

/**
 * Run a callback with the given trace context.
 * All logs within the callback will carry traceId and spanId.
 * Uses the shared traceStorage so LogTape's withContext also sees it.
 */
export function withTrace<T>(traceId: string, spanId: string, fn: () => T): T {
  return traceStorage.run({ traceId, spanId }, fn);
}
