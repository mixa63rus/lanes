import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import type { Project } from '../src/types.ts';
import { buildApp } from './app.ts';
import { openDb } from './db.ts';

let app: ReturnType<typeof buildApp>;
let project: Project;

const doc = {
  name: 'Тест',
  roles: [{ id: 'r1', name: 'Backend', color: '#10b981' }],
  tasks: [{
    id: 't1', roleId: 'r1', title: 'API', totalHours: 16, startDate: '2026-11-02', hoursPerDay: 8, deadline: null,
    plan: { '2026-11-03': 0 }, logged: { '2026-11-02': 6 },
  }],
};

beforeEach(async () => {
  app = buildApp({ db: openDb(':memory:') });
  const res = await app.inject({ method: 'POST', url: '/api/projects', payload: doc });
  assert.equal(res.statusCode, 201);
  project = res.json();
});

const get = async () => (await app.inject({ method: 'GET', url: `/api/projects/${project.id}` })).json() as Project;

test('создание проекта из документа выдаёт новые id и сохраняет дни', () => {
  assert.equal(project.roles.length, 1);
  assert.notEqual(project.roles[0].id, 'r1');
  const task = project.tasks[0];
  assert.equal(task.roleId, project.roles[0].id);
  assert.deepEqual(task.plan, { '2026-11-03': 0 });
  assert.deepEqual(task.logged, { '2026-11-02': 6 });
});

test('один и тот же документ можно импортировать дважды', async () => {
  const res = await app.inject({ method: 'POST', url: '/api/projects', payload: doc });
  assert.equal(res.statusCode, 201);
  const list = (await app.inject({ method: 'GET', url: '/api/projects' })).json();
  assert.equal(list.length, 2);
});

test('дни: запись, частичный сброс и удаление', async () => {
  const task = project.tasks[0];
  const url = `/api/projects/${project.id}/tasks/${task.id}/days/2026-11-04`;
  assert.equal((await app.inject({ method: 'PUT', url, payload: { plan: 4, logged: 3.5 } })).statusCode, 204);
  let t = (await get()).tasks[0];
  assert.equal(t.plan['2026-11-04'], 4);
  assert.equal(t.logged['2026-11-04'], 3.5);

  await app.inject({ method: 'PUT', url, payload: { plan: null, logged: 3.5 } });
  t = (await get()).tasks[0];
  assert.equal(t.plan['2026-11-04'], undefined);

  await app.inject({ method: 'PUT', url, payload: { plan: null, logged: null } });
  t = (await get()).tasks[0];
  assert.equal(t.logged['2026-11-04'], undefined);
});

test('правка задачи не трогает внесённые часы', async () => {
  const task = project.tasks[0];
  const { plan: _p, logged: _l, ...meta } = task;
  const res = await app.inject({
    method: 'PUT', url: `/api/projects/${project.id}/tasks/${task.id}`, payload: { ...meta, title: 'API v2', totalHours: 24 },
  });
  assert.equal(res.statusCode, 204);
  const t = (await get()).tasks[0];
  assert.equal(t.title, 'API v2');
  assert.deepEqual(t.logged, { '2026-11-02': 6 });
});

test('удаление роли удаляет её задачи', async () => {
  const res = await app.inject({ method: 'PUT', url: `/api/projects/${project.id}/roles`, payload: [] });
  assert.equal(res.statusCode, 204);
  const p = await get();
  assert.equal(p.roles.length, 0);
  assert.equal(p.tasks.length, 0);
});

test('нельзя привязать задачу к роли другого проекта', async () => {
  const other: Project = (await app.inject({ method: 'POST', url: '/api/projects', payload: doc })).json();
  const res = await app.inject({
    method: 'PUT', url: `/api/projects/${project.id}/tasks/new`,
    payload: { roleId: other.roles[0].id, title: 'X', totalHours: 1, startDate: '2026-11-02', hoursPerDay: 8, deadline: null },
  });
  assert.equal(res.statusCode, 400);
});

test('валидация: часы за день не больше 24, дата в формате YYYY-MM-DD', async () => {
  const base = `/api/projects/${project.id}/tasks/${project.tasks[0].id}/days`;
  assert.equal((await app.inject({ method: 'PUT', url: `${base}/2026-11-04`, payload: { plan: null, logged: 25 } })).statusCode, 400);
  assert.equal((await app.inject({ method: 'PUT', url: `${base}/04.11.2026`, payload: { plan: null, logged: 2 } })).statusCode, 400);
});

test('несуществующий проект — 404', async () => {
  assert.equal((await app.inject({ method: 'GET', url: '/api/projects/nope' })).statusCode, 404);
  assert.equal((await app.inject({ method: 'PATCH', url: '/api/projects/nope', payload: { name: 'x' } })).statusCode, 404);
});
