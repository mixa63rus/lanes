import {
  addDays, isWeekend, maxDate, minDate, startOfWeek, toISO, workdaysBetween, type ISODate,
} from './dates';
import type { Project, Task, TaskGroup } from './types';

const HORIZON_DAYS = 3 * 365;
const EPS = 1e-6;

export type Status = 'done' | 'notstarted' | 'ontrack' | 'ahead' | 'behind' | 'stalled';

export interface TaskSchedule {
  /** С какого дня задача стоит в плане (у задачи группы — когда до неё дойдёт очередь). */
  start: ISODate;
  /** Базовый план: сколько часов приходится на каждый день. */
  baseline: Map<ISODate, number>;
  planEnd: ISODate | null;
  /** Прогноз: как распределится оставшаяся работа начиная с сегодня. */
  forecast: Map<ISODate, number>;
  forecastEnd: ISODate | null;
  logged: number;
  remaining: number;
  /**
   * Объём задачи в часах: оценка, а у выполненной — сколько на самом деле ушло.
   * Его и складываем в итогах, чтобы закрытая раньше оценки задача не висела недоделанной.
   */
  scope: number;
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
  /** Плановые часы задачи на день. */
  planOn: (date: ISODate) => number;
}

export function capacityOn(task: Task, date: ISODate): number {
  const override = task.plan[date];
  if (override !== undefined) return override;
  return isWeekend(date) ? 0 : task.hoursPerDay;
}

/**
 * Раскладывает объёмы работ по дням по очереди: следующий начинается, когда закончился
 * предыдущий, и добирает остаток дневной ёмкости. ends[i] — день, когда закончится i-й.
 */
function allocate(amounts: number[], from: ISODate, capacity: (d: ISODate) => number) {
  const days = amounts.map(() => new Map<ISODate, number>());
  const ends: (ISODate | null)[] = amounts.map(() => null);
  let i = 0;
  let left = amounts[0] ?? 0;
  let d = from;
  for (let k = 0; k < HORIZON_DAYS && i < amounts.length; k++, d = addDays(d, 1)) {
    let free = capacity(d);
    while (i < amounts.length) {
      if (left <= EPS) {
        ends[i] ??= d;
        left = amounts[++i] ?? 0;
        continue;
      }
      if (free <= EPS) break;
      const h = Math.min(free, left);
      days[i].set(d, h);
      free -= h;
      left -= h;
      if (left <= EPS) ends[i] = d;
    }
  }
  return { days, ends };
}

const loggedTotal = (task: Task) => Object.values(task.logged).reduce((sum, h) => sum + (h > 0 ? h : 0), 0);
/** Сколько осталось сделать: у выполненной задачи — ничего, сколько бы часов ни было в оценке. */
const remainingOf = (task: Task) => (task.doneAt ? 0 : Math.max(0, task.totalHours - loggedTotal(task)));

function buildSchedule(
  task: Task, today: ISODate, start: ISODate,
  baseline: Map<ISODate, number>, planEnd: ISODate | null,
  forecast: Map<ISODate, number>, forecastEnd: ISODate | null,
  planOn: (d: ISODate) => number,
): TaskSchedule {
  const loggedDates = Object.keys(task.logged).filter((k) => task.logged[k] > 0).sort();
  const logged = loggedTotal(task);
  const remaining = remainingOf(task);
  if (remaining <= EPS) {
    forecast = new Map();
    forecastEnd = task.doneAt ?? loggedDates.at(-1) ?? planEnd;
  }

  // Сегодняшний план учитываем, только если за сегодня уже что-то внесли.
  // Выполненная задача не отстаёт: сэкономленные часы — не долг.
  let expected = 0;
  if (task.doneAt) expected = logged;
  else {
    for (const [date, h] of baseline) {
      if (date < today || (date === today && task.logged[today] !== undefined)) expected += h;
    }
  }

  const target = task.deadline ?? planEnd;
  const slip = forecastEnd && target ? workdaysBetween(target, forecastEnd) : null;

  let status: Status;
  if (remaining <= EPS) status = 'done';
  else if (!forecastEnd) status = 'stalled';
  else if (slip !== null && slip > 0) status = 'behind';
  else if (logged === 0 && today <= start) status = 'notstarted';
  else if (slip !== null && slip < 0) status = 'ahead';
  else status = 'ontrack';

  let first = start;
  if (loggedDates.length) first = minDate(first, loggedDates[0]);
  let last = start;
  for (const x of [planEnd, forecastEnd, loggedDates.at(-1) ?? null]) if (x) last = maxDate(last, x);

  return {
    start, baseline, planEnd, forecast, forecastEnd, logged, remaining, expected,
    scope: task.doneAt ? logged : task.totalHours,
    deviation: logged - expected,
    progress: task.doneAt ? 1 : task.totalHours > 0 ? Math.min(1, logged / task.totalHours) : 1,
    target, slip, status, first, last, planOn,
  };
}

export function computeSchedule(task: Task, today: ISODate): TaskSchedule {
  const cap = (d: ISODate) => capacityOn(task, d);
  const base = allocate([task.totalHours], task.startDate, cap);
  const fc = allocate([remainingOf(task)], maxDate(today, task.startDate), (d) => Math.max(0, cap(d) - (task.logged[d] ?? 0)));
  return buildSchedule(task, today, task.startDate, base.days[0], base.ends[0], fc.days[0], fc.ends[0], cap);
}

/**
 * План группы: задачи идут по очереди и делят дневной лимит группы.
 * Прогноз раскладывает остатки с сегодняшнего дня, так что отставание по одной задаче
 * сдвигает все следующие.
 */
export function computeGroupSchedules(group: TaskGroup, tasks: Task[], today: ISODate): Map<string, TaskSchedule> {
  const cap = (d: ISODate) => (isWeekend(d) ? 0 : group.hoursPerDay);
  const base = allocate(tasks.map((t) => t.totalHours), group.startDate, cap);
  // Выполненные задачи (в т.ч. раньше оценки) освобождают время следующим.
  const remaining = tasks.map(remainingOf);
  const loggedOn = (d: ISODate) => tasks.reduce((sum, t) => sum + (t.logged[d] ?? 0), 0);
  const fc = allocate(remaining, maxDate(today, group.startDate), (d) => Math.max(0, cap(d) - loggedOn(d)));

  return new Map(tasks.map((t, i) => {
    const baseline = base.days[i];
    const start = baseline.keys().next().value ?? base.ends[i] ?? group.startDate;
    return [t.id, buildSchedule(t, today, start, baseline, base.ends[i], fc.days[i], fc.ends[i], (d) => baseline.get(d) ?? 0)];
  }));
}

/** Задачи группы в порядке очереди. */
export const groupTasks = (tasks: Task[], groupId: string) => tasks.filter((t) => t.groupId === groupId);

export function computeProjectSchedules(project: Project, today: ISODate): Map<string, TaskSchedule> {
  const out = new Map<string, TaskSchedule>();
  for (const t of project.tasks) if (!t.groupId) out.set(t.id, computeSchedule(t, today));
  for (const g of project.groups) {
    for (const [id, s] of computeGroupSchedules(g, groupTasks(project.tasks, g.id), today)) out.set(id, s);
  }
  return out;
}

/** Дата по умолчанию для отметки «выполнена»: последний день с внесёнными часами, иначе сегодня. */
export function lastWorkDate(task: Task | null): ISODate {
  const days = task ? Object.keys(task.logged).filter((d) => task.logged[d] > 0).sort() : [];
  return days.at(-1) ?? toISO(new Date());
}

export function visibleRange(tasks: Task[], schedules: Map<string, TaskSchedule>, today: ISODate) {
  let from = today;
  let to = addDays(today, 30);
  for (const t of tasks) {
    const s = schedules.get(t.id);
    if (!s) continue;
    from = minDate(from, s.first);
    to = maxDate(to, s.last);
    if (t.deadline) to = maxDate(to, t.deadline);
  }
  return { from: startOfWeek(addDays(from, -7)), to: addDays(to, 21) };
}

export const fmtH = (n: number) => String(Math.round(n * 100) / 100).replace('.', ',');
