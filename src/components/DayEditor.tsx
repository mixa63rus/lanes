import { useState, type FormEvent } from 'react';
import { fmtLong, isWeekend, type ISODate } from '../dates';
import { capacityOn, fmtH } from '../schedule';
import type { Task } from '../types';

interface Props {
  task: Task;
  date: ISODate;
  anchor: DOMRect;
  /** Для задачи из группы — сколько часов на этот день выделила очередь; план вручную тогда не меняется. */
  groupPlan?: number;
  /** plan: null — вернуть норму; logged: null — убрать запись. */
  onSave: (plan: number | null, logged: number | null) => void;
  onClose: () => void;
}

const W = 280;
const H = 230;

export const parseHours = (s: string): number | null => {
  const n = Number(s.trim().replace(',', '.'));
  return s.trim() === '' || !Number.isFinite(n) || n < 0 ? null : n;
};

export function DayEditor({ task, date, anchor, groupPlan, onSave, onClose }: Props) {
  const norm = isWeekend(date) ? 0 : task.hoursPerDay;
  const [plan, setPlan] = useState(fmtH(groupPlan ?? capacityOn(task, date)));
  const [logged, setLogged] = useState(task.logged[date] !== undefined ? fmtH(task.logged[date]) : '');

  const left = Math.max(8, Math.min(anchor.left - W / 2 + anchor.width / 2, window.innerWidth - W - 8));
  const top = anchor.bottom + H + 8 < window.innerHeight ? anchor.bottom + 6 : anchor.top - H - 6;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const p = parseHours(plan) ?? norm;
    onSave(groupPlan !== undefined || p === norm ? null : p, parseHours(logged));
  };

  return (
    <div className="backdrop backdrop-clear" onMouseDown={onClose}>
      <form
        className="popover"
        style={{ left, top, width: W }}
        onMouseDown={(e) => e.stopPropagation()}
        onSubmit={submit}
        onKeyDown={(e) => e.key === 'Escape' && onClose()}
      >
        <div className="popover-head">
          <strong>{fmtLong(date)}</strong>
          <span className="muted">{task.title}</span>
        </div>
        {groupPlan === undefined ? (
          <label className="field">
            <span>План, ч <em className="muted">норма {fmtH(norm)}</em></span>
            <input value={plan} onChange={(e) => setPlan(e.target.value)} inputMode="decimal" />
          </label>
        ) : (
          <p className="hint">План {fmtH(groupPlan)} ч — по очереди группы. Меняется через оценки и часы в день группы.</p>
        )}
        <label className="field">
          <span>Отработано, ч</span>
          <div className="row">
            <input autoFocus value={logged} onChange={(e) => setLogged(e.target.value)} inputMode="decimal" placeholder="—" />
            <button type="button" className="btn btn-ghost" onClick={() => setLogged(plan)}>= план</button>
          </div>
        </label>
        <div className="popover-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose}>Отмена</button>
          <button type="submit" className="btn btn-primary">Сохранить</button>
        </div>
      </form>
    </div>
  );
}
