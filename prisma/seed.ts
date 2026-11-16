import { prisma } from '../src/config/prisma.js';
import bcrypt from 'bcryptjs';

/**
 * Creates the first SUPER_ADMIN if it doesn't exist yet.
 *
 * The email and password come from the environment — there is deliberately no
 * built-in default password, so a seeded admin can never end up with a value
 * that is published in this repository.
 *
 *   SEED_ADMIN_EMAIL=you@company.com SEED_ADMIN_PASSWORD='<long random>' npx prisma db seed
 */
async function main() {
  const email = (process.env.SEED_ADMIN_EMAIL || '').trim().toLowerCase();
  const password = process.env.SEED_ADMIN_PASSWORD || '';

  if (!email || password.length < 12) {
    throw new Error(
      'Set SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD (at least 12 characters) to seed an admin account.',
    );
  }

  const hashedPassword = await bcrypt.hash(password, 12);

  const admin = await prisma.admin.upsert({
    where: { email },
    update: {},
    create: {
      email,
      password: hashedPassword,
      role: 'SUPER_ADMIN',
    },
    select: { id: true, email: true, role: true },
  });

  console.log({ admin });
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
