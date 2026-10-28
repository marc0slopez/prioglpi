import { Prisma } from '@prisma/client';

export interface AuditQueryParams {
  user?: string | null;
  entityType?: string | null;
  action?: string | null;
  ticketId?: string | null;
  from?: string | null;
  to?: string | null;
}

/**
 * Valida si un string YYYY-MM-DD es una fecha de calendario real en el calendario Gregoriano.
 */
export function isValidCalendarDate(dateStr: string): boolean {
  const match = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return false;
  const year = parseInt(match[1], 10);
  const month = parseInt(match[2], 10);
  const day = parseInt(match[3], 10);

  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return day <= daysInMonth;
}

/**
 * Construye la cláusula where transaccional estricta para consultar AuditLog.
 */
export function buildAuditWhere(params: AuditQueryParams): Prisma.AuditLogWhereInput {
  const where: Prisma.AuditLogWhereInput = {};
  const andClauses: Prisma.AuditLogWhereInput[] = [];

  if (params.user && params.user.trim() !== '') {
    const val = params.user.trim();
    if (/^\d+$/.test(val)) {
      andClauses.push({
        userId: parseInt(val, 10)
      });
    } else {
      andClauses.push({
        actorUsername: val.toLowerCase()
      });
    }
  }

  if (params.entityType && params.entityType.trim() !== '') {
    andClauses.push({ entityType: params.entityType.trim() });
  }

  if (params.action && params.action.trim() !== '') {
    andClauses.push({ action: params.action.trim() });
  }

  if (params.ticketId && params.ticketId.trim() !== '') {
    const val = params.ticketId.trim();
    if (!/^\d+$/.test(val)) {
      throw new Error('ticketId debe ser numérico');
    }
    andClauses.push({
      OR: [
        { entityId: val },
        { entityId: { endsWith: `/${val}` } },
        { beforeJson: { contains: `"ticketId":${val},` } },
        { beforeJson: { contains: `"ticketId":${val}}` } },
        { afterJson: { contains: `"ticketId":${val},` } },
        { afterJson: { contains: `"ticketId":${val}}` } }
      ]
    });
  }

  let fromDate: Date | undefined;
  let toDate: Date | undefined;

  if (params.from && params.from.trim() !== '') {
    const fromStr = params.from.trim();
    if (!isValidCalendarDate(fromStr)) {
      throw new Error(`Fecha 'from' inválida en calendario: ${fromStr}`);
    }
    const match = fromStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (match) {
      const y = parseInt(match[1], 10);
      const m = parseInt(match[2], 10) - 1;
      const d = parseInt(match[3], 10);
      // En America/Argentina/Buenos_Aires (UTC-3), las 00:00 ART equivalen a las 03:00 UTC
      fromDate = new Date(Date.UTC(y, m, d, 3, 0, 0, 0));
    }
  }

  if (params.to && params.to.trim() !== '') {
    const toStr = params.to.trim();
    if (!isValidCalendarDate(toStr)) {
      throw new Error(`Fecha 'to' inválida en calendario: ${toStr}`);
    }
    const match = toStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (match) {
      const y = parseInt(match[1], 10);
      const m = parseInt(match[2], 10) - 1;
      const d = parseInt(match[3], 10);
      // Límite superior exclusivo: 00:00 ART del día siguiente = 03:00 UTC del día siguiente
      toDate = new Date(Date.UTC(y, m, d + 1, 3, 0, 0, 0));
    }
  }

  if (fromDate && toDate && fromDate.getTime() > toDate.getTime()) {
    throw new Error('El rango de fechas es inválido: from es posterior a to');
  }

  if (fromDate || toDate) {
    const createdAtWhere: Prisma.DateTimeFilter = {};
    if (fromDate) createdAtWhere.gte = fromDate;
    if (toDate) createdAtWhere.lt = toDate;
    andClauses.push({ createdAt: createdAtWhere });
  }

  if (andClauses.length > 0) {
    where.AND = andClauses;
  }

  return where;
}
