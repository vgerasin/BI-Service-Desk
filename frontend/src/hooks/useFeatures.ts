import { useQuery } from '@tanstack/react-query';
import api from '../api/client';

export interface Features {
  hrDirectory: boolean;
  dashboardRefresh: boolean;
  dashboardRefreshCheckTime: string;
  dashboardRefreshTimezone: string;
}

const NONE: Features = {
  hrDirectory: false, dashboardRefresh: false, dashboardRefreshCheckTime: '10:30', dashboardRefreshTimezone: 'Europe/Moscow',
};

/** Which optional integrations are switched on (Settings → ...). Everything is "off" until loaded. */
export function useFeatures(): Features {
  const { data } = useQuery<Features>({
    queryKey: ['features'],
    queryFn: () => api.get('/settings/features').then(r => r.data),
    staleTime: 60_000,
  });
  return data ?? NONE;
}
