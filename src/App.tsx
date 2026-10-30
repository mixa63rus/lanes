import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { diffDays, todayISO, type ISODate } from './dates';
import { computeSchedule, visibleRange } from './schedule';
import { demoProject, normalize, useProject } from './store';
import type { Role, Task } from './types';
import { DayEditor } from './components/DayEditor';
import { RolesDialog } from './components/RolesDialog';
import { Summary } from './components/Summary';
import { TaskDialog } from './components/TaskDialog';
import { LABEL_W, Timeline } from './components/Timeline';

type Dialog = { kind: 'task'; task: Task | null; roleId?: string } | { kind: 'roles' } | null;
type CellTarget = { taskId: string; date: ISODate; anchor: DOMRect } | null;

const ZOOMS = [
  { label: 'Мелко', col: 22 },
  { label: 'Обычно', col: 40 },
  { label: 'Крупно', col: 60 },
];

export default function App() {
  const [project, setProject] = useProject();
  const [col, setCol] = useState(40);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [cell, setCell] = useState<CellTarget>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const today = todayISO();

  const schedules = useMemo(
    () => new Map(project.tasks.map((t) => [t.id, computeSchedule(t, today)])),
    [project.tasks, today],
  );
  const range = useMemo(() => visibleRange(project.tasks, schedules, today), [project.tasks, schedules, today]);

  const scrollToToday = useCallback(() => {
    const el = scrollRef.current;
    if (el) el.scrollLeft = Math.max(0, diffDays(range.from, today) * col - (el.clientWidth - LABEL_W) / 3);
  }, [range.from, today, col]);
  // Прокручиваем к сегодняшнему дню при открытии и смене масштаба.
  useLayoutEffect(scrollToToday, [col]);

  const patchTask = (id: string, fn: (t: Task) => Task) =>
    setProject((p) => ({ ...p, tasks: p.tasks.map((t) => (t.id === id ? fn(t) : t)) }));

  const saveTask = (task: Task) => {
    setProject((p) => ({
      ...p,
      tasks: p.tasks.some((t) => t.id === task.id) ? p.tasks.map((t) => (t.id === task.id ? task : t)) : [...p.tasks, task],
    }));
    setDialog(null);
  };

  const deleteTask = (id: string) => {
    setProject((p) => ({ ...p, tasks: p.tasks.filter((t) => t.id !== id) }));
    setDialog(null);
  };

  const saveRoles = (roles: Role[]) => {
    setProject((p) => ({ ...p, roles, tasks: p.tasks.filter((t) => roles.some((r) => r.id === t.roleId)) }));
    setDialog(null);
  };

  const saveDay = (taskId: string, date: ISODate, plan: number | null, logged: number | null) => {
    patchTask(taskId, (t) => {
      const nextPlan = { ...t.plan };
      const nextLogged = { ...t.logged };
      if (plan === null) delete nextPlan[date];
      else nextPlan[date] = plan;
      if (logged === null) delete nextLogged[date];
      else nextLogged[date] = logged;
      return { ...t, plan: nextPlan, logged: nextLogged };
    });
    setCell(null);
  };

  const exportJson = () => {
    const blob = new Blob([JSON.stringify(project, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${project.name || 'project'}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const importJson = async (file: File) => {
    try {
      setProject(normalize(JSON.parse(await file.text())));
    } catch (e) {
      alert(`Не удалось импортировать: ${(e as Error).message}`);
    }
  };

  const cellTask = cell && project.tasks.find((t) => t.id === cell.taskId);

  return (
    <div className="app">
      <header className="topbar">
        <input className="project-name" value={project.name}
          onChange={(e) => setProject((p) => ({ ...p, name: e.target.value }))} aria-label="Название проекта" />
        <div className="toolbar">
          <button className="btn btn-primary" onClick={() => setDialog({ kind: 'task', task: null })}>+ Задача</button>
          <button className="btn" onClick={() => setDialog({ kind: 'roles' })}>Роли</button>
          <span className="sep" />
          <div className="segmented">
            {ZOOMS.map((z) => (
              <button key={z.col} className={col === z.col ? 'active' : ''} onClick={() => setCol(z.col)}>{z.label}</button>
            ))}
          </div>
          <button className="btn" onClick={scrollToToday}>Сегодня</button>
          <span className="sep" />
          <button className="btn btn-ghost" onClick={exportJson} title="Скачать проект в JSON">Экспорт</button>
          <button className="btn btn-ghost" onClick={() => fileRef.current?.click()} title="Загрузить проект из JSON">Импорт</button>
          <button className="btn btn-ghost"
            onClick={() => confirm('Заменить текущий проект демо-данными?') && setProject(demoProject())}>Демо</button>
          <input ref={fileRef} type="file" accept="application/json" hidden
            onChange={(e) => { const f = e.target.files?.[0]; if (f) importJson(f); e.target.value = ''; }} />
        </div>
      </header>

      <Summary tasks={project.tasks} schedules={schedules} />

      <Timeline
        project={project}
        schedules={schedules}
        from={range.from}
        to={range.to}
        today={today}
        col={col}
        scrollRef={scrollRef}
        onCellClick={(task, date, anchor) => setCell({ taskId: task.id, date, anchor })}
        onEditTask={(task) => setDialog({ kind: 'task', task })}
        onAddTask={(roleId) => setDialog({ kind: 'task', task: null, roleId })}
      />

      <footer className="legend">
        <span><i className="lg lg-plan" /> план</span>
        <span><i className="lg lg-fill" /> отработано (заливка — доля дневного плана)</span>
        <span><i className="lg lg-missed" /> день плана без факта</span>
        <span><i className="lg lg-slip" /> сдвиг прогноза за план</span>
        <span><i className="lg lg-deadline" /> дедлайн</span>
        <span className="muted">Клик по дню — внести факт или поменять план. Клик по задаче — редактировать.</span>
      </footer>

      {cell && cellTask && (
        <DayEditor key={`${cell.taskId}-${cell.date}`} task={cellTask} date={cell.date} anchor={cell.anchor}
          onSave={(plan, logged) => saveDay(cell.taskId, cell.date, plan, logged)} onClose={() => setCell(null)} />
      )}
      {dialog?.kind === 'task' && (
        <TaskDialog task={dialog.task} roles={project.roles} defaultRoleId={dialog.roleId}
          onSave={saveTask} onDelete={deleteTask} onClose={() => setDialog(null)} />
      )}
      {dialog?.kind === 'roles' && (
        <RolesDialog roles={project.roles} tasks={project.tasks} onSave={saveRoles} onClose={() => setDialog(null)} />
      )}
    </div>
  );
}
