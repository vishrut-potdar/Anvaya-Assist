import { Request, Response, NextFunction } from 'express';

export class HttpError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function errorHandler(err: any, _req: Request, res: Response, _next: NextFunction): void {
  const status = err.status || 500;
  const code = err.code || 'INTERNAL_ERROR';
  const message = err.message || 'An unexpected error occurred';

  if (status >= 500) {
    console.error('Server error:', err);
  }

  res.status(status).json({
    ok: false,
    error: code,
    message,
    details: err.details,
  });
}
