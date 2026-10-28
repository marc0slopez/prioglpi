export function formatDateFunctional(dateString: string | null | undefined): string {
  if (!dateString) return '';

  // Deterministic local date parser for YYYY-MM-DD
  const match = dateString.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (match) {
    return `${match[3]}/${match[2]}/${match[1]}`;
  }

  const date = new Date(dateString);
  if (isNaN(date.getTime())) return '';

  const formatter = new Intl.DateTimeFormat('es-AR', {
    timeZone: 'America/Argentina/Buenos_Aires',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });

  return formatter.format(date);
}

export function formatDateAudit(dateString: string | null | undefined): string {
  if (!dateString) return '';

  // YYYY-MM-DD HH:mm:ss without Z shift
  const match = dateString.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/);
  if (match) {
    const [, year, month, day, hour, minute] = match;
    if (hour && minute) {
      return `${day}/${month}/${year} ${hour}:${minute}`;
    }
    return `${day}/${month}/${year} 00:00`;
  }

  const date = new Date(dateString);
  if (isNaN(date.getTime())) return '';

  const formatter = new Intl.DateTimeFormat('es-AR', {
    timeZone: 'America/Argentina/Buenos_Aires',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  });

  const parts = formatter.formatToParts(date);
  const getPart = (type: string) => parts.find(p => p.type === type)?.value || '';

  return `${getPart('day')}/${getPart('month')}/${getPart('year')} ${getPart('hour')}:${getPart('minute')}`;
}

export function formatDateRange(start: string | null | undefined, end: string | null | undefined): string {
  if (!start && !end) return '';
  if (start && !end) return `Desde ${formatDateFunctional(start)}`;
  if (!start && end) return `Hasta ${formatDateFunctional(end)}`;

  // Exclusive end date correction (subtract 1 day from end date before formatting)
  const endDate = new Date(end!);
  if (!isNaN(endDate.getTime())) {
    endDate.setDate(endDate.getDate() - 1); // Because it's exclusive
    return `${formatDateFunctional(start)} al ${formatDateFunctional(endDate.toISOString())}`;
  }

  return `${formatDateFunctional(start)} al ${formatDateFunctional(end)}`;
}

export const formatDate = formatDateFunctional;
export const formatDateLong = formatDateAudit;
