import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import dotenv from 'dotenv';
import authRoutes from './routes/auth.routes.js';
import usersRoutes from './routes/users.routes.js';

dotenv.config();

const app = express();
const port = Number(process.env.PORT || 4000);
const nodeEnv = process.env.NODE_ENV || 'development';
const isProduction = nodeEnv === 'production';
const allowedOrigins = (process.env.FRONTEND_URL || 'http://localhost:5173')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

app.disable('x-powered-by');

app.use(
  helmet({
    contentSecurityPolicy: false,
  })
);

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
        return;
      }

      callback(new Error('CORS policy does not allow this origin'));
    },
    credentials: true,
  })
);

app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));
app.use(morgan(isProduction ? 'combined' : 'dev'));

app.use(
  rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 300,
    standardHeaders: true,
    legacyHeaders: false,
  })
);

app.use('/api/auth', authRoutes);
app.use('/api/users', usersRoutes);

app.get('/health', (req, res) => {
  res.status(200).json({
    ok: true,
    service: 'exam-platform-backend',
    environment: nodeEnv,
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  });
});

app.get('/ready', (req, res) => {
  const hasDatabaseUrl = Boolean(process.env.DATABASE_URL);

  res.status(hasDatabaseUrl ? 200 : 503).json({
    ok: hasDatabaseUrl,
    databaseConfigured: hasDatabaseUrl,
    message: hasDatabaseUrl ? 'Service is ready' : 'DATABASE_URL is not configured',
  });
});

app.use((req, res) => {
  res.status(404).json({
    ok: false,
    message: 'Route not found',
  });
});

app.use((err, req, res, next) => {
  const statusCode = err.statusCode || 500;

  if (!isProduction) {
    console.error(err);
  }

  res.status(statusCode).json({
    ok: false,
    message: statusCode === 500 ? 'Internal server error' : err.message,
  });
});

app.listen(port, () => {
  console.log(`Exam Platform backend listening on http://localhost:${port}`);
});
