import express from 'express';
import { initDatabase } from './db.ts';
import { config } from './config.ts';
import { errorHandler } from './errors.ts';

import partnersRoutes from './routes/partners.ts';
import batchesRoutes from './routes/batches.ts';
import eventsRoutes from './routes/events.ts';
import alertsRoutes from './routes/alerts.ts';
import publicRoutes from './routes/public.ts';
import chainRoutes from './routes/chain.ts';
import demoRoutes from './routes/demo.ts';
import workspaceRoutes from './routes/workspace.ts';

// Initialize DB tables once per process. The ledger starts empty; demo data is loaded from Settings.
let ready: Promise<void> | null = null;
export function ensureReady(): Promise<void> {
  ready ??= initDatabase();
  return ready;
}

const app = express();
app.use(express.json({ limit: '500kb' }));
app.use((_req, _res, next) => {
  ensureReady().then(() => next(), next);
});

// Health check endpoint
const health: express.RequestHandler = (_req, res) => {
  res.json({
    ok: true,
    service: 'ProvChain Provenance Ledger API',
    timestamp: new Date().toISOString(),
    // 'shared' = external Postgres; 'in-memory' = per-instance PGlite (data not shared across serverless instances)
    database: config.databaseUrl ? 'shared' : 'in-memory',
    // Names only (never values) of DB-related env vars this instance can see, to debug hosting config
    dbEnvNames: Object.keys(process.env).filter((k) => /DATABASE|POSTGRES|^PG|NEON/i.test(k)).sort(),
    vercelEnv: process.env.VERCEL_ENV || null,
  });
};
app.get('/health', health);
app.get('/api/health', health);

// REST API Routes
app.use('/api/partners', partnersRoutes);
app.use('/api/batches', batchesRoutes);
app.use('/api/events', eventsRoutes);
app.use('/api/alerts', alertsRoutes);
app.use('/api/chain', chainRoutes);
app.use('/api/demo', demoRoutes);
app.use('/api/workspace', workspaceRoutes);
app.use('/api', publicRoutes); // /api/verify/:token, /api/01/..., /api/qr/..., /api/track/...
app.use(errorHandler);

export default app;
