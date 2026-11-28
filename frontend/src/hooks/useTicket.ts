import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../api';

export function useTicket() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (runId: string) => apiClient.createTicket(runId),
    retry: false,
    onSuccess: (ticket) => {
      queryClient.setQueryData(['ticket', ticket.run_id], ticket);
      void queryClient.invalidateQueries({ queryKey: ['audit', ticket.run_id] });
    },
  });
}

export function useApproveTicket() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ ticketId, analystName }: { ticketId: string; analystName: string }) => (
      apiClient.approve(ticketId, analystName)
    ),
    // Approval must never be retried automatically.
    retry: false,
    onSuccess: (ticket) => {
      queryClient.setQueryData(['ticket', ticket.run_id], ticket);
      void queryClient.invalidateQueries({ queryKey: ['audit', ticket.run_id] });
    },
  });
}
