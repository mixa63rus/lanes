import { useMemo, useState, type FormEvent } from 'react';
import { fmtShort, todayISO } from '../dates';
import { computeSchedule } from '../schedule';
import { uid } from '../store';
import type { Role, Task } from '../types';
import { parseHours } from './DayEditor';

interface Props {
  task: Task | null;
  roles: Role[];
  defaultRoleId?: string;
  onSave: (task: Task) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
}

export function TaskDialog({ task, roles, defaultRoleId, onSave, onDelete, onClose }: Props) {
  const [title, setTitle] = useState(task?.title ?? '');
  const [roleId, setRoleId] = useState(task?.roleId ?? defaultRoleId ?? roles[0]?.id ?? '');
  const [total, setTotal] = useState(String(task?.totalHours ?? 40));
  const [start, setStart] = useState(task?.startDate ?? todayISO());
  const [perDay, setPerDay] = useState(String(task?.hoursPerDay ?? 8));
  const [deadline, setDeadline] = useState(task?.deadline ?? '');

  const draft: Task | null = useMemo(() => {
    const t = parseHours(total);
    const p = parseHours(perDay);
    if (!title.trim() || !roleId || !start || t === null || t <= 0 || p === null || p <= 0 || p > 24) return null;
    return {
      id: task?.id ?? uid(), plan: task?.plan ?? {}, logged: task?.logged ?? {},
      title: title.trim(), roleId, totalHours: t, startDate: start, hoursPerDay: p, deadline: deadline || null,
    };
  }, [task, title, roleId, total, start, perDay, deadline]);

  const preview = draft && computeSchedule(draft, todayISO());

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (draft) onSave(draft);
  };

  return (
    <div className="backdrop" onMouseDown={onClose}>
      <form className="dialog" onMouseDown={(e) => e.stopPropagation()} onSubmit={submit}
        onKeyDown={(e) => e.key === 'Escape' && onClose()}>
        <h2>{task ? 'Задача' : 'Новая задача'}</h2>
        {roles.length === 0 ? (
          <p className="muted">Сначала добавьте хотя бы одну роль.</p>
        ) : (
          <>
            <label className="field">
              <span>Название</span>
              <input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Например, экран оплаты" />
            </label>
            <label className="field">
              <span>Роль</span>
              <select value={roleId} onChange={(e) => setRoleId(e.target.value)}>
                {roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
            </label>
            <div className="grid2">
              <label className="field">
                <span>Оценка, ч</span>
                <input value={total} onChange={(e) => setTotal(e.target.value)} inputMode="decimal" />
              </label>
              <label className="field">
                <span>Часов в день</span>
                <input value={perDay} onChange={(e) => setPerDay(e.target.value)} inputMode="decimal" />
              </label>
              <label className="field">
                <span>Начало</span>
                <input type="date" value={start} onChange={(e) => setStart(e.target.value)} />
              </label>
              <label className="field">
                <span>Дедлайн <em className="muted">необязательно</em></span>
                <input type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} />
              </label>
            </div>
            <p className="hint">
              {preview?.planEnd
                ? <>По плану закончим <b>{fmtShort(preview.planEnd)}</b>
                    {preview.forecastEnd && preview.forecastEnd !== preview.planEnd &&
                      <>, по прогнозу — <b>{fmtShort(preview.forecastEnd)}</b></>}.
                    {' '}Выходные не считаются; план на отдельный день меняется кликом по календарю.</>
                : 'Заполните поля, чтобы увидеть дату окончания.'}
            </p>
          </>
        )}
        <div className="dialog-actions">
          {task && (
            <button type="button" className="btn btn-danger"
              onClick={() => confirm(`Удалить задачу «${task.title}»?`) && onDelete(task.id)}>
              Удалить
            </button>
          )}
          <span className="spacer" />
          <button type="button" className="btn btn-ghost" onClick={onClose}>Отмена</button>
          <button type="submit" className="btn btn-primary" disabled={!draft}>Сохранить</button>
        </div>
      </form>
    </div>
  );
}
