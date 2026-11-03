import { resolve } from 'node:path';
import { buildApp } from './app.ts';
import { openDb } from './db.ts';

const port = Number(process.env.PORT ?? 3001);
const host = process.env.HOST ?? '127.0.0.1';
const dbPath = process.env.DB_PATH ?? resolve('data/lanes.db');

const app = buildApp({
  db: openDb(dbPath),
  staticDir: resolve('dist'),
  logger: { level: process.env.LOG_LEVEL ?? 'info' },
  auth: process.env.LANES_PASSWORD
    ? { user: process.env.LANES_USER ?? 'lanes', password: process.env.LANES_PASSWORD }
    : undefined,
});

app.listen({ port, host }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});
