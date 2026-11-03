import type { ISODate } from './dates';
import type { GroupTaskInput, Project, ProjectDoc, Role, TaskGroup, TaskMeta } from './types';

export interface ProjectSummary {
  id: string;
  name: string;
  updatedAt: string;
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    let message = `${res.status} ${res.statusText}`;
    try {
      message = (await res.json()).message ?? message;
    } catch {
      // ответ не JSON — оставляем статус
    }
    throw new Error(message);
  }
  return (res.status === 204 ? undefined : await res.json()) as T;
}

const p = (projectId: string) => `/projects/${encodeURIComponent(projectId)}`;
const t = (projectId: string, taskId: string) => `${p(projectId)}/tasks/${encodeURIComponent(taskId)}`;

export const api = {
  listProjects: () => request<ProjectSummary[]>('GET', '/projects'),
  getProject: (id: string) => request<Project>('GET', p(id)),
  createProject: (doc: ProjectDoc) => request<Project>('POST', '/projects', doc),
  replaceProject: (id: string, doc: ProjectDoc) => request<Project>('PUT', p(id), doc),
  renameProject: (id: string, name: string) => request<void>('PATCH', p(id), { name }),
  saveRoles: (id: string, roles: Role[]) => request<void>('PUT', `${p(id)}/roles`, roles),
  saveTask: (id: string, { id: taskId, ...task }: TaskMeta) => request<void>('PUT', t(id, taskId), task),
  deleteTask: (id: string, taskId: string) => request<void>('DELETE', t(id, taskId)),
  saveGroup: (id: string, { id: groupId, ...group }: TaskGroup, tasks: GroupTaskInput[]) =>
    request<void>('PUT', `${p(id)}/groups/${encodeURIComponent(groupId)}`, { ...group, tasks }),
  deleteGroup: (id: string, groupId: string) => request<void>('DELETE', `${p(id)}/groups/${encodeURIComponent(groupId)}`),
  setDone: (id: string, taskId: string, doneAt: ISODate | null) =>
    request<void>('PUT', `${t(id, taskId)}/done`, { doneAt }),
  saveDay: (id: string, taskId: string, date: ISODate, plan: number | null, logged: number | null) =>
    request<void>('PUT', `${t(id, taskId)}/days/${date}`, { plan, logged }),
};
