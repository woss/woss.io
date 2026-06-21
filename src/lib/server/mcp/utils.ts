/**
 * Safely convert an unknown value to Record<string, unknown> | undefined.
 * Returns undefined for null, arrays, and non-objects.
 */
export function toRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const result: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value)) {
    result[key] = val;
  }
  return result;
}
