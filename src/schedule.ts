import {
  addDays, isWeekend, maxDate, minDate, startOfWeek, workdaysBetween, type ISODate,
} from './dates';
import type { Task } from './types';

const HORIZON_DAYS = 3 * 365;
const EPS = 1e-6;

export type Status = 'done' | 'notstarted' | 'ontrack' | 'ahead' | 'behind' | 'stalled';

export interface TaskSchedule {
  /** Базовый план: сколько часов приходится на каждый день. */
  baseline: Map<ISODate, number>;
  planEnd: ISODate | null;
  /** Прогноз: как распределится оставшаяся работа начиная с сегодня. */
  forecast: Map<ISODate, number>;
  forecastEnd: ISODate | null;
  logged: number;
  remaining: number;
  /** Сколько часов должно было быть отработано к текущему моменту по плану. */
  expected: number;
  /** logged − expected: плюс — опережаем, минус — отстаём. */
  deviation: number;
  progress: number;
  /** С чем сравниваем прогноз: дедлайн, а если его нет — плановое окончание. */
  target: ISODate | null;
  /** Сдвиг прогноза относительно target в рабочих днях (плюс — опаздываем). */
  slip: number | null;
  status: Status;
  first: ISODate;
  last: ISODate;
}

export function capacityOn(task: Task, date: ISODate): number {
  const override = task.plan[date];
  if (override !== undefined) return override;
  return isWeekend(date) ? 0 : task.hoursPerDay;
}

export function computeSchedule(task: Task, today: ISODate): TaskSchedule {
  const baseline = new Map<ISODate, number>();
  let planEnd: ISODate | null = task.totalHours <= 0 ? task.startDate : null;
  let acc = 0;
  let d = task.startDate;
  for (let i = 0; i < HORIZON_DAYS && task.totalHours - acc > EPS; i++, d = addDays(d, 1)) {
    const h = Math.min(capacityOn(task, d), task.totalHours - acc);
    if (h > 0) {
      baseline.set(d, h);
      acc += h;
      if (task.totalHours - acc <= EPS) planEnd = d;
    }
  }

  const loggedDates = Object.keys(task.logged).filter((k) => task.logged[k] > 0).sort();
  const logged = loggedDates.reduce((sum, k) => sum + task.logged[k], 0);
  const remaining = Math.max(0, task.totalHours - logged);

  const forecast = new Map<ISODate, number>();
  let forecastEnd: ISODate | null = null;
  if (remaining <= EPS) {
    forecastEnd = loggedDates.at(-1) ?? planEnd;
  } else {
    let left = remaining;
    let c = maxDate(today, task.startDate);
    for (let i = 0; i < HORIZON_DAYS && left > EPS; i++, c = addDays(c, 1)) {
      const h = Math.min(Math.max(0, capacityOn(task, c) - (task.logged[c] ?? 0)), left);
      if (h > 0) {
        forecast.set(c, h);
        left -= h;
        if (left <= EPS) forecastEnd = c;
      }
    }
  }

  // Сегодняшний план учитываем, только если за сегодня уже что-то внесли.
  let expected = 0;
  for (const [date, h] of baseline) {
    if (date < today || (date === today && task.logged[today] !== undefined)) expected += h;
  }

  const target = task.deadline ?? planEnd;
  const slip = forecastEnd && target ? workdaysBetween(target, forecastEnd) : null;

  let status: Status;
  if (remaining <= EPS) status = 'done';
  else if (!forecastEnd) status = 'stalled';
  else if (slip !== null && slip > 0) status = 'behind';
  else if (logged === 0 && today <= task.startDate) status = 'notstarted';
  else if (slip !== null && slip < 0) status = 'ahead';
  else status = 'ontrack';

  let first = task.startDate;
  if (loggedDates.length) first = minDate(first, loggedDates[0]);
  let last = task.startDate;
  for (const x of [planEnd, forecastEnd, loggedDates.at(-1) ?? null]) if (x) last = maxDate(last, x);

  return {
    baseline, planEnd, forecast, forecastEnd, logged, remaining, expected,
    deviation: logged - expected,
    progress: task.totalHours > 0 ? Math.min(1, logged / task.totalHours) : 1,
    target, slip, status, first, last,
  };
}

export function visibleRange(tasks: Task[], schedules: Map<string, TaskSchedule>, today: ISODate) {
  let from = today;
  let to = addDays(today, 30);
  for (const t of tasks) {
    const s = schedules.get(t.id)!;
    from = minDate(from, s.first);
    to = maxDate(to, s.last);
    if (t.deadline) to = maxDate(to, t.deadline);
  }
  return { from: startOfWeek(addDays(from, -7)), to: addDays(to, 21) };
}

export const fmtH = (n: number) => String(Math.round(n * 100) / 100).replace('.', ',');
