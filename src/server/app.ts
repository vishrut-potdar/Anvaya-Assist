import express from 'express';
import { initDatabase, withDb } from './db.ts';
import { errorHandler } from './errors.ts';

import partnersRoutes from './routes/partners.ts';
import batchesRoutes from './routes/batches.ts';
import eventsRoutes from './routes/events.ts';
import alertsRoutes from './routes/alerts.ts';
import publicRoutes from './routes/public.ts';
import chainRoutes from './routes/chain.ts';
import demoRoutes, { seedFullDataset } from './routes/demo.ts';

// Initialize DB tables and auto-seed the demo dataset if empty.
// Runs once per process: on boot locally, on cold start on Vercel.
let ready: Promise<void> | null = null;
export function ensureReady(): Promise<void> {
  ready ??= (async () => {
    await initDatabase();
    try {
      await withDb(async (db) => {
        const { rows } = await db.query('SELECT count(*) as count FROM batches');
        if (Number(rows[0]?.count || 0) === 0) {
          console.log('Seeding initial HackNova PS-05 demo batches into ledger...');
          await seedFullDataset();
        }
      });
    } catch (err) {
      console.error('Auto-seed check failed:', err);
    }
  })();
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
    engine: 'PostgreSQL 16 (PGlite/Node)',
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
app.use('/api', publicRoutes); // /api/verify/:token, /api/01/..., /api/qr/..., /api/track/...
app.use(errorHandler);

export default app;
