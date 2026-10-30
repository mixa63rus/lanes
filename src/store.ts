import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api';
import { addDays, isWeekend, todayISO, type ISODate } from './dates';
import type { Project, ProjectDoc, Role, Task } from './types';

/** Здесь жил проект до появления сервера — переносим его при первом запуске. */
const LEGACY_KEY = 'lanes.project.v1';
const LAST_PROJECT_KEY = 'lanes.lastProject';

export const PALETTE = ['#4f7cff', '#10b981', '#f59e0b', '#a855f7', '#ef4444', '#06b6d4', '#ec4899', '#84cc16'];

export const uid = () => crypto.randomUUID();

/** Приводит произвольный JSON (старый localStorage, импорт) к документу проекта. */
export function normalize(raw: unknown): ProjectDoc {
  const p = (raw ?? {}) as Partial<ProjectDoc>;
  if (!Array.isArray(p.roles) || !Array.isArray(p.tasks)) throw new Error('Неверный формат файла');
  const roles: Role[] = p.roles.map((r) => ({
    id: String(r.id), name: String(r.name ?? 'Роль'), color: String(r.color ?? PALETTE[0]),
  }));
  const tasks: Task[] = p.tasks.map((t) => ({
    id: String(t.id),
    roleId: String(t.roleId),
    title: String(t.title ?? 'Задача'),
    totalHours: Number(t.totalHours) || 0,
    startDate: String(t.startDate),
    hoursPerDay: Number(t.hoursPerDay) || 0,
    deadline: t.deadline ? String(t.deadline) : null,
    plan: { ...(t.plan ?? {}) },
    logged: { ...(t.logged ?? {}) },
  }));
  return { name: String(p.name ?? 'Мой проект'), roles, tasks };
}

function storage(key: string, value?: string | null): string | null {
  try {
    if (value === undefined) return localStorage.getItem(key);
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // хранилище недоступно — не страшно
  }
  return null;
}

function legacyProject(): ProjectDoc | null {
  try {
    const raw = storage(LEGACY_KEY);
    return raw ? normalize(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

/** Открывает последний проект; если на сервере пусто — создаёт из старых данных браузера или демо. */
async function openProject(): Promise<Project> {
  const list = await api.listProjects();
  const last = storage(LAST_PROJECT_KEY);
  const id = list.find((p) => p.id === last)?.id ?? list[0]?.id;
  let project: Project;
  if (id) {
    project = await api.getProject(id);
  } else {
    project = await api.createProject(legacyProject() ?? demoProject());
    storage(LEGACY_KEY, null);
  }
  storage(LAST_PROJECT_KEY, project.id);
  return project;
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * Проект с сервера. Изменения сразу применяются локально и уходят на сервер;
 * при ошибке показываем её и перечитываем проект, чтобы не разойтись с базой.
 */
export function useProjectSync() {
  const [project, setProject] = useState<Project | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const loading = useRef(false);
  const pending = useRef(0);

  const reload = useCallback(async () => {
    if (loading.current || pending.current > 0) return;
    loading.current = true;
    try {
      setProject(await openProject());
      setLoadError(null);
    } catch (e) {
      setLoadError(message(e));
    } finally {
      loading.current = false;
    }
  }, []);

  // Перечитываем при возврате на вкладку — чтобы видеть, что внесли коллеги.
  useEffect(() => {
    reload();
    window.addEventListener('focus', reload);
    return () => window.removeEventListener('focus', reload);
  }, [reload]);

  const projectId = project?.id;

  const sync = (local: (p: Project) => Project, remote: (id: string) => Promise<unknown>) => {
    if (!projectId) return;
    setProject((p) => p && local(p));
    pending.current++;
    remote(projectId)
      .then(() => {
        pending.current--;
      })
      .catch((e) => {
        pending.current--;
        setSaveError(`Не удалось сохранить: ${message(e)}`);
        reload();
      });
  };

  const actions = {
    rename: (name: string) => sync((p) => ({ ...p, name }), (id) => api.renameProject(id, name)),

    saveTask: ({ plan: _plan, logged: _logged, ...meta }: Task) =>
      sync(
        (p) => ({
          ...p,
          tasks: p.tasks.some((t) => t.id === meta.id)
            ? p.tasks.map((t) => (t.id === meta.id ? { ...t, ...meta } : t))
            : [...p.tasks, { ...meta, plan: {}, logged: {} }],
        }),
        (id) => api.saveTask(id, meta),
      ),

    deleteTask: (taskId: string) =>
      sync((p) => ({ ...p, tasks: p.tasks.filter((t) => t.id !== taskId) }), (id) => api.deleteTask(id, taskId)),

    saveRoles: (roles: Role[]) =>
      sync(
        (p) => ({ ...p, roles, tasks: p.tasks.filter((t) => roles.some((r) => r.id === t.roleId)) }),
        (id) => api.saveRoles(id, roles),
      ),

    /** plan: null — вернуть норму; logged: null — убрать запись. */
    saveDay: (taskId: string, date: ISODate, plan: number | null, logged: number | null) =>
      sync(
        (p) => ({
          ...p,
          tasks: p.tasks.map((t) => {
            if (t.id !== taskId) return t;
            const nextPlan = { ...t.plan };
            const nextLogged = { ...t.logged };
            if (plan === null) delete nextPlan[date];
            else nextPlan[date] = plan;
            if (logged === null) delete nextLogged[date];
            else nextLogged[date] = logged;
            return { ...t, plan: nextPlan, logged: nextLogged };
          }),
        }),
        (id) => api.saveDay(id, taskId, date, plan, logged),
      ),

    /** Заменить проект целиком (импорт, демо); id ролей и задач выдаёт сервер. */
    replace: async (doc: ProjectDoc) => {
      if (projectId) setProject(await api.replaceProject(projectId, doc));
    },

    reload,
    dismissError: () => setSaveError(null),
  };

  return { project, loadError, saveError, actions };
}

export type ProjectActions = ReturnType<typeof useProjectSync>['actions'];

/** Факт за рабочие дни с from по вчерашний день; pattern — часы по кругу. */
function logPattern(from: ISODate, today: ISODate, pattern: number[]) {
  const logged: Record<ISODate, number> = {};
  let i = 0;
  for (let d = from; d < today; d = addDays(d, 1)) {
    if (!isWeekend(d)) logged[d] = pattern[i++ % pattern.length];
  }
  return logged;
}

export function demoProject(): ProjectDoc {
  const today = todayISO();
  const roles: Role[] = [
    { id: uid(), name: 'Дизайн', color: PALETTE[3] },
    { id: uid(), name: 'Backend', color: PALETTE[1] },
    { id: uid(), name: 'Frontend', color: PALETTE[0] },
    { id: uid(), name: 'QA', color: PALETTE[2] },
  ];
  const [design, back, front, qa] = roles.map((r) => r.id);
  const s1 = addDays(today, -14);
  const s2 = addDays(today, -9);
  const s3 = addDays(today, -4);
  return {
    name: 'Личный кабинет клиента',
    roles,
    tasks: [
      {
        id: uid(), roleId: design, title: 'Макеты личного кабинета', totalHours: 48,
        startDate: s1, hoursPerDay: 6, deadline: null, plan: {}, logged: logPattern(s1, addDays(s1, 11), [6, 7, 5, 6]),
      },
      {
        id: uid(), roleId: back, title: 'API авторизации и профиля', totalHours: 96,
        startDate: s2, hoursPerDay: 8, deadline: null, plan: {}, logged: logPattern(s2, today, [6, 5, 7, 6]),
      },
      {
        id: uid(), roleId: back, title: 'Интеграция с платёжкой', totalHours: 40,
        startDate: addDays(today, 10), hoursPerDay: 8, deadline: null, plan: {}, logged: {},
      },
      {
        id: uid(), roleId: front, title: 'Экраны личного кабинета', totalHours: 80,
        startDate: s3, hoursPerDay: 6, deadline: addDays(today, 18), plan: {}, logged: logPattern(s3, today, [8, 7, 8]),
      },
      {
        id: uid(), roleId: qa, title: 'Тест-план и регресс', totalHours: 32,
        startDate: addDays(today, 12), hoursPerDay: 4, deadline: addDays(today, 24), plan: {}, logged: {},
      },
    ],
  };
}
