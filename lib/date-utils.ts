export function getPeriodRange(period: string, anchorDateStr?: string | null) {
  const timeZone = 'America/Argentina/Buenos_Aires';
  const now = (period === 'year' || !anchorDateStr) ? new Date() : new Date(anchorDateStr);

  // Format to string in local tz to extract parts
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  });

  const parts = formatter.formatToParts(now);
  const getPart = (type: string) => parts.find(p => p.type === type)?.value || '';

  const y = parseInt(getPart('year'), 10);
  const m = parseInt(getPart('month'), 10) - 1; // 0-indexed
  const d = parseInt(getPart('day'), 10);

  let start = new Date(Date.UTC(y, m, d));
  let end = new Date(Date.UTC(y, m, d + 1));

  if (period === 'week') {
    const dayOfWeek = start.getUTCDay();
    const diff = start.getUTCDate() - dayOfWeek + (dayOfWeek === 0 ? -6 : 1); // Monday
    start = new Date(Date.UTC(y, m, diff));
    end = new Date(Date.UTC(y, m, diff + 7));
  } else if (period === 'month') {
    start = new Date(Date.UTC(y, m, 1));
    end = new Date(Date.UTC(y, m + 1, 1));
  } else if (period === 'year') {
    start = new Date(Date.UTC(y, 0, 1));
    end = new Date(Date.UTC(y + 1, 0, 1));
  }

  const fmt = (dt: Date) => {
    return dt.toISOString().replace('T', ' ').substring(0, 19);
  };

  return { start: fmt(start), end: fmt(end) };
}

export function validateYearAnchor(period: string, anchorDateStr?: string | null): boolean {
  if (period !== 'year' || !anchorDateStr) return true;
  const timeZone = 'America/Argentina/Buenos_Aires';
  const now = new Date();
  const anchor = new Date(anchorDateStr);
  if (isNaN(anchor.getTime())) return false;

  const getYear = (dt: Date) => {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric' }).formatToParts(dt);
    return parseInt(parts.find(p => p.type === 'year')?.value || '0', 10);
  };

  return getYear(now) === getYear(anchor);
}
