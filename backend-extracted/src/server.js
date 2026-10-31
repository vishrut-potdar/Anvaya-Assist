import express from 'express';
import { config } from './config.js';
import { errorHandler } from './errors.js';
import { startWorker } from './worker.js';
import partners from './routes/partners.js';
import batches from './routes/batches.js';
import events from './routes/events.js';
import alerts from './routes/alerts.js';
import publicRoutes from './routes/public.js';

const app = express();
app.use(express.json({ limit: '100kb' }));

app.get('/health', (_req, res) => res.json({ ok: true }));
app.use('/api/partners', partners);
app.use('/api/batches', batches);
app.use('/api/events', events);
app.use('/api/alerts', alerts);
app.use('/api', publicRoutes); // /api/verify/:token, /api/qr/:token
app.use(errorHandler);

startWorker(); // event-driven anomaly checks (same process for now; split later if needed)
app.listen(config.port, () => console.log(`API listening on :${config.port}`));
