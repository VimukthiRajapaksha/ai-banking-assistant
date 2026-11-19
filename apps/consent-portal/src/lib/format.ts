/** One place for date formatting, so the same instant never appears two ways
 * on the same screen. Called in the browser, so times are in the customer's
 * own time zone. */

export const dateTime = (ms: number) =>
  new Date(ms).toLocaleString('en-US', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });

const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['day', 86_400_000],
  ['hour', 3_600_000],
  ['minute', 60_000],
];

/** "in 42 minutes", "3 days ago". */
export function relative(ms: number, now = Date.now()): string {
  const diff = ms - now;
  const rtf = new Intl.RelativeTimeFormat('en-US', { numeric: 'auto' });
  for (const [unit, size] of UNITS) {
    if (Math.abs(diff) >= size) return rtf.format(Math.round(diff / size), unit);
  }
  return diff >= 0 ? 'in under a minute' : 'just now';
}
