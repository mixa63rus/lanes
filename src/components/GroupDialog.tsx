import { useMemo, useRef, useState, type FormEvent } from 'react';
import { fmtShort, todayISO, type ISODate } from '../dates';
import { computeGroupSchedules, fmtH } from '../schedule';
import { uid } from '../store';
import type { GroupTaskInput, Role, Task, TaskGroup } from '../types';
import { parseHours } from './DayEditor';

interface Props {
  group: TaskGroup | null;
  /** Задачи группы в порядке очереди. */
  tasks: Task[];
  roles: Role[];
  defaultRoleId?: string;
  onSave: (group: TaskGroup, tasks: GroupTaskInput[]) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
}

interface Line {
  id: string;
  title: string;
  hours: string;
  deadline: ISODate | null;
}

const blank = (): Line => ({ id: uid(), title: '', hours: '', deadline: null });
const isBlank = (l: Line) => !l.title.trim() && !l.hours.trim();

const fmtSpan = (a: ISODate, b: ISODate) => (a === b ? fmtShort(a) : `${fmtShort(a)} – ${fmtShort(b)}`);

export function GroupDialog({ group, tasks, roles, defaultRoleId, onSave, onDelete, onClose }: Props) {
  const [title, setTitle] = useState(group?.title ?? '');
  const [roleId, setRoleId] = useState(group?.roleId ?? defaultRoleId ?? roles[0]?.id ?? '');
  const [start, setStart] = useState(group?.startDate ?? todayISO());
  const [perDay, setPerDay] = useState(String(group?.hoursPerDay ?? 8));
  // Последняя строка всегда пустая: начали в ней печатать — появляется следующая.
  const [lines, setLines] = useState<Line[]>(() => [
    ...tasks.map((t) => ({ id: t.id, title: t.title, hours: fmtH(t.totalHours), deadline: t.deadline })),
    blank(),
  ]);
  const listRef = useRef<HTMLDivElement>(null);
  const byId = useMemo(() => new Map(tasks.map((t) => [t.id, t])), [tasks]);

  const patch = (id: string, p: Partial<Line>) =>
    setLines((ls) => {
      const next = ls.map((l) => (l.id === id ? { ...l, ...p } : l));
      return isBlank(next.at(-1)!) ? next : [...next, blank()];
    });
  const move = (i: number, dir: -1 | 1) =>
    setLines((ls) => {
      const next = [...ls];
      [next[i], next[i + dir]] = [next[i + dir], next[i]];
      return next;
    });
  const remove = (l: Line) => {
    const logged = Object.values(byId.get(l.id)?.logged ?? {}).reduce((s, h) => s + h, 0);
    if (logged > 0 && !confirm(`По задаче «${l.title}» уже внесено ${fmtH(logged)} ч. Удалить её?`)) return;
    setLines((ls) => {
      const next = ls.filter((x) => x.id !== l.id);
      return next.length && isBlank(next.at(-1)!) ? next : [...next, blank()];
    });
  };
  /** Enter в поле часов — к названию следующей задачи. */
  const focusNext = (i: number) =>
    requestAnimationFrame(() => listRef.current?.querySelectorAll<HTMLInputElement>('.gl-title')[i + 1]?.focus());

  const filled = lines.filter((l) => !isBlank(l));
  const parsed = filled.map((l) => ({ line: l, hours: parseHours(l.hours) }));
  const invalid = new Set(parsed.filter((p) => !p.line.title.trim() || p.hours === null || p.hours <= 0).map((p) => p.line.id));
  const hpd = parseHours(perDay);

  const draft = useMemo(() => {
    if (!roleId || !start || hpd === null || hpd <= 0 || hpd > 24 || !filled.length || invalid.size) return null;
    const g: TaskGroup = { id: group?.id ?? uid(), roleId, title: title.trim() || 'Группа задач', startDate: start, hoursPerDay: hpd };
    const queue: GroupTaskInput[] = parsed.map(({ line, hours }) => ({
      id: line.id, title: line.title.trim(), totalHours: hours!, deadline: line.deadline,
    }));
    return { group: g, queue };
  }, [group, roleId, title, start, hpd, lines]);

  const preview = useMemo(() => {
    if (!draft) return null;
    const asTasks: Task[] = draft.queue.map((q) => ({
      ...q, roleId: draft.group.roleId, startDate: draft.group.startDate, hoursPerDay: draft.group.hoursPerDay,
      groupId: draft.group.id, doneAt: byId.get(q.id)?.doneAt ?? null, plan: {}, logged: byId.get(q.id)?.logged ?? {},
    }));
    return computeGroupSchedules(draft.group, asTasks, todayISO());
  }, [draft, byId]);

  const totalHours = parsed.reduce((s, p) => s + (p.hours ?? 0), 0);
  const ends = preview && [...preview.values()];
  const planEnd = ends?.every((s) => s.planEnd) ? ends.map((s) => s.planEnd!).reduce((a, b) => (a > b ? a : b)) : null;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (draft) onSave(draft.group, draft.queue);
  };

  return (
    <div className="backdrop" onMouseDown={onClose}>
      <form className="dialog dialog-wide" onMouseDown={(e) => e.stopPropagation()} onSubmit={submit}
        onKeyDown={(e) => e.key === 'Escape' && onClose()}>
        <h2>{group ? 'Группа задач' : 'Новая группа задач'}</h2>
        {roles.length === 0 ? (
          <p className="muted">Сначала добавьте хотя бы одну роль.</p>
        ) : (
          <>
            <div className="grid2">
              <label className="field">
                <span>Название группы</span>
                <input autoFocus={!group} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Например, спринт 12 — Иван" />
              </label>
              <label className="field">
                <span>Роль</span>
                <select value={roleId} onChange={(e) => setRoleId(e.target.value)}>
                  {roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                </select>
              </label>
              <label className="field">
                <span>Начинаю</span>
                <input type="date" value={start} onChange={(e) => setStart(e.target.value)} />
              </label>
              <label className="field">
                <span>Готов работать, ч в день</span>
                <input value={perDay} onChange={(e) => setPerDay(e.target.value)} inputMode="decimal" />
              </label>
            </div>

            <div className="field">
              <span>Задачи по порядку выполнения <em className="muted">{fmtH(totalHours)} ч</em></span>
              <div className="group-lines" ref={listRef}>
                {lines.map((l, i) => {
                  const last = i === lines.length - 1;
                  const s = preview?.get(l.id);
                  const doneAt = byId.get(l.id)?.doneAt;
                  return (
                    <div key={l.id} className={`group-line${invalid.has(l.id) ? ' is-invalid' : ''}${doneAt ? ' is-done' : ''}`}>
                      <span className="gl-num">{last ? '+' : i + 1}</span>
                      <input className="gl-title" value={l.title} placeholder={last ? 'Новая задача' : 'Название'}
                        autoFocus={!!group && last && lines.length === 1}
                        onChange={(e) => patch(l.id, { title: e.target.value })}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            (e.currentTarget.nextElementSibling as HTMLInputElement | null)?.focus();
                          }
                        }} />
                      <input className="gl-hours" value={l.hours} placeholder="ч" inputMode="decimal" aria-label="Оценка, ч"
                        onChange={(e) => patch(l.id, { hours: e.target.value })}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            focusNext(i);
                          }
                        }} />
                      <span className="gl-when" title={s?.forecastEnd && s.forecastEnd !== s.planEnd ? `По прогнозу — ${fmtShort(s.forecastEnd)}` : undefined}>
                        {doneAt ? `✓ ${fmtShort(doneAt)}` : s?.status === 'done' ? 'готово' : s?.planEnd ? fmtSpan(s.start, s.planEnd) : ''}
                      </span>
                      {last ? <span className="gl-actions" /> : (
                        <span className="gl-actions">
                          <button type="button" className="icon-btn" disabled={i === 0} onClick={() => move(i, -1)} title="Раньше">↑</button>
                          <button type="button" className="icon-btn" disabled={i >= lines.length - 2} onClick={() => move(i, 1)} title="Позже">↓</button>
                          <button type="button" className="icon-btn danger" onClick={() => remove(l)} title="Убрать">✕</button>
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            <p className="hint">
              {invalid.size
                ? 'У каждой задачи нужны название и оценка в часах больше нуля.'
                : planEnd
                  ? <>Задачи пойдут по очереди, по {fmtH(hpd ?? 0)} ч в рабочий день: мелкие займут один день вместе,
                      крупные растянутся. Всё закончим <b>{fmtShort(planEnd)}</b>.
                      {' '}Выполненную задачу отмечайте галочкой в календаре — её остаток уйдёт следующим.</>
                  : 'Добавьте задачи и их оценку — календарь разложит их по дням сам.'}
            </p>
          </>
        )}
        <div className="dialog-actions">
          {group && (
            <button type="button" className="btn btn-danger"
              onClick={() => confirm(`Удалить группу «${group.title}» вместе с ${tasks.length} задачами?`) && onDelete(group.id)}>
              Удалить группу
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
