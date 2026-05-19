import bcrypt from 'bcrypt';
import { Router } from 'express';
import { getPrismaClient } from '../config/database.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { logInfo } from '../utils/logger.js';

const router = Router();

function sanitizeUser(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    isActive: user.isActive,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
    lastLoginAt: user.lastLoginAt,
    profilePicUrl: user.profilePicUrl,
    phone: user.phone,
    rollNumber: user.rollNumber,
    department: user.department,
    designation: user.designation,
    batch: user.batch,
    className: user.className,
  };
}

router.get('/', requireAuth, requireRole('ADMIN'), async (req, res) => {
  const prisma = getPrismaClient();
  const { role, search, isActive } = req.query;

  const users = await prisma.user.findMany({
    where: {
      ...(role ? { role: String(role).toUpperCase() } : {}),
      ...(typeof isActive !== 'undefined'
        ? { isActive: String(isActive).toLowerCase() === 'true' }
        : {}),
      ...(search
        ? {
            OR: [
              { name: { contains: String(search), mode: 'insensitive' } },
              { email: { contains: String(search), mode: 'insensitive' } },
              { rollNumber: { contains: String(search), mode: 'insensitive' } },
            ],
          }
        : {}),
    },
    orderBy: {
      createdAt: 'desc',
    },
  });

  return res.status(200).json({
    ok: true,
    data: {
      users: users.map(sanitizeUser),
    },
  });
});

router.post('/teacher', requireAuth, requireRole('ADMIN'), async (req, res) => {
  const prisma = getPrismaClient();
  const { name, email, password, phone, department, designation } = req.body || {};

  if (!name || !email || !password) {
    return res.status(400).json({
      ok: false,
      message: 'Name, email and password are required',
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

  const passwordHash = await bcrypt.hash(String(password), 12);
  const user = await prisma.user.create({
    data: {
      name: String(name).trim(),
      email: normalizedEmail,
      passwordHash,
      role: 'TEACHER',
      isActive: true,
      phone: phone ? String(phone).trim() : null,
      department: department ? String(department).trim() : null,
      designation: designation ? String(designation).trim() : null,
    },
  });

  logInfo('Teacher account created', {
    actorId: req.auth.userId,
    userId: user.id,
  });

  return res.status(201).json({
    ok: true,
    message: 'Teacher account created',
    data: {
      user: sanitizeUser(user),
    },
  });
});

router.patch('/:userId', requireAuth, requireRole('ADMIN'), async (req, res) => {
  const prisma = getPrismaClient();
  const { userId } = req.params;
  const { name, email, isActive, phone, department, designation, batch, className, rollNumber } =
    req.body || {};

  const user = await prisma.user.findUnique({
    where: { id: userId },
  });

  if (!user) {
    return res.status(404).json({
      ok: false,
      message: 'User not found',
    });
  }

  const updatedUser = await prisma.user.update({
    where: { id: userId },
    data: {
      ...(name ? { name: String(name).trim() } : {}),
      ...(email ? { email: String(email).toLowerCase().trim() } : {}),
      ...(typeof isActive === 'boolean' ? { isActive } : {}),
      ...(phone ? { phone: String(phone).trim() } : {}),
      ...(department ? { department: String(department).trim() } : {}),
      ...(designation ? { designation: String(designation).trim() } : {}),
      ...(batch ? { batch: String(batch).trim() } : {}),
      ...(className ? { className: String(className).trim() } : {}),
      ...(rollNumber ? { rollNumber: String(rollNumber).trim() } : {}),
    },
  });

  return res.status(200).json({
    ok: true,
    message: 'User updated successfully',
    data: {
      user: sanitizeUser(updatedUser),
    },
  });
});

router.delete('/:userId', requireAuth, requireRole('ADMIN'), async (req, res) => {
  const prisma = getPrismaClient();
  const { userId } = req.params;

  const user = await prisma.user.findUnique({
    where: { id: userId },
  });

  if (!user) {
    return res.status(404).json({
      ok: false,
      message: 'User not found',
    });
  }

  await prisma.user.update({
    where: { id: userId },
    data: {
      isActive: false,
    },
  });

  return res.status(200).json({
    ok: true,
    message: 'User deactivated successfully',
  });
});

export default router;
