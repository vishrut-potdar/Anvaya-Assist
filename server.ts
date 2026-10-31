import express from 'express';
import http from 'node:http';
import { createServer as createViteServer } from 'vite';
import path from 'node:path';
import fs from 'node:fs';
import { config } from './src/server/config.ts';
import app, { ensureReady } from './src/server/app.ts';

async function startServer() {
  await ensureReady();

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

  const port = config.port;
  httpServer.listen(port, '0.0.0.0', () => {
    console.log(`ProvChain full-stack engine listening on http://0.0.0.0:${port}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start ProvChain server:', err);
  process.exit(1);
});
