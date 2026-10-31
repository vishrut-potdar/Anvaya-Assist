import { Request, Response, NextFunction } from 'express';
import { withDb } from './db.ts';
import { config } from './config.ts';
import { sha256 } from './crypto.ts';
import { HttpError } from './errors.ts';

declare global {
  namespace Express {
    interface Request {
      partner?: {
        id: string;
        name: string;
        role: 'manufacturer' | 'logistics' | 'distributor' | 'retailer' | 'regulator';
        public_key: string;
      };
    }
  }
}

export async function requireAuth(req: Request, _res: Response, next: NextFunction): Promise<void> {
  const apiKey = req.header('x-api-key');
  if (!apiKey) {
    return next(new HttpError(401, 'MISSING_API_KEY', 'x-api-key header required'));
  }

  try {
    const keyHash = sha256(apiKey);
    const partner = await withDb(async (db) => {
      const res = await db.query(
        'SELECT id, name, role, public_key FROM partners WHERE api_key_hash = $1',
        [keyHash]
      );
      return res.rows[0];
    });

    if (!partner) {
      return next(new HttpError(401, 'INVALID_API_KEY', 'Partner not recognized'));
    }

    req.partner = partner;
    next();
  } catch (err) {
    next(err);
  }
}

export function requireRole(...roles: string[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.partner) {
      return next(new HttpError(401, 'UNAUTHORIZED', 'Authentication required'));
    }
    if (!roles.includes(req.partner.role)) {
      return next(
        new HttpError(
          403,
          'FORBIDDEN',
          `Role '${req.partner.role}' is not authorized. Required: ${roles.join(' or ')}`
        )
      );
    }
    next();
  };
}

export function requireAdmin(req: Request, _res: Response, next: NextFunction): void {
  const adminKey = req.header('x-admin-key');
  if (adminKey !== config.adminKey) {
    return next(new HttpError(401, 'ADMIN_ONLY', 'Invalid or missing x-admin-key'));
  }
  next();
}
