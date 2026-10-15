import dayjs from 'dayjs';

export const CLOSED_STATUSES = ['done', 'rejected', 'cancelled'];

export type UrgencyColor = 'blue' | 'orange' | 'red' | 'grey' | null;

// Same signal shown in the priority/status tags, but readable as a single glance (a dot) instead
// of requiring each badge to be read — used on the Requests list row and the Dashboard's "Recent
// requests" widget, so it means the same thing everywhere. Precedence: closed always wins
// (grey/muted), then genuinely urgent (red), then worth-a-look (amber); anything else (routine
// in-progress work) gets no dot at all.
export function urgencyDotColor(r: {
  status: string; priority?: string; plannedDate?: string | null; assigneeId?: number | null;
}): UrgencyColor {
  if (CLOSED_STATUSES.includes(r.status)) return 'grey';
  const overdue = r.plannedDate && dayjs(r.plannedDate).isBefore(dayjs(), 'day');
  if (r.priority === 'critical' || overdue) return 'red';
  const dueSoon = r.plannedDate && dayjs(r.plannedDate).diff(dayjs(), 'day') <= 3;
  if (r.status === 'review' || dueSoon) return 'orange';
  if (r.status === 'new' || !r.assigneeId) return 'blue';
  return null;
}

// For places that render the dot with an inline style instead of the .req-dot-* CSS classes
// (requests-glass.css) — e.g. pages scoped under a different wrapper class.
export const URGENCY_HEX: Record<'blue' | 'orange' | 'red' | 'grey', string> = {
  blue: '#007AFF', orange: '#FF9F0A', red: '#FF3B30', grey: 'rgba(60,60,67,0.38)',
};
