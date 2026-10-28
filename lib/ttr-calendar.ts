const ARGENTINA_TIME_ZONE = 'America/Argentina/Buenos_Aires';
const DAY_MS = 86_400_000;

function calendarDay(value: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:$|[ T])/.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const timestamp = Date.UTC(year, month - 1, day);
  const parsed = new Date(timestamp);
  if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) return null;
  return timestamp / DAY_MS;
}

export function ttrCalendarStatus(ttr: string | null | undefined, now = new Date()) {
  if (!ttr || !Number.isFinite(now.getTime())) return null;
  const dueDay = calendarDay(ttr);
  if (dueDay === null) return null;

  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: ARGENTINA_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now);
  const part = (type: string) => parts.find(item => item.type === type)?.value || '';
  const today = calendarDay(`${part('year')}-${part('month')}-${part('day')}`);
  if (today === null) return null;

  const days = dueDay - today;
  if (days < 0) return { tone: 'overdue', label: 'TTR VENCIDO', days } as const;
  if (days === 0) return { tone: 'soon', label: 'TTR VENCE HOY', days } as const;
  return {
    tone: days <= 7 ? 'soon' : 'on-time',
    label: `${days === 1 ? 'FALTA' : 'FALTAN'} ${days} ${days === 1 ? 'DÍA' : 'DÍAS'} PARA VENCER TTR`,
    days,
  } as const;
}
