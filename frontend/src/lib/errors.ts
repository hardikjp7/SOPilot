import type { ApiErrorCode } from '../api/types';

export const errorMessages: Record<ApiErrorCode, string> = {
  invalid_json: 'The alert is not valid JSON. Check the input and try again.',
  payload_too_large: 'The alert is too large. Reduce it to 200 KB or less.',
  validation_error: 'Some information is missing or invalid. Check your input and try again.',
  not_found: 'The requested item could not be found. Check your selection and try again.',
  already_approved: 'This ticket has already been approved and is read-only.',
  llm_unavailable: 'The analysis service is temporarily unavailable. Please retry.',
  internal_error: 'The service encountered an internal error. Please retry.',
};

export class AppError extends Error {
  constructor(
    public readonly code: ApiErrorCode,
    public readonly details?: unknown,
  ) {
    super(errorMessages[code]);
    this.name = 'AppError';
  }
}

// Unknown/transport failures have no contract code. Do not mislabel them as
// model outages or introduce new API enum values.
export function normalizeApiError(payload: unknown): AppError | null {
  if (typeof payload !== 'object' || payload === null || !('error' in payload)) {
    return null;
  }
  const error = payload.error;
  if (typeof error !== 'object' || error === null || !('code' in error)) {
    return null;
  }
  const code = error.code;
  if (typeof code !== 'string' || !Object.hasOwn(errorMessages, code)) {
    return null;
  }
  return new AppError(code as ApiErrorCode, 'details' in error ? error.details : undefined);
}
