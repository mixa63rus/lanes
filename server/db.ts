import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { Project, ProjectDoc, Role, Task, TaskMeta } from '../src/types.ts';

export interface ProjectSummary {
  id: string;
  name: string;
  updatedAt: string;
}

export function openDb(path: string): DatabaseSync {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(`
    PRAGMA foreign_keys = ON;
    PRAGMA journal_mode = WAL;

    CREATE TABLE IF NOT EXISTS projects (
      id         TEXT PRIMARY KEY,
      name       TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS roles (
      id         TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      name       TEXT NOT NULL,
      color      TEXT NOT NULL,
      position   INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS tasks (
      id            TEXT PRIMARY KEY,
      project_id    TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      role_id       TEXT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
      title         TEXT NOT NULL,
      total_hours   REAL NOT NULL,
      start_date    TEXT NOT NULL,
      hours_per_day REAL NOT NULL,
      deadline      TEXT
    );

    -- plan: ручная правка плана на день (NULL — норма), logged: факт (NULL — не внесён)
    CREATE TABLE IF NOT EXISTS task_days (
      task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      date    TEXT NOT NULL,
      plan    REAL,
      logged  REAL,
      PRIMARY KEY (task_id, date)
    );

    CREATE INDEX IF NOT EXISTS roles_project ON roles(project_id);
    CREATE INDEX IF NOT EXISTS tasks_project ON tasks(project_id);
  `);
  return db;
}

type Row = Record<string, string | number | null>;

export function createRepo(db: DatabaseSync) {
  const now = () => new Date().toISOString();

  function tx<T>(fn: () => T): T {
    db.exec('BEGIN');
    try {
      const result = fn();
      db.exec('COMMIT');
      return result;
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  }

  const touch = (projectId: string) =>
    db.prepare('UPDATE projects SET updated_at = ? WHERE id = ?').run(now(), projectId);

  const exists = (projectId: string) =>
    !!db.prepare('SELECT 1 FROM projects WHERE id = ?').get(projectId);

  function upsertRole(projectId: string, role: Role, position: number): boolean {
    const r = db.prepare(`
      INSERT INTO roles (id, project_id, name, color, position) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET name = excluded.name, color = excluded.color, position = excluded.position
      WHERE roles.project_id = excluded.project_id
    `).run(role.id, projectId, role.name, role.color, position);
    return r.changes > 0;
  }

  function upsertTask(projectId: string, t: TaskMeta): boolean {
    const r = db.prepare(`
      INSERT INTO tasks (id, project_id, role_id, title, total_hours, start_date, hours_per_day, deadline)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        role_id = excluded.role_id, title = excluded.title, total_hours = excluded.total_hours,
        start_date = excluded.start_date, hours_per_day = excluded.hours_per_day, deadline = excluded.deadline
      WHERE tasks.project_id = excluded.project_id
    `).run(t.id, projectId, t.roleId, t.title, t.totalHours, t.startDate, t.hoursPerDay, t.deadline);
    return r.changes > 0;
  }

  function writeDay(taskId: string, date: string, plan: number | null, logged: number | null) {
    if (plan === null && logged === null) {
      db.prepare('DELETE FROM task_days WHERE task_id = ? AND date = ?').run(taskId, date);
    } else {
      db.prepare(`
        INSERT INTO task_days (task_id, date, plan, logged) VALUES (?, ?, ?, ?)
        ON CONFLICT(task_id, date) DO UPDATE SET plan = excluded.plan, logged = excluded.logged
      `).run(taskId, date, plan, logged);
    }
  }

  /** Записывает роли и задачи документа, выдавая им новые id (файл импорта мог прийти из другого проекта). */
  function insertDocument(projectId: string, doc: ProjectDoc) {
    const roleIds = new Map<string, string>();
    doc.roles.forEach((role, i) => {
      const id = randomUUID();
      roleIds.set(role.id, id);
      upsertRole(projectId, { ...role, id }, i);
    });
    for (const task of doc.tasks) {
      const roleId = roleIds.get(task.roleId);
      if (!roleId) continue;
      const id = randomUUID();
      upsertTask(projectId, { ...task, id, roleId });
      for (const date of new Set([...Object.keys(task.plan), ...Object.keys(task.logged)])) {
        writeDay(id, date, task.plan[date] ?? null, task.logged[date] ?? null);
      }
    }
  }

  return {
    listProjects(): ProjectSummary[] {
      return (db.prepare('SELECT id, name, updated_at FROM projects ORDER BY updated_at DESC').all() as Row[])
        .map((r) => ({ id: String(r.id), name: String(r.name), updatedAt: String(r.updated_at) }));
    },

    getProject(id: string): Project | null {
      const p = db.prepare('SELECT id, name FROM projects WHERE id = ?').get(id) as Row | undefined;
      if (!p) return null;
      const roles = (db.prepare('SELECT id, name, color FROM roles WHERE project_id = ? ORDER BY position').all(id) as Row[])
        .map((r) => ({ id: String(r.id), name: String(r.name), color: String(r.color) }));
      const tasks = new Map<string, Task>();
      for (const r of db.prepare('SELECT * FROM tasks WHERE project_id = ? ORDER BY rowid').all(id) as Row[]) {
        tasks.set(String(r.id), {
          id: String(r.id), roleId: String(r.role_id), title: String(r.title),
          totalHours: Number(r.total_hours), startDate: String(r.start_date), hoursPerDay: Number(r.hours_per_day),
          deadline: r.deadline === null ? null : String(r.deadline), plan: {}, logged: {},
        });
      }
      const days = db.prepare(`
        SELECT d.task_id, d.date, d.plan, d.logged FROM task_days d
        JOIN tasks t ON t.id = d.task_id WHERE t.project_id = ?
      `).all(id) as Row[];
      for (const d of days) {
        const task = tasks.get(String(d.task_id))!;
        if (d.plan !== null) task.plan[String(d.date)] = Number(d.plan);
        if (d.logged !== null) task.logged[String(d.date)] = Number(d.logged);
      }
      return { id: String(p.id), name: String(p.name), roles, tasks: [...tasks.values()] };
    },

    createProject(doc: ProjectDoc): Project {
      const id = randomUUID();
      tx(() => {
        db.prepare('INSERT INTO projects (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)').run(id, doc.name, now(), now());
        insertDocument(id, doc);
      });
      return this.getProject(id)!;
    },

    replaceProject(id: string, doc: ProjectDoc): Project | null {
      if (!exists(id)) return null;
      tx(() => {
        db.prepare('DELETE FROM roles WHERE project_id = ?').run(id);
        db.prepare('UPDATE projects SET name = ? WHERE id = ?').run(doc.name, id);
        insertDocument(id, doc);
        touch(id);
      });
      return this.getProject(id);
    },

    renameProject(id: string, name: string): boolean {
      return db.prepare('UPDATE projects SET name = ?, updated_at = ? WHERE id = ?').run(name, now(), id).changes > 0;
    },

    deleteProject(id: string): boolean {
      return db.prepare('DELETE FROM projects WHERE id = ?').run(id).changes > 0;
    },

    /** Полный список ролей проекта: новые добавляются, отсутствующие удаляются вместе с задачами. */
    saveRoles(projectId: string, roles: Role[]): 'ok' | 'not-found' | 'conflict' {
      if (!exists(projectId)) return 'not-found';
      try {
        tx(() => {
          const keep = new Set(roles.map((r) => r.id));
          for (const r of db.prepare('SELECT id FROM roles WHERE project_id = ?').all(projectId) as Row[]) {
            if (!keep.has(String(r.id))) db.prepare('DELETE FROM roles WHERE id = ?').run(r.id);
          }
          roles.forEach((role, i) => {
            if (!upsertRole(projectId, role, i)) throw new Error('conflict');
          });
          touch(projectId);
        });
        return 'ok';
      } catch (e) {
        if ((e as Error).message === 'conflict') return 'conflict';
        throw e;
      }
    },

    saveTask(projectId: string, task: TaskMeta): 'ok' | 'not-found' | 'bad-role' | 'conflict' {
      if (!exists(projectId)) return 'not-found';
      if (!db.prepare('SELECT 1 FROM roles WHERE id = ? AND project_id = ?').get(task.roleId, projectId)) return 'bad-role';
      if (!upsertTask(projectId, task)) return 'conflict';
      touch(projectId);
      return 'ok';
    },

    deleteTask(projectId: string, taskId: string): boolean {
      const ok = db.prepare('DELETE FROM tasks WHERE id = ? AND project_id = ?').run(taskId, projectId).changes > 0;
      if (ok) touch(projectId);
      return ok;
    },

    saveDay(projectId: string, taskId: string, date: string, plan: number | null, logged: number | null): boolean {
      if (!db.prepare('SELECT 1 FROM tasks WHERE id = ? AND project_id = ?').get(taskId, projectId)) return false;
      writeDay(taskId, date, plan, logged);
      touch(projectId);
      return true;
    },
  };
}

export type Repo = ReturnType<typeof createRepo>;
