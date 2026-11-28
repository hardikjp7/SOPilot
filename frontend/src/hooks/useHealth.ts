import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../api';

export function useHealth() {
  return useQuery({
    queryKey: ['health'],
    queryFn: () => apiClient.health(),
    retry: false,
  });
}
