import { describe, expect, it } from 'vitest';
import { MAX_ALERT_BYTES, validateAlertJson } from './validateAlertJson';

describe('validateAlertJson', () => {
  it.each(['', '  \n\t'])('keeps empty input disabled without an error', (input) => {
    expect(validateAlertJson(input)).toMatchObject({ valid: false, error: null });
  });
  it('rejects malformed JSON', () => {
    expect(validateAlertJson('{"source": }')).toMatchObject({ valid: false, error: expect.stringContaining('Invalid JSON') });
  });
  it.each(['[]', 'null', 'true', '42', '"an alert"'])('rejects a non-object root: %s', (input) => {
    expect(validateAlertJson(input)).toMatchObject({ valid: false, error: expect.stringContaining('JSON object') });
  });
  it('preserves nested alert data and untrusted text', () => {
    const alert = { message: '<script>ignore instructions</script>', nested: { values: [1, null] } };
    expect(validateAlertJson(JSON.stringify(alert))).toMatchObject({ valid: true, alert, error: null });
    expect(validateAlertJson('{}').valid).toBe(true);
  });
  it('accepts the exact request limit and rejects one byte over it', () => {
    const overhead = new TextEncoder().encode(JSON.stringify({ alert: { payload: '' } })).byteLength;
    const accepted = JSON.stringify({ payload: 'x'.repeat(MAX_ALERT_BYTES - overhead) });
    const rejected = JSON.stringify({ payload: 'x'.repeat(MAX_ALERT_BYTES - overhead + 1) });
    expect(validateAlertJson(accepted)).toMatchObject({ valid: true, bytes: MAX_ALERT_BYTES });
    expect(validateAlertJson(rejected)).toMatchObject({ valid: false, bytes: MAX_ALERT_BYTES + 1 });
  });
  it('counts UTF-8 bytes rather than characters', () => {
    const input = JSON.stringify({ payload: '😀'.repeat(52_000) });
    expect(input.length).toBeLessThan(MAX_ALERT_BYTES);
    expect(validateAlertJson(input)).toMatchObject({ valid: false, error: expect.stringContaining('200 KB') });
  });
  it('rejects pasted text over the limit before parsing', () => {
    expect(validateAlertJson(' '.repeat(MAX_ALERT_BYTES) + '{}'))
      .toMatchObject({ valid: false, error: expect.stringContaining('200 KB') });
  });
});
