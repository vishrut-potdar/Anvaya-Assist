import { ZodError } from 'zod';

export class HttpError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function errorHandler(err, req, res, _next) {
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.code, message: err.message });
  if (err instanceof ZodError) return res.status(400).json({ error: 'VALIDATION', issues: err.issues });
  // errors raised by our Postgres triggers look like "CODE: message"
  if (err.code === 'P0001') {
    const [code, ...rest] = err.message.split(': ');
    return res.status(409).json({ error: code, message: rest.join(': ') });
  }
  if (err.code === '23505') return res.status(409).json({ error: 'DUPLICATE', message: 'Already exists (duplicate code or replayed signature).' });
  if (err.code === '22P02') return res.status(400).json({ error: 'BAD_ID', message: 'Malformed id.' });
  if (err.status && err.status < 500) return res.status(err.status).json({ error: 'BAD_REQUEST', message: err.message });
  console.error(err);
  res.status(500).json({ error: 'INTERNAL' });
}
