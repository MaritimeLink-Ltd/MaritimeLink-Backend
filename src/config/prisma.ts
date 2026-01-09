import { PrismaClient } from '../generated/client/index.js';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';
import { env } from './env.js';

const { Pool } = pg;
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

const pool = new Pool({ connectionString: env.DATABASE_URL });
const adapter = new PrismaPg(pool);

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: ['query'],
    adapter,
  });

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;
