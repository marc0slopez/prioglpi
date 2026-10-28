export type TicketView = 'open' | 'history' | 'all';

export function normalizeTicketView(val: string | null | undefined): TicketView {
  if (val === 'history' || val === 'all') {
    return val;
  }
  return 'open';
}
