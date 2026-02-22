import jwt from 'jsonwebtoken';
import { prisma } from '../config/prisma.js';
import { env } from '../config/env.js';

async function generateTestToken() {
  try {
    const professional = await prisma.professional.findUnique({
      where: { email: 'cv-test@example.com' },
    });

    if (!professional) {
      console.error(
        'Professional not found. Please run verify-cv-flow.ts first.',
      );
      process.exit(1);
    }

    const token = jwt.sign({ id: professional.id }, env.JWT_SECRET, {
      expiresIn: '1d',
    });

    console.log('--- BEARER TOKEN START ---');
    console.log(token);
    console.log('--- BEARER TOKEN END ---');
  } catch (error) {
    console.error('Error generating token:', error);
  } finally {
    await prisma.$disconnect();
  }
}

generateTestToken();
