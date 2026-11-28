import { describe, expect, it } from 'vitest';
import type { ApiErrorCode } from '../api/types';
import { AppError, errorMessages, normalizeApiError } from './errors';

export const contractCodes: ApiErrorCode[] = [
  'invalid_json', 'payload_too_large', 'validation_error',
  'not_found', 'already_approved', 'llm_unavailable', 'internal_error',
];

describe('API error mapping', () => {
  it.each(contractCodes)('normalizes %s into a typed, friendly error', (code) => {
    const details = { field: 'alert' };
    const result = normalizeApiError({ error: { code, message: '<untrusted server body>', details } });
    expect(result).toBeInstanceOf(AppError);
    expect(result).toBeInstanceOf(Error);
    expect(result).toMatchObject({ name: 'AppError', code, message: errorMessages[code], details });
    expect(result!.message).not.toContain('untrusted');
  });

  it.each([
    null, {}, [], { error: null }, { error: 'bad response' }, { error: {} },
    { error: { code: 'unknown_code' } }, { error: { code: 'constructor' } },
    { error: { code: 'toString' } }, { error: { code: 503 } },
  ])('does not invent a contract code for a malformed envelope: %j', (payload) => {
    expect(normalizeApiError(payload)).toBeNull();
  });
});
