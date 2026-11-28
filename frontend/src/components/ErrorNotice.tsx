import { AlertCircle, ArrowLeft, Info, RotateCcw } from 'lucide-react';
import type { ApiErrorCode } from '../api/types';
import { AppError, errorMessages, normalizeApiError } from '../lib/errors';

interface ErrorNoticeProps {
  error: unknown;
  onRetry?: () => void;
  onEditInput?: () => void;
  retryLabel?: string;
}

const titles: Record<ApiErrorCode, string> = {
  invalid_json: 'Check the alert JSON',
  payload_too_large: 'Alert too large',
  validation_error: 'Check your information',
  not_found: 'Item not found',
  already_approved: 'Ticket already approved',
  llm_unavailable: 'Analysis service unavailable',
  internal_error: 'Service error',
};

export default function ErrorNotice({ error, onRetry, onEditInput, retryLabel = 'Retry analysis' }: ErrorNoticeProps) {
  const code = error instanceof AppError && Object.hasOwn(errorMessages, error.code)
    ? error.code : normalizeApiError(error)?.code;
  // Neither unknown Error.message nor API message/details are safe UI copy.
  const message = code ? errorMessages[code]
    : 'The request could not be completed. Check your connection and try again.';
  const approved = code === 'already_approved';
  const inputError = code === 'invalid_json' || code === 'payload_too_large';
  const canRetry = code === 'llm_unavailable' || code === 'internal_error' || code === undefined;
  const Icon = approved ? Info : AlertCircle;

  return (
    <div
      role={approved ? 'status' : 'alert'}
      aria-live={approved ? 'polite' : 'assertive'}
      aria-atomic="true"
      className={`rounded-xl border p-4 ${approved ? 'border-outline/40 bg-canvas/50' : 'border-severity-critical/40 bg-severity-critical/5'}`}
    >
      <div className="flex items-start gap-3">
        <Icon size={20} className={`mt-0.5 shrink-0 ${approved ? 'text-muted' : 'text-severity-critical'}`} aria-hidden="true" />
        <div className="min-w-0">
          <h3 className="text-sm font-semibold leading-6">{code ? titles[code] : 'Request unavailable'}</h3>
          <p className="mt-1 text-sm leading-6 text-content">{message}</p>
          {inputError && <p className="mt-2 text-xs leading-5 text-muted">Review the Alert JSON input, then run the analysis again.</p>}
          <div className="flex flex-wrap gap-2">
            {inputError && onEditInput && <button type="button" onClick={onEditInput} className="button-secondary mt-3 text-sm"><ArrowLeft size={14} aria-hidden="true" />Review alert input</button>}
            {canRetry && onRetry && <button type="button" onClick={onRetry} className="button-secondary mt-3 text-sm"><RotateCcw size={14} aria-hidden="true" />{retryLabel}</button>}
          </div>
        </div>
      </div>
    </div>
  );
}
