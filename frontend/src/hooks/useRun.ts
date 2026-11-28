import { useMutation } from '@tanstack/react-query';
import { apiClient } from '../api';

export function useRun() {
  return useMutation({
    mutationFn: (alert: Record<string, unknown>) => apiClient.run(alert),
    retry: false,
  });
}
