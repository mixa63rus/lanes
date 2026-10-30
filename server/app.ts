import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyServerOptions } from 'fastify';
import { existsSync } from 'node:fs';
import type { DatabaseSync } from 'node:sqlite';
import type { ProjectDoc, Role, TaskMeta } from '../src/types.ts';
import { createRepo } from './db.ts';

const id = { type: 'string', minLength: 1, maxLength: 64 } as const;
const date = { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' } as const;
const dayHours = { type: 'number', minimum: 0, maximum: 24 } as const;
// Тип-массив, а не anyOf: иначе coerceTypes в Fastify превращает null в 0 или ''.
const nullableDayHours = { type: ['number', 'null'], minimum: 0, maximum: 24 } as const;
const dayMap = { type: 'object', propertyNames: date, additionalProperties: dayHours } as const;

const roleSchema = {
  type: 'object',
  required: ['id', 'name', 'color'],
  properties: {
    id,
    name: { type: 'string', minLength: 1, maxLength: 100 },
    color: { type: 'string', pattern: '^#[0-9a-fA-F]{6}$' },
  },
} as const;

const taskProps = {
  id,
  roleId: id,
  title: { type: 'string', minLength: 1, maxLength: 200 },
  totalHours: { type: 'number', minimum: 0, maximum: 100_000 },
  startDate: date,
  hoursPerDay: { type: 'number', exclusiveMinimum: 0, maximum: 24 },
  deadline: { type: ['string', 'null'], pattern: date.pattern },
} as const;
const taskRequired = ['id', 'roleId', 'title', 'totalHours', 'startDate', 'hoursPerDay', 'deadline'];

const projectName = { type: 'string', minLength: 1, maxLength: 200 } as const;
const documentSchema = {
  type: 'object',
  required: ['name', 'roles', 'tasks'],
  properties: {
    name: projectName,
    roles: { type: 'array', maxItems: 100, items: roleSchema },
    tasks: {
      type: 'array',
      maxItems: 5000,
      items: {
        type: 'object',
        required: taskRequired,
        properties: { ...taskProps, plan: { ...dayMap, default: {} }, logged: { ...dayMap, default: {} } },
      },
    },
  },
} as const;

type ProjectParams = { projectId: string };
type TaskParams = ProjectParams & { taskId: string };
type DayParams = TaskParams & { date: string };

export interface AppOptions {
  db: DatabaseSync;
  /** Папка со сборкой фронтенда; если есть — сервер отдаёт и её. */
  staticDir?: string;
  logger?: FastifyServerOptions['logger'];
}

export function buildApp({ db, staticDir, logger = false }: AppOptions) {
  const app = Fastify({ logger, bodyLimit: 10 * 1024 * 1024 });
  const repo = createRepo(db);
  const notFound = { statusCode: 404, error: 'Not Found', message: 'Проект или задача не найдены' };

  app.register(async (api) => {
    api.get('/health', async () => ({ ok: true }));

    api.get('/projects', async () => repo.listProjects());

    api.post<{ Body: ProjectDoc }>('/projects', { schema: { body: documentSchema } }, async (req, reply) =>
      reply.code(201).send(repo.createProject(req.body)));

    api.get<{ Params: ProjectParams }>('/projects/:projectId', async (req, reply) =>
      repo.getProject(req.params.projectId) ?? reply.code(404).send(notFound));

    api.put<{ Params: ProjectParams; Body: ProjectDoc }>(
      '/projects/:projectId', { schema: { body: documentSchema } },
      async (req, reply) => repo.replaceProject(req.params.projectId, req.body) ?? reply.code(404).send(notFound),
    );

    api.patch<{ Params: ProjectParams; Body: { name: string } }>(
      '/projects/:projectId',
      { schema: { body: { type: 'object', required: ['name'], properties: { name: projectName } } } },
      async (req, reply) =>
        repo.renameProject(req.params.projectId, req.body.name) ? reply.code(204).send() : reply.code(404).send(notFound),
    );

    api.delete<{ Params: ProjectParams }>('/projects/:projectId', async (req, reply) =>
      repo.deleteProject(req.params.projectId) ? reply.code(204).send() : reply.code(404).send(notFound));

    api.put<{ Params: ProjectParams; Body: Role[] }>(
      '/projects/:projectId/roles', { schema: { body: { type: 'array', maxItems: 100, items: roleSchema } } },
      async (req, reply) => {
        const r = repo.saveRoles(req.params.projectId, req.body);
        if (r === 'not-found') return reply.code(404).send(notFound);
        if (r === 'conflict') return reply.code(409).send({ statusCode: 409, error: 'Conflict', message: 'id роли занят' });
        return reply.code(204).send();
      },
    );

    api.put<{ Params: TaskParams; Body: TaskMeta }>(
      '/projects/:projectId/tasks/:taskId',
      { schema: { body: { type: 'object', required: taskRequired.filter((k) => k !== 'id'), properties: taskProps } } },
      async (req, reply) => {
        const r = repo.saveTask(req.params.projectId, { ...req.body, id: req.params.taskId });
        if (r === 'not-found') return reply.code(404).send(notFound);
        if (r === 'bad-role') return reply.code(400).send({ statusCode: 400, error: 'Bad Request', message: 'Роль не из этого проекта' });
        if (r === 'conflict') return reply.code(409).send({ statusCode: 409, error: 'Conflict', message: 'id задачи занят' });
        return reply.code(204).send();
      },
    );

    api.delete<{ Params: TaskParams }>('/projects/:projectId/tasks/:taskId', async (req, reply) =>
      repo.deleteTask(req.params.projectId, req.params.taskId) ? reply.code(204).send() : reply.code(404).send(notFound));

    api.put<{ Params: DayParams; Body: { plan: number | null; logged: number | null } }>(
      '/projects/:projectId/tasks/:taskId/days/:date',
      {
        schema: {
          params: { type: 'object', properties: { date } },
          body: {
            type: 'object',
            required: ['plan', 'logged'],
            properties: { plan: nullableDayHours, logged: nullableDayHours },
          },
        },
      },
      async (req, reply) => {
        const { projectId, taskId, date: day } = req.params;
        return repo.saveDay(projectId, taskId, day, req.body.plan, req.body.logged)
          ? reply.code(204).send()
          : reply.code(404).send(notFound);
      },
    );
  }, { prefix: '/api' });

  if (staticDir && existsSync(staticDir)) {
    app.register(fastifyStatic, { root: staticDir });
    // Всё, что не API и не файл сборки, — страница приложения.
    app.setNotFoundHandler((req, reply) =>
      req.method === 'GET' && !req.url.startsWith('/api/') ? reply.sendFile('index.html') : reply.code(404).send(notFound));
  }

  return app;
}
