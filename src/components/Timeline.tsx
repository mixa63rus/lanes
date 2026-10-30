import { useMemo, type CSSProperties, type RefObject } from 'react';
import { addDays, dateRange, fmtMonth, fromISO, isWeekend, WEEKDAY, type ISODate } from '../dates';
import { capacityOn, fmtH, type TaskSchedule } from '../schedule';
import type { Project, Role, Task } from '../types';
import { StatusChip } from './StatusChip';

export const LABEL_W = 300;

interface Props {
  project: Project;
  schedules: Map<string, TaskSchedule>;
  from: ISODate;
  to: ISODate;
  today: ISODate;
  col: number;
  scrollRef: RefObject<HTMLDivElement | null>;
  onCellClick: (task: Task, date: ISODate, anchor: DOMRect) => void;
  onEditTask: (task: Task) => void;
  onAddTask: (roleId: string) => void;
}

export function Timeline(props: Props) {
  const { project, from, to, today, col, scrollRef } = props;
  const days = useMemo(() => dateRange(from, to), [from, to]);
  const index = useMemo(() => new Map(days.map((d, i) => [d, i])), [days]);
  const x = (d: ISODate) => (index.get(d) ?? 0) * col;

  const months = useMemo(() => {
    const out: { key: string; label: string; count: number }[] = [];
    for (const d of days) {
      const key = d.slice(0, 7);
      if (out.at(-1)?.key === key) out.at(-1)!.count++;
      else out.push({ key, label: fmtMonth(d), count: 1 });
    }
    return out;
  }, [days]);

  const ctx = { ...props, days, x };

  return (
    <div className="tl-scroll" ref={scrollRef} style={{ '--col': `${col}px`, '--label-w': `${LABEL_W}px` } as CSSProperties}>
      <div className="tl-inner" style={{ width: LABEL_W + days.length * col }}>
        <div className="tl-header">
          <div className="tl-corner">Роли и задачи</div>
          <div>
            <div className="tl-months">
              {months.map((m) => (
                <div key={m.key} className="tl-month" style={{ width: m.count * col }}><span>{m.label}</span></div>
              ))}
            </div>
            <div className="tl-days">
              {days.map((d) => (
                <div key={d} className={dayClass(d, today)}>
                  <span className="tl-dnum">{fromISO(d).getDate()}</span>
                  {col >= 32 && <span className="tl-dow">{WEEKDAY[fromISO(d).getDay()]}</span>}
                </div>
              ))}
            </div>
          </div>
        </div>

        {project.roles.map((role) => {
          const tasks = project.tasks.filter((t) => t.roleId === role.id);
          return (
            <section key={role.id} className="tl-group" style={{ '--c': role.color } as CSSProperties}>
              <RoleRow role={role} tasks={tasks} {...ctx} />
              {tasks.map((t) => <TaskRow key={t.id} task={t} {...ctx} />)}
            </section>
          );
        })}
        {project.roles.length === 0 && (
          <div className="tl-empty">Начните с ролей: нажмите «Роли» и добавьте Frontend, Backend, QA…</div>
        )}
      </div>
    </div>
  );
}

type Ctx = Props & { days: ISODate[]; x: (d: ISODate) => number };

const dayClass = (d: ISODate, today: ISODate, base = 'tl-day') =>
  `${base}${isWeekend(d) ? ' is-weekend' : ''}${d === today ? ' is-today' : ''}`;

function RoleRow({ role, tasks, days, today, col, schedules, onAddTask }: Ctx & { role: Role; tasks: Task[] }) {
  const total = tasks.reduce((s, t) => s + t.totalHours, 0);
  const logged = tasks.reduce((s, t) => s + schedules.get(t.id)!.logged, 0);
  const deviation = tasks.reduce((s, t) => s + schedules.get(t.id)!.deviation, 0);

  // Нагрузка роли по дням: в прошлом — факт, начиная с сегодня — прогноз.
  const load = (d: ISODate) =>
    tasks.reduce((sum, t) => {
      const lg = t.logged[d] ?? 0;
      return sum + (d < today ? lg : lg + (schedules.get(t.id)!.forecast.get(d) ?? 0));
    }, 0);

  return (
    <div className="tl-row tl-role-row">
      <div className="tl-label">
        <span className="role-dot" />
        <span className="role-name">{role.name}</span>
        <span className="role-meta">
          {fmtH(logged)} / {fmtH(total)} ч
          {Math.abs(deviation) >= 0.5 && (
            <span className={deviation < 0 ? 'neg' : 'pos'}> · {deviation > 0 ? '+' : ''}{fmtH(deviation)} ч</span>
          )}
        </span>
        <button className="icon-btn" title="Добавить задачу для роли" onClick={() => onAddTask(role.id)}>+</button>
      </div>
      <div className="tl-track">
        {days.map((d) => {
          const h = load(d);
          return (
            <div key={d} className={dayClass(d, today, 'tl-cell')}>
              {h > 0 && col >= 24 && <span className={`load${d < today ? ' past' : ''}`}>{fmtH(h)}</span>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function TaskRow({ task, days, today, col, x, schedules, onCellClick, onEditTask }: Ctx & { task: Task }) {
  const s = schedules.get(task.id)!;
  const inRange = (d: ISODate) => d >= days[0] && d <= days.at(-1)!;
  const span = (a: ISODate, b: ISODate) => ({ left: x(a) + 2, width: x(b) - x(a) + col - 4 });

  return (
    <div className="tl-row">
      <div className="tl-label tl-task-label" onClick={() => onEditTask(task)} title="Редактировать задачу">
        <div className="task-title">{task.title}</div>
        <div className="task-meta">
          <span>{fmtH(s.logged)} / {fmtH(task.totalHours)} ч</span>
          <StatusChip s={s} hasDeadline={!!task.deadline} />
        </div>
        <div className="task-progress"><div style={{ width: `${s.progress * 100}%` }} /></div>
      </div>

      <div className="tl-track">
        {days.map((d) => {
          const cap = capacityOn(task, d);
          const lg = task.logged[d];
          return (
            <div
              key={d}
              className={dayClass(d, today, 'tl-cell is-clickable')}
              title={`${d}: план ${fmtH(cap)} ч, факт ${lg !== undefined ? fmtH(lg) + ' ч' : '—'}`}
              onClick={(e) => onCellClick(task, d, e.currentTarget.getBoundingClientRect())}
            />
          );
        })}

        <div className="tl-bars">
          {s.planEnd && <div className="bar bar-plan" style={span(task.startDate, s.planEnd)} />}
          {s.planEnd && s.forecastEnd && s.forecastEnd > s.planEnd && (
            <div className="bar bar-slip" style={span(addDays(s.planEnd, 1), s.forecastEnd)} />
          )}

          {days.map((d) => {
            const lg = task.logged[d] ?? 0;
            const base = s.baseline.get(d) ?? 0;
            const fc = s.forecast.get(d) ?? 0;
            const missed = d < today && base > 0 && lg === 0;
            if (lg <= 0 && !missed && fc <= 0) return null;
            const cap = capacityOn(task, d);
            const fill = lg > 0 ? Math.min(1, cap > 0 ? lg / cap : 1) : 0;
            return (
              <div key={d} className="day-piece" style={{ left: x(d) + 2, width: col - 4 }}>
                {fill > 0 && <div className="fill" style={{ height: `${fill * 100}%` }} />}
                {missed && <div className="missed" />}
                {col >= 32 && (
                  <span className={`num${lg > 0 ? ' on-fill' : ''}${fill >= 0.6 ? ' is-solid' : ''}${missed ? ' is-missed' : ''}`}>
                    {lg > 0 ? fmtH(lg) : missed ? '0' : fmtH(fc)}
                  </span>
                )}
              </div>
            );
          })}

          {task.deadline && inRange(task.deadline) && (
            <div className="deadline" style={{ left: x(task.deadline) + col - 1 }} title={`Дедлайн: ${task.deadline}`} />
          )}
        </div>
      </div>
    </div>
  );
}
