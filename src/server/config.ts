export const config = {
  port: Number(process.env.PORT) || 3000,
  // Neon/Vercel Postgres integrations may expose the connection string under either name
  databaseUrl: process.env.DATABASE_URL || process.env.POSTGRES_URL || '',
  redisUrl: process.env.REDIS_URL || '',
  qrSecret: process.env.QR_SECRET || 'hacknova-provchain-secret-key-32bytes-secure-2026',
  adminKey: process.env.ADMIN_KEY || 'provchain-admin-secret-key',
  publicVerifyUrl: process.env.PUBLIC_VERIFY_URL || '/verify',
  maxTravelKmh: Number(process.env.MAX_TRAVEL_KMH) || 900, // 900 km/h air-plausible for consumer scans
  roadLogisticsMaxKmh: 120, // 120 km/h road logistics
  scanThreshold: Number(process.env.SCAN_THRESHOLD) || 4, // 4+ scans triggers diversity/duplicate scrutiny
};
