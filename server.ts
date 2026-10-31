import express from 'express';
import http from 'node:http';
import { createServer as createViteServer } from 'vite';
import path from 'node:path';
import fs from 'node:fs';
import { config } from './src/server/config.ts';
import { initDatabase } from './src/server/db.ts';
import { errorHandler } from './src/server/errors.ts';

import partnersRoutes from './src/server/routes/partners.ts';
import batchesRoutes from './src/server/routes/batches.ts';
import eventsRoutes from './src/server/routes/events.ts';
import alertsRoutes from './src/server/routes/alerts.ts';
import publicRoutes from './src/server/routes/public.ts';
import chainRoutes from './src/server/routes/chain.ts';
import demoRoutes, { seedFullDataset } from './src/server/routes/demo.ts';
import { withDb } from './src/server/db.ts';

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '500kb' }));

  // Initialize DB tables and triggers
  await initDatabase();

  // Auto-seed initial demo dataset into the ledger if empty
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

  // Health check endpoint
  app.get('/health', (_req, res) => {
    res.json({
      ok: true,
      service: 'ProvChain Provenance Ledger API',
      timestamp: new Date().toISOString(),
      engine: 'PostgreSQL 16 (PGlite/Node)',
    });
  });

  // REST API Routes
  app.use('/api/partners', partnersRoutes);
  app.use('/api/batches', batchesRoutes);
  app.use('/api/events', eventsRoutes);
  app.use('/api/alerts', alertsRoutes);
  app.use('/api/chain', chainRoutes);
  app.use('/api/demo', demoRoutes);
  app.use('/api', publicRoutes); // /api/verify/:token, /api/01/..., /api/qr/...

  const httpServer = http.createServer(app);
  const distPath = path.resolve(process.cwd(), 'dist');
  const hasDist = fs.existsSync(distPath) && fs.existsSync(path.join(distPath, 'index.html'));

  if (hasDist) {
    app.use(express.static(distPath));
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api') || req.path.startsWith('/health')) return next();
      res.sendFile(path.join(distPath, 'index.html'));
    });
  } else {
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: false,
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  app.use(errorHandler);

  const port = config.port;
  httpServer.listen(port, '0.0.0.0', () => {
    console.log(`ProvChain full-stack engine listening on http://0.0.0.0:${port}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start ProvChain server:', err);
  process.exit(1);
});
