import { realClient } from './client';
import { mockClient } from './mockClient';
import type { ApiClient } from './types';

export const apiClient: ApiClient = import.meta.env.VITE_USE_MOCK === 'true'
  ? mockClient
  : realClient;

export default apiClient;
