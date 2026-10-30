# Lanes

Календарь-график выполнения задач по проекту. У каждой роли (Frontend, Backend, QA…) свои полосы задач на общем таймлайне: план по часам, факт по дням, прогноз окончания и отставание от графика.

## Запуск

Нужен Node.js 22.18+ (TypeScript на сервере запускается без сборки, база — встроенный SQLite).

```bash
npm install
npm run dev        # API на :3001 + фронтенд на :5173 (запросы /api проксируются)
```

Продакшн-режим — один процесс отдаёт и API, и собранный фронтенд:

```bash
npm run build
npm start          # http://localhost:3001
```

Переменные окружения: `PORT` (3001), `HOST` (127.0.0.1), `DB_PATH` (`data/lanes.db`), `LOG_LEVEL` (info).

Тесты API: `npm test`.

## API

| Метод | Путь | Что делает |
|---|---|---|
| GET | `/api/projects` | список проектов |
| POST | `/api/projects` | создать проект из документа `{name, roles, tasks}` |
| GET | `/api/projects/:id` | проект целиком: роли, задачи, план и факт по дням |
| PUT | `/api/projects/:id` | заменить проект документом (импорт) |
| PATCH | `/api/projects/:id` | переименовать `{name}` |
| DELETE | `/api/projects/:id` | удалить проект |
| PUT | `/api/projects/:id/roles` | полный список ролей; отсутствующие удаляются вместе с задачами |
| PUT | `/api/projects/:id/tasks/:taskId` | создать или изменить задачу (без дневных записей) |
| DELETE | `/api/projects/:id/tasks/:taskId` | удалить задачу |
| PUT | `/api/projects/:id/tasks/:taskId/days/:date` | `{plan, logged}` за день; `null` — норма / нет записи |

Проекты, созданные или заменённые из документа, получают новые id ролей и задач.
