import { useEffect, useState } from 'react';
import { addDays, isWeekend, todayISO, type ISODate } from './dates';
import type { Project, Role, Task } from './types';

const KEY = 'lanes.project.v1';

export const PALETTE = ['#4f7cff', '#10b981', '#f59e0b', '#a855f7', '#ef4444', '#06b6d4', '#ec4899', '#84cc16'];

export const uid = () => crypto.randomUUID();

/** Приводит произвольный JSON (localStorage, импорт) к корректному проекту. */
export function normalize(raw: unknown): Project {
  const p = (raw ?? {}) as Partial<Project>;
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

function loadProject(): Project {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return normalize(JSON.parse(raw));
  } catch {
    // повреждённые данные — начинаем с демо
  }
  return demoProject();
}

export function useProject() {
  const [project, setProject] = useState<Project>(loadProject);
  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(project));
    } catch {
      // хранилище недоступно — работаем в памяти
    }
  }, [project]);
  return [project, setProject] as const;
}

/** Факт за рабочие дни с from по вчерашний день; pattern — часы по кругу. */
function logPattern(from: ISODate, today: ISODate, pattern: number[]) {
  const logged: Record<ISODate, number> = {};
  let i = 0;
  for (let d = from; d < today; d = addDays(d, 1)) {
    if (!isWeekend(d)) logged[d] = pattern[i++ % pattern.length];
  }
  return logged;
}

export function demoProject(): Project {
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
