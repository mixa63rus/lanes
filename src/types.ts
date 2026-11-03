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
  /**
   * Группа, в которой задача стоит в очереди. У задач группы план считается по группе:
   * startDate и hoursPerDay берутся из группы, ручные правки плана не действуют.
   */
  groupId: string | null;
  /**
   * Когда задачу отметили выполненной. Выполненная задача закрыта, даже если часов ушло
   * меньше оценки: остаток не планируется, в группе время уходит следующим задачам.
   */
  doneAt: ISODate | null;
  /** Ручные правки плана на конкретный день (в т.ч. 0 — выходной/отпуск). */
  plan: Record<ISODate, number>;
  /** Фактически отработанные часы по дням. */
  logged: Record<ISODate, number>;
}

/** Поля задачи без дневных записей, группы и отметки о выполнении — их меняют отдельными запросами. */
export type TaskMeta = Omit<Task, 'plan' | 'logged' | 'groupId' | 'doneAt'>;

/**
 * Очередь задач одного исполнителя: задачи выполняются по порядку и делят
 * дневной лимит часов — мелкие укладываются по нескольку в день, крупные растягиваются.
 */
export interface TaskGroup {
  id: string;
  roleId: string;
  title: string;
  startDate: ISODate;
  /** Сколько часов в рабочий день готовы тратить на группу. */
  hoursPerDay: number;
}

/** Задача внутри группы при сохранении: остальное берётся из группы. */
export type GroupTaskInput = Pick<Task, 'id' | 'title' | 'totalHours' | 'deadline'>;

export interface Project {
  id: string;
  name: string;
  roles: Role[];
  groups: TaskGroup[];
  /** Задачи группы идут в массиве в порядке очереди. */
  tasks: Task[];
}

/** Проект целиком без id: импорт из файла, демо-данные. */
export type ProjectDoc = Omit<Project, 'id'>;
