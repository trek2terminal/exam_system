import dotenv from 'dotenv';

dotenv.config();

const DEFAULT_ALLOWED_ORIGINS = ['http://localhost:5173'];

function parseCsv(value, fallback = []) {
  if (!value) {
    return fallback;
  }

  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

export function loadEnvironment() {
  const nodeEnv = process.env.NODE_ENV || 'development';
  const port = Number(process.env.PORT || 4000);
  const allowedOrigins = parseCsv(process.env.FRONTEND_URL, DEFAULT_ALLOWED_ORIGINS);
  const databaseUrl = process.env.DATABASE_URL || '';
  const jwtSecret = process.env.JWT_SECRET || '';
  const refreshTokenSecret = process.env.REFRESH_TOKEN_SECRET || '';

  return {
    nodeEnv,
    isProduction: nodeEnv === 'production',
    port,
    allowedOrigins,
    databaseUrl,
    jwtSecret,
    refreshTokenSecret,
    databaseProvider: process.env.DATABASE_PROVIDER || 'sqlite',
  };
}

export function assertRequiredEnvironment(environment) {
  const missing = [];

  if (!environment.databaseUrl) {
    missing.push('DATABASE_URL');
  }

  if (!environment.jwtSecret) {
    missing.push('JWT_SECRET');
  }

  if (!environment.refreshTokenSecret) {
    missing.push('REFRESH_TOKEN_SECRET');
  }

  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }
}

export function getCorsOrigins(environment) {
  return environment.allowedOrigins.length > 0 ? environment.allowedOrigins : DEFAULT_ALLOWED_ORIGINS;
}
