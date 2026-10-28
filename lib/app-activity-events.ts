export const APP_PAGE_ROLES: Record<string, readonly string[]> = {
  '/dashboard/admin': ['admin'],
  '/dashboard/admin/modo-dios': ['admin'],
  '/dashboard/coordinador': ['coordinador_sistemas', 'tecnico_sistemas'],
  '/dashboard/coordinador/metricas': ['coordinador_sistemas', 'tecnico_sistemas'],
  '/dashboard/priorizador': ['priorizador'],
  '/dashboard/priorizador/metricas': ['priorizador'],
  '/dashboard/referente': ['referente'],
  '/dashboard/referente/metricas': ['referente'],
};

export type AppActivityEvent =
  | { kind: 'page'; path: string }
  | { kind: 'ticket'; ticketId: number };

export function parseAppActivityEvent(input: unknown, role: string, username: string): AppActivityEvent | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const record = input as Record<string, unknown>;
  if (record.kind === 'page' && typeof record.path === 'string') {
    const roles = APP_PAGE_ROLES[record.path];
    if (!roles?.includes(role)) return null;
    return { kind: 'page', path: record.path };
  }
  if (record.kind === 'ticket' && typeof record.ticketId === 'number' &&
      Number.isSafeInteger(record.ticketId) && record.ticketId > 0 && record.ticketId <= 2147483647) {
    return { kind: 'ticket', ticketId: record.ticketId };
  }
  return null;
}
