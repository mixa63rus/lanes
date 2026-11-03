import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { diffDays, todayISO, type ISODate } from './dates';
import { computeProjectSchedules, groupTasks, lastWorkDate, visibleRange } from './schedule';
import { demoProject, normalize, useProjectSync, type ProjectActions } from './store';
import type { Project, Task, TaskGroup } from './types';
import { DayEditor } from './components/DayEditor';
import { GroupDialog } from './components/GroupDialog';
import { RolesDialog } from './components/RolesDialog';
import { Summary } from './components/Summary';
import { TaskDialog } from './components/TaskDialog';
import { LABEL_W, Timeline } from './components/Timeline';

type Dialog =
  | { kind: 'task'; task: Task | null; roleId?: string }
  | { kind: 'group'; group: TaskGroup | null; roleId?: string }
  | { kind: 'roles' }
  | null;
type CellTarget = { taskId: string; date: ISODate; anchor: DOMRect } | null;

const ZOOMS = [
  { label: 'Мелко', col: 22 },
  { label: 'Обычно', col: 40 },
  { label: 'Крупно', col: 60 },
];

export default function App() {
  const { project, loadError, saveError, actions } = useProjectSync();

  if (!project) {
    return (
      <div className="splash">
        {loadError ? (
          <>
            <p>Не удалось связаться с сервером: {loadError}</p>
            <p className="muted">Проверьте, что бэкенд запущен (<code>npm run dev</code>).</p>
            <button className="btn btn-primary" onClick={actions.reload}>Повторить</button>
          </>
        ) : (
          <p className="muted">Загрузка…</p>
        )}
      </div>
    );
  }

  return <Workspace key={project.id} project={project} saveError={saveError} actions={actions} />;
}

function Workspace({ project, saveError, actions }: { project: Project; saveError: string | null; actions: ProjectActions }) {
  const [col, setCol] = useState(40);
  const [name, setName] = useState(project.name);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [cell, setCell] = useState<CellTarget>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const today = todayISO();

  const schedules = useMemo(() => computeProjectSchedules(project, today), [project, today]);
  const range = useMemo(() => visibleRange(project.tasks, schedules, today), [project.tasks, schedules, today]);

  const scrollToToday = useCallback(() => {
    const el = scrollRef.current;
    if (el) el.scrollLeft = Math.max(0, diffDays(range.from, today) * col - (el.clientWidth - LABEL_W) / 3);
  }, [range.from, today, col]);
  // Прокручиваем к сегодняшнему дню при открытии и смене масштаба.
  useLayoutEffect(scrollToToday, [col]);

  // Название с сервера могло поменяться (перечитали проект) — подхватываем.
  const [syncedName, setSyncedName] = useState(project.name);
  if (project.name !== syncedName) {
    setSyncedName(project.name);
    setName(project.name);
  }

  const commitName = () => {
    const trimmed = name.trim();
    if (!trimmed) setName(project.name);
    else if (trimmed !== project.name) actions.rename(trimmed);
  };

  const closeAfter = <A extends unknown[]>(fn: (...args: A) => void) => (...args: A) => {
    fn(...args);
    setDialog(null);
  };

  const exportJson = () => {
    const { id: _id, ...doc } = project;
    const blob = new Blob([JSON.stringify(doc, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${project.name || 'project'}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const replaceWith = async (load: () => Promise<unknown> | unknown) => {
    try {
      await actions.replace(normalize(await load()));
    } catch (e) {
      alert(`Не удалось загрузить проект: ${(e as Error).message}`);
    }
  };

  const cellTask = cell && project.tasks.find((t) => t.id === cell.taskId);

  /** Клик по задаче из группы открывает группу целиком. */
  const editTask = (task: Task) => {
    const group = task.groupId && project.groups.find((g) => g.id === task.groupId);
    setDialog(group ? { kind: 'group', group } : { kind: 'task', task });
  };

  return (
    <div className="app">
      <header className="topbar">
        <input className="project-name" value={name} aria-label="Название проекта"
          onChange={(e) => setName(e.target.value)} onBlur={commitName}
          onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()} />
        <div className="toolbar">
          <button className="btn btn-primary" onClick={() => setDialog({ kind: 'task', task: null })}>+ Задача</button>
          <button className="btn" onClick={() => setDialog({ kind: 'group', group: null })}
            title="Несколько задач подряд: оценки в часах и лимит часов в день — календарь разложит их сам">+ Группа задач</button>
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
          <button className="btn btn-ghost" onClick={() => fileRef.current?.click()} title="Заменить проект данными из JSON">Импорт</button>
          <button className="btn btn-ghost"
            onClick={() => confirm('Заменить текущий проект демо-данными?') && replaceWith(demoProject)}>Демо</button>
          <input ref={fileRef} type="file" accept="application/json" hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f && confirm(`Заменить текущий проект данными из «${f.name}»?`)) replaceWith(async () => JSON.parse(await f.text()));
              e.target.value = '';
            }} />
        </div>
      </header>

      {saveError && (
        <div className="banner">
          <span>{saveError}. Показаны данные с сервера.</span>
          <button className="icon-btn" onClick={actions.dismissError} title="Скрыть">✕</button>
        </div>
      )}

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
        onEditTask={editTask}
        onAddTask={(roleId) => setDialog({ kind: 'task', task: null, roleId })}
        onEditGroup={(group) => setDialog({ kind: 'group', group })}
        onAddGroup={(roleId) => setDialog({ kind: 'group', group: null, roleId })}
        onToggleDone={(task) => actions.setDone(task.id, task.doneAt ? null : lastWorkDate(task))}
      />

      <footer className="legend">
        <span><i className="lg lg-plan" /> план</span>
        <span><i className="lg lg-fill" /> отработано (заливка — доля дневного плана)</span>
        <span><i className="lg lg-missed" /> день плана без факта</span>
        <span><i className="lg lg-slip" /> сдвиг прогноза за план</span>
        <span><i className="lg lg-deadline" /> дедлайн</span>
        <span><i className="lg lg-done">✓</i> выполнена — остаток оценки не планируется</span>
        <span className="muted">Клик по дню — внести факт или поменять план. Клик по задаче — редактировать. Задачи группы идут по очереди в пределах её часов в день.</span>
      </footer>

      {cell && cellTask && (
        <DayEditor key={`${cell.taskId}-${cell.date}`} task={cellTask} date={cell.date} anchor={cell.anchor}
          groupPlan={cellTask.groupId ? schedules.get(cellTask.id)?.planOn(cell.date) : undefined}
          onSave={(plan, logged) => {
            actions.saveDay(cell.taskId, cell.date, plan, logged);
            setCell(null);
          }}
          onClose={() => setCell(null)} />
      )}
      {dialog?.kind === 'task' && (
        <TaskDialog task={dialog.task} roles={project.roles} defaultRoleId={dialog.roleId}
          onSave={closeAfter(actions.saveTask)} onDelete={closeAfter(actions.deleteTask)} onClose={() => setDialog(null)} />
      )}
      {dialog?.kind === 'group' && (
        <GroupDialog group={dialog.group} roles={project.roles} defaultRoleId={dialog.roleId}
          tasks={dialog.group ? groupTasks(project.tasks, dialog.group.id) : []}
          onSave={closeAfter(actions.saveGroup)} onDelete={closeAfter(actions.deleteGroup)} onClose={() => setDialog(null)} />
      )}
      {dialog?.kind === 'roles' && (
        <RolesDialog roles={project.roles} tasks={project.tasks} onSave={closeAfter(actions.saveRoles)} onClose={() => setDialog(null)} />
      )}
    </div>
  );
}
