import { randomUUID } from 'node:crypto';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { Router } from 'express';
import { getPrismaClient } from '../config/database.js';
import { assertRequiredEnvironment, loadEnvironment } from '../config/env.js';
import { logError, logInfo } from '../utils/logger.js';

const router = Router();
const environment = loadEnvironment();
assertRequiredEnvironment(environment);

function buildAuthTokens(user) {
  const accessToken = jwt.sign(
    {
      sub: user.id,
      role: user.role,
      email: user.email,
      name: user.name,
    },
    environment.jwtSecret,
    { expiresIn: '15m' }
  );

  const refreshToken = jwt.sign(
    {
      sub: user.id,
      role: user.role,
      tokenId: randomUUID(),
    },
    environment.refreshTokenSecret,
    { expiresIn: '7d' }
  );

  return { accessToken, refreshToken };
}

async function persistRefreshToken(prisma, userId, refreshToken) {
  const tokenHash = await bcrypt.hash(refreshToken, 12);

  await prisma.refreshToken.create({
    data: {
      userId,
      tokenHash,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    },
  });
}

async function findValidRefreshToken(prisma, userId, refreshToken) {
  const tokens = await prisma.refreshToken.findMany({
    where: {
      userId,
      revokedAt: null,
      expiresAt: {
        gt: new Date(),
      },
    },
    orderBy: {
      createdAt: 'desc',
    },
  });

  for (const token of tokens) {
    const matches = await bcrypt.compare(refreshToken, token.tokenHash);
    if (matches) {
      return token;
    }
  }

  return null;
}

router.post('/login', async (req, res) => {
  const prisma = getPrismaClient();
  const { email, password } = req.body || {};

  if (!email || !password) {
    return res.status(400).json({
      ok: false,
      message: 'Email and password are required',
    });
  }

  const user = await prisma.user.findUnique({
    where: { email: String(email).toLowerCase().trim() },
  });

  if (!user || !user.isActive) {
    return res.status(401).json({
      ok: false,
      message: 'Invalid credentials',
    });
  }

  const passwordMatches = await bcrypt.compare(password, user.passwordHash);

  if (!passwordMatches) {
    return res.status(401).json({
      ok: false,
      message: 'Invalid credentials',
    });
  }

  const { accessToken, refreshToken } = buildAuthTokens(user);
  await persistRefreshToken(prisma, user.id, refreshToken);

  await prisma.user.update({
    where: { id: user.id },
    data: {
      lastLoginAt: new Date(),
    },
  });

  logInfo('User logged in', { userId: user.id, role: user.role });

  return res.status(200).json({
    ok: true,
    message: 'Login successful',
    data: {
      accessToken,
      refreshToken,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        isActive: user.isActive,
      },
    },
  });
});

router.post('/register', async (req, res) => {
  const prisma = getPrismaClient();
  const { name, email, password, rollNumber } = req.body || {};

  if (!name || !email || !password) {
    return res.status(400).json({
      ok: false,
      message: 'Name, email and password are required',
    });
  }

  const settings = await prisma.setting.findFirst();
  if (settings && !settings.studentSelfRegistration) {
    return res.status(403).json({
      ok: false,
      message: 'Student registration is currently disabled',
    });
  }

  const normalizedEmail = String(email).toLowerCase().trim();
  const existingUser = await prisma.user.findUnique({
    where: { email: normalizedEmail },
  });

  if (existingUser) {
    return res.status(409).json({
      ok: false,
      message: 'A user with this email already exists',
    });
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const user = await prisma.user.create({
    data: {
      name: String(name).trim(),
      email: normalizedEmail,
      passwordHash,
      role: 'STUDENT',
      isActive: true,
      rollNumber: rollNumber ? String(rollNumber).trim() : null,
    },
  });

  logInfo('Student registered', { userId: user.id, email: user.email });

  return res.status(201).json({
    ok: true,
    message: 'Registration successful',
    data: {
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
      },
    },
  });
});

router.post('/refresh', async (req, res) => {
  const prisma = getPrismaClient();
  const { refreshToken } = req.body || {};

  if (!refreshToken) {
    return res.status(400).json({
      ok: false,
      message: 'Refresh token is required',
    });
  }

  let payload;
  try {
    payload = jwt.verify(refreshToken, environment.refreshTokenSecret);
  } catch (error) {
    return res.status(401).json({
      ok: false,
      message: 'Invalid refresh token',
    });
  }

  const user = await prisma.user.findUnique({
    where: { id: payload.sub },
  });

  if (!user || !user.isActive) {
    return res.status(401).json({
      ok: false,
      message: 'Invalid refresh token',
    });
  }

  const storedToken = await findValidRefreshToken(prisma, user.id, refreshToken);
  if (!storedToken) {
    return res.status(401).json({
      ok: false,
      message: 'Refresh token is not recognized',
    });
  }

  const newTokens = buildAuthTokens(user);

  await prisma.refreshToken.update({
    where: { id: storedToken.id },
    data: {
      revokedAt: new Date(),
    },
  });

  await persistRefreshToken(prisma, user.id, newTokens.refreshToken);

  return res.status(200).json({
    ok: true,
    message: 'Token refreshed',
    data: {
      accessToken: newTokens.accessToken,
      refreshToken: newTokens.refreshToken,
    },
  });
});

router.post('/logout', async (req, res) => {
  const prisma = getPrismaClient();
  const { refreshToken } = req.body || {};

  if (refreshToken) {
    const tokens = await prisma.refreshToken.findMany({
      where: {
        revokedAt: null,
        expiresAt: {
          gt: new Date(),
        },
      },
    });

    for (const token of tokens) {
      const matches = await bcrypt.compare(refreshToken, token.tokenHash);
      if (matches) {
        await prisma.refreshToken.update({
          where: { id: token.id },
          data: {
            revokedAt: new Date(),
          },
        });
        break;
      }
    }
  }

  return res.status(200).json({
    ok: true,
    message: 'Logged out successfully',
  });
});

router.get('/me', async (req, res) => {
  const prisma = getPrismaClient();
  const authHeader = req.headers.authorization || '';
  const [scheme, token] = authHeader.split(' ');

  if (scheme !== 'Bearer' || !token) {
    return res.status(401).json({
      ok: false,
      message: 'Missing bearer token',
    });
  }

  try {
    const payload = jwt.verify(token, environment.jwtSecret);
    const user = await prisma.user.findUnique({
      where: { id: payload.sub },
    });

    if (!user || !user.isActive) {
      return res.status(401).json({
        ok: false,
        message: 'User not found',
      });
    }

    return res.status(200).json({
      ok: true,
      data: {
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
          isActive: user.isActive,
          lastLoginAt: user.lastLoginAt,
        },
      },
    });
  } catch (error) {
    logError('Failed to resolve /me', { message: error.message });
    return res.status(401).json({
      ok: false,
      message: 'Invalid access token',
    });
  }
});

export default router;
