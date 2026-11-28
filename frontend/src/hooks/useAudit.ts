import { skipToken, useQuery } from '@tanstack/react-query';
import { apiClient } from '../api';

export function useAudit(runId?: string) {
  return useQuery({
    queryKey: ['audit', runId],
    queryFn: runId ? () => apiClient.audit(runId) : skipToken,
    retry: false,
  });
}
