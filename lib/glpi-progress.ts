export function parseGlpiProgress(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const matches = [...value.matchAll(/(?:^|>|&gt;)\s*(\d{1,3})\s*%/g)];
  if (matches.length === 0) return null;
  const progress = Number(matches[matches.length - 1][1]);
  return progress >= 0 && progress <= 100 ? progress : null;
}
