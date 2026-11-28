export const MAX_ALERT_BYTES = 204_800;

type AlertValidation = {
  bytes: number;
} & (
  | { valid: true; alert: Record<string, unknown>; error: null }
  | { valid: false; error: string | null }
);

export function validateAlertJson(input: string): AlertValidation {
  const encoder = new TextEncoder();
  const bytes = encoder.encode(input).byteLength;
  const tooLarge = 'The alert exceeds the 200 KB limit. Shorten it and try again.';
  if (bytes > MAX_ALERT_BYTES) return { valid: false, bytes, error: tooLarge };
  if (!input.trim()) return { valid: false, bytes, error: null };

  let alert: unknown;
  try {
    alert = JSON.parse(input);
  } catch {
    return { valid: false, bytes, error: 'Invalid JSON. Check for missing quotes, commas, or brackets.' };
  }
  if (typeof alert !== 'object' || alert === null || Array.isArray(alert)) {
    return { valid: false, bytes, error: 'Enter a JSON object enclosed in { }. Arrays and single values are not supported.' };
  }

  // MAX_REQUEST_BYTES applies to the entire POST body, including { alert: … }.
  const requestBytes = encoder.encode(JSON.stringify({ alert })).byteLength;
  if (requestBytes > MAX_ALERT_BYTES) {
    return { valid: false, bytes: requestBytes, error: tooLarge };
  }
  return { valid: true, alert: alert as Record<string, unknown>, bytes: Math.max(bytes, requestBytes), error: null };
}
