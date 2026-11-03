import { fmtShort, maxDate, workdaysBetween, type ISODate } from '../dates';
import { fmtH, type TaskSchedule } from '../schedule';
import type { Task } from '../types';

export function Summary({ tasks, schedules }: { tasks: Task[]; schedules: Map<string, TaskSchedule> }) {
  if (!tasks.length) return null;
  const all = tasks.map((t) => schedules.get(t.id)!);
  const total = all.reduce((s, x) => s + x.scope, 0);
  const logged = all.reduce((s, x) => s + x.logged, 0);
  const deviation = all.reduce((s, x) => s + x.deviation, 0);
  const latest = (pick: (s: TaskSchedule) => ISODate | null) =>
    all.some((s) => !pick(s)) ? null : all.map((s) => pick(s)!).reduce(maxDate);
  const planEnd = latest((s) => s.planEnd);
  const forecastEnd = latest((s) => s.forecastEnd);
  const slip = planEnd && forecastEnd ? workdaysBetween(planEnd, forecastEnd) : null;
  const behind = all.filter((s) => s.status === 'behind' || s.status === 'stalled').length;

  return (
    <div className="summary">
      <div className="card">
        <div className="card-label">Отработано</div>
        <div className="card-value">{fmtH(logged)} <small>/ {fmtH(total)} ч</small></div>
        <div className="task-progress"><div style={{ width: `${total ? (logged / total) * 100 : 0}%` }} /></div>
      </div>
      <div className="card">
        <div className="card-label">Отклонение от плана на сегодня</div>
        <div className={`card-value ${deviation <= -0.5 ? 'neg' : deviation >= 0.5 ? 'pos' : ''}`}>
          {deviation > 0 ? '+' : ''}{fmtH(deviation)} <small>ч</small>
        </div>
      </div>
      <div className="card">
        <div className="card-label">Окончание по плану</div>
        <div className="card-value">{planEnd ? fmtShort(planEnd) : '—'}</div>
      </div>
      <div className="card">
        <div className="card-label">Прогноз окончания</div>
        <div className={`card-value ${slip && slip > 0 ? 'neg' : ''}`}>
          {forecastEnd ? fmtShort(forecastEnd) : '—'}
          {slip !== null && slip !== 0 && <small> ({slip > 0 ? '+' : ''}{slip} раб. дн.)</small>}
        </div>
      </div>
      <div className="card">
        <div className="card-label">Задач с риском</div>
        <div className={`card-value ${behind ? 'neg' : 'pos'}`}>{behind} <small>из {tasks.length}</small></div>
      </div>
    </div>
  );
}
