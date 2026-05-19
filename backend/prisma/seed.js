import bcrypt from 'bcrypt';
import { getPrismaClient, connectDatabase, disconnectDatabase } from '../src/config/database.js';
import { assertRequiredEnvironment, loadEnvironment } from '../src/config/env.js';
import { logError, logInfo } from '../src/utils/logger.js';

const environment = loadEnvironment();
assertRequiredEnvironment(environment);

async function main() {
  const adminName = process.env.ADMIN_NAME || 'Admin';
  const adminEmail = process.env.ADMIN_EMAIL;
  const adminPassword = process.env.ADMIN_PASSWORD;
  const platformName = process.env.PLATFORM_NAME || 'Exam Platform';
  const welcomeMessage = process.env.WELCOME_MESSAGE || 'Welcome to the Exam Platform';

  if (!adminEmail || !adminPassword) {
    throw new Error('ADMIN_EMAIL and ADMIN_PASSWORD are required to seed the admin account.');
  }

  const prisma = await connectDatabase();
  const passwordHash = await bcrypt.hash(adminPassword, 12);

  const existingAdmin = await prisma.user.findUnique({
    where: { email: adminEmail },
  });

  if (existingAdmin) {
    await prisma.user.update({
      where: { email: adminEmail },
      data: {
        name: adminName,
        passwordHash,
        role: 'ADMIN',
        isActive: true,
      },
    });

    logInfo('Admin account updated during seed', { email: adminEmail });
  } else {
    await prisma.user.create({
      data: {
        name: adminName,
        email: adminEmail,
        passwordHash,
        role: 'ADMIN',
        isActive: true,
      },
    });

    logInfo('Admin account created during seed', { email: adminEmail });
  }

  const existingSettings = await prisma.setting.findFirst();

  if (existingSettings) {
    await prisma.setting.update({
      where: { id: existingSettings.id },
      data: {
        platformName,
        welcomeMessage,
      },
    });
  } else {
    const adminRecord = await prisma.user.findUnique({
      where: { email: adminEmail },
    });

    await prisma.setting.create({
      data: {
        platformName,
        welcomeMessage,
        studentSelfRegistration: false,
        maxViolationsBeforeAlert: 3,
        createdById: adminRecord?.id || null,
      },
    });
  }

  logInfo('Seed completed successfully', {
    adminEmail,
    platformName,
  });
}

main()
  .catch((error) => {
    logError('Seed failed', { message: error.message });
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    const prisma = getPrismaClient();
    await prisma.$disconnect().catch(() => undefined);
    await disconnectDatabase().catch(() => undefined);
  });
