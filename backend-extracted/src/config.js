const need = (k) => {
  if (!process.env[k]) throw new Error(`Missing env var ${k} (copy .env.example to .env)`);
  return process.env[k];
};

export const config = {
  port: Number(process.env.PORT) || 4000,
  databaseUrl: need('DATABASE_URL'),
  redisUrl: process.env.REDIS_URL || 'redis://localhost:6379',
  qrSecret: need('QR_SECRET'),
  adminKey: need('ADMIN_KEY'),
  publicVerifyUrl: process.env.PUBLIC_VERIFY_URL || 'http://localhost:3000/verify',
  maxTravelKmh: Number(process.env.MAX_TRAVEL_KMH) || 900,
  scanThreshold: Number(process.env.SCAN_THRESHOLD) || 5,
};
