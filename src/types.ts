import type { ISODate } from './dates';

export interface Role {
  id: string;
  name: string;
  color: string;
}

export interface Task {
  id: string;
  roleId: string;
  title: string;
  /** Оценка задачи в часах. */
  totalHours: number;
  startDate: ISODate;
  /** Сколько часов в рабочий день планируем тратить по умолчанию. */
  hoursPerDay: number;
  deadline: ISODate | null;
  /** Ручные правки плана на конкретный день (в т.ч. 0 — выходной/отпуск). */
  plan: Record<ISODate, number>;
  /** Фактически отработанные часы по дням. */
  logged: Record<ISODate, number>;
}

/** Поля задачи без дневных записей — их меняют отдельным запросом. */
export type TaskMeta = Omit<Task, 'plan' | 'logged'>;

export interface Project {
  id: string;
  name: string;
  roles: Role[];
  tasks: Task[];
}

/** Проект целиком без id: импорт из файла, демо-данные. */
export type ProjectDoc = Omit<Project, 'id'>;
