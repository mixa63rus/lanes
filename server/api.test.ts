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

test('группа: сохранение очереди, порядок, часы сохраняются при перестановке', async () => {
  const roleId = project.roles[0].id;
  const url = `/api/projects/${project.id}/groups/g1`;
  const body = (tasks: { id: string; title: string; totalHours: number }[]) =>
    ({ roleId, title: 'Спринт', startDate: '2026-11-02', hoursPerDay: 6, tasks });

  let res = await app.inject({ method: 'PUT', url, payload: body([
    { id: 'a', title: 'Мелкая 1', totalHours: 2 },
    { id: 'b', title: 'Мелкая 2', totalHours: 3 },
    { id: 'c', title: 'Крупная', totalHours: 20 },
  ]) });
  assert.equal(res.statusCode, 204);
  let p = await get();
  assert.deepEqual(p.groups, [{ id: 'g1', roleId, title: 'Спринт', startDate: '2026-11-02', hoursPerDay: 6 }]);
  assert.deepEqual(p.tasks.filter((t) => t.groupId === 'g1').map((t) => t.id), ['a', 'b', 'c']);
  assert.equal(p.tasks.find((t) => t.id === 'c')!.hoursPerDay, 6);

  await app.inject({ method: 'PUT', url: `/api/projects/${project.id}/tasks/b/days/2026-11-02`, payload: { plan: null, logged: 3 } });

  // Переставили, убрали «a» — b сохраняет часы, a удалена.
  res = await app.inject({ method: 'PUT', url, payload: body([
    { id: 'c', title: 'Крупная', totalHours: 20 },
    { id: 'b', title: 'Мелкая 2', totalHours: 3 },
  ]) });
  assert.equal(res.statusCode, 204);
  p = await get();
  assert.deepEqual(p.tasks.filter((t) => t.groupId === 'g1').map((t) => t.id), ['c', 'b']);
  assert.deepEqual(p.tasks.find((t) => t.id === 'b')!.logged, { '2026-11-02': 3 });
  assert.equal(p.tasks.length, 3);

  // Удаление группы удаляет её задачи, остальные остаются.
  assert.equal((await app.inject({ method: 'DELETE', url })).statusCode, 204);
  p = await get();
  assert.equal(p.groups.length, 0);
  assert.deepEqual(p.tasks.map((t) => t.title), ['API']);
});

test('группа: роль другого проекта и повторяющиеся id отклоняются', async () => {
  const other: Project = (await app.inject({ method: 'POST', url: '/api/projects', payload: doc })).json();
  const url = `/api/projects/${project.id}/groups/g1`;
  const base = { title: 'G', startDate: '2026-11-02', hoursPerDay: 8 };
  let res = await app.inject({ method: 'PUT', url, payload: { ...base, roleId: other.roles[0].id, tasks: [] } });
  assert.equal(res.statusCode, 400);
  res = await app.inject({ method: 'PUT', url, payload: {
    ...base, roleId: project.roles[0].id,
    tasks: [{ id: 'x', title: 'A', totalHours: 1 }, { id: 'x', title: 'B', totalHours: 1 }],
  } });
  assert.equal(res.statusCode, 400);
  // Чужую задачу в свою группу не забрать.
  res = await app.inject({ method: 'PUT', url, payload: {
    ...base, roleId: project.roles[0].id, tasks: [{ id: other.tasks[0].id, title: 'A', totalHours: 1 }],
  } });
  assert.equal(res.statusCode, 409);
});

test('импорт документа с группами: новые id, порядок и связи сохраняются', async () => {
  const withGroup = {
    ...doc,
    groups: [{ id: 'g', roleId: 'r1', title: 'Очередь', startDate: '2026-11-02', hoursPerDay: 4 }],
    tasks: [
      ...doc.tasks,
      { id: 'q2', roleId: 'r1', title: 'Вторая', totalHours: 3, startDate: '2026-11-02', hoursPerDay: 4, deadline: null, groupId: 'g' },
      { id: 'q1', roleId: 'r1', title: 'Первая', totalHours: 1, startDate: '2026-11-02', hoursPerDay: 4, deadline: null, groupId: 'g' },
    ],
  };
  const p: Project = (await app.inject({ method: 'PUT', url: `/api/projects/${project.id}`, payload: withGroup })).json();
  assert.equal(p.groups.length, 1);
  assert.notEqual(p.groups[0].id, 'g');
  const queue = p.tasks.filter((t) => t.groupId === p.groups[0].id);
  assert.deepEqual(queue.map((t) => t.title), ['Вторая', 'Первая']);
  assert.equal(p.tasks.find((t) => t.title === 'API')!.groupId, null);
});

test('отметка о выполнении: ставится, переживает правку задачи и снимается', async () => {
  const task = project.tasks[0];
  const url = `/api/projects/${project.id}/tasks/${task.id}`;
  assert.equal(task.doneAt, null);
  assert.equal((await app.inject({ method: 'PUT', url: `${url}/done`, payload: { doneAt: '2026-11-02' } })).statusCode, 204);
  assert.equal((await get()).tasks[0].doneAt, '2026-11-02');

  const { plan: _p, logged: _l, groupId: _g, doneAt: _d, ...meta } = task;
  await app.inject({ method: 'PUT', url, payload: { ...meta, title: 'API v2' } });
  assert.equal((await get()).tasks[0].doneAt, '2026-11-02');

  assert.equal((await app.inject({ method: 'PUT', url: `${url}/done`, payload: { doneAt: '02.11.2026' } })).statusCode, 400);
  await app.inject({ method: 'PUT', url: `${url}/done`, payload: { doneAt: null } });
  assert.equal((await get()).tasks[0].doneAt, null);
  assert.equal((await app.inject({ method: 'PUT', url: `/api/projects/${project.id}/tasks/nope/done`, payload: { doneAt: null } })).statusCode, 404);
});

test('пароль: без него и с неверным — 401, с верным — пускает', async () => {
  const locked = buildApp({ db: openDb(':memory:'), auth: { user: 'lanes', password: 'секрет' } });
  const basic = (s: string) => ({ authorization: `Basic ${Buffer.from(s).toString('base64')}` });
  const none = await locked.inject({ url: '/api/projects' });
  assert.equal(none.statusCode, 401);
  assert.match(String(none.headers['www-authenticate']), /^Basic /);
  assert.equal((await locked.inject({ url: '/api/projects', headers: basic('lanes:нет') })).statusCode, 401);
  assert.equal((await locked.inject({ url: '/api/projects', headers: basic('lanes:секрет') })).statusCode, 200);
});
