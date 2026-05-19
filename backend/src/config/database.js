import { PrismaClient } from '@prisma/client';

let prismaClient = null;

export function getPrismaClient() {
  if (!prismaClient) {
    prismaClient = new PrismaClient({
      log: process.env.NODE_ENV === 'production' ? ['error'] : ['query', 'info', 'warn', 'error'],
    });
  }

  return prismaClient;
}

export async function connectDatabase() {
  const prisma = getPrismaClient();
  await prisma.$connect();
  return prisma;
}

export async function disconnectDatabase() {
  if (!prismaClient) {
    return;
  }

  await prismaClient.$disconnect();
  prismaClient = null;
}
