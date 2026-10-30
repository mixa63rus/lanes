// Даты храним строками YYYY-MM-DD, чтобы не зависеть от часовых поясов.
export type ISODate = string;

const pad = (n: number) => String(n).padStart(2, '0');

export const toISO = (d: Date): ISODate =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

export function fromISO(s: ISODate): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export const todayISO = () => toISO(new Date());

export function addDays(s: ISODate, n: number): ISODate {
  const d = fromISO(s);
  d.setDate(d.getDate() + n);
  return toISO(d);
}

export function diffDays(a: ISODate, b: ISODate): number {
  const [ay, am, ad] = a.split('-').map(Number);
  const [by, bm, bd] = b.split('-').map(Number);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86_400_000);
}

export const isWeekend = (s: ISODate) => {
  const day = fromISO(s).getDay();
  return day === 0 || day === 6;
};

export const startOfWeek = (s: ISODate) => addDays(s, -((fromISO(s).getDay() + 6) % 7));

export const minDate = (a: ISODate, b: ISODate) => (a < b ? a : b);
export const maxDate = (a: ISODate, b: ISODate) => (a > b ? a : b);

export function dateRange(from: ISODate, to: ISODate): ISODate[] {
  const out: ISODate[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

/** Сколько рабочих дней от a до b (положительно, если b позже). */
export function workdaysBetween(a: ISODate, b: ISODate): number {
  if (a === b) return 0;
  const sign = a < b ? 1 : -1;
  const [lo, hi] = sign > 0 ? [a, b] : [b, a];
  let n = 0;
  for (let d = addDays(lo, 1); d <= hi; d = addDays(d, 1)) if (!isWeekend(d)) n++;
  return n * sign;
}

const shortFmt = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short' });
const longFmt = new Intl.DateTimeFormat('ru-RU', { weekday: 'short', day: 'numeric', month: 'long' });
const monthFmt = new Intl.DateTimeFormat('ru-RU', { month: 'long', year: 'numeric' });

export const fmtShort = (s: ISODate) => shortFmt.format(fromISO(s));
export const fmtLong = (s: ISODate) => longFmt.format(fromISO(s));
export const fmtMonth = (s: ISODate) => monthFmt.format(fromISO(s));
export const WEEKDAY = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];
