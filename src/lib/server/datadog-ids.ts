/**
 * Datadog trace-id conversion helpers.
 *
 * Datadog traces key logs by a 64-bit decimal `dd.trace_id`/`dd.span_id`,
 * while the active OTel trace context carries 128-bit hex ids (32 hex chars)
 * or 36-char dashed UUIDs. These helpers convert OTel ids to the low-64-bit
 * decimal form Datadog accepts, and guard against emitting a zero trace id.
 *
 * Pure functions only: no I/O, no state, no browser or Node globals — plain
 * BigInt arithmetic, safe on any runtime.
 */

/**
 * Convert a trace/span id to its low-64 bits as a decimal string.
 *
 * - 32-hex OTel id: `BigInt('0x' + id.slice(-16)).toString(10)`
 * - 36-char dashed UUID: dashes stripped first (→ 32 hex), then the same
 *   low-64 conversion path
 *
 * Empty (or dash-only) input degrades gracefully to `'0'` and never throws.
 */
export function hexIdToLow64Decimal(id: string): string {
  const stripped = id.replaceAll('-', '');
  if (stripped.length === 0) return '0';
  return BigInt(`0x${stripped.slice(-16)}`).toString(10);
}

/**
 * Zero-safe emission guard.
 *
 * Returns `true` iff the decimal string is `'0'`. Callers MUST use this to
 * suppress a converted id of 0 before emitting it as `dd.trace_id`/`dd.span_id`,
 * since Datadog treats `dd.trace_id: 0` as an invalid correlation value.
 */
export function isZeroLow64Decimal(value: string): boolean {
  return value === '0';
}
