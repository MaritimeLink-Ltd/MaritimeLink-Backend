import jwt from 'jsonwebtoken';
import { prisma } from '../src/config/prisma.js';
import { env } from '../src/config/env.js';

/** Read-only smoke test that pre-existing job routes still behave. */
const main = async () => {
  const baseUrl = process.env.TEST_BASE_URL || 'http://localhost:3001';

  const professional = await prisma.professional.findFirst({
    where: { resume: { isNot: null }, status: 'VERIFIED' },
    orderBy: { updatedAt: 'desc' },
  });
  const token = jwt.sign({ id: professional!.id }, env.JWT_SECRET, {
    expiresIn: '10m',
  });
  const auth = { Authorization: `Bearer ${token}` };

  // Must mirror the public visibility filter, or the detail checks 404 on a
  // job that is correctly hidden (expired or flagged) rather than broken.
  const job = await prisma.job.findFirst({
    where: {
      status: 'ACTIVE',
      isFlagged: false,
      OR: [{ closingDate: null }, { closingDate: { gte: new Date() } }],
    },
    select: { id: true },
  });

  if (!job) {
    console.log('note: no publicly visible job in DB — skipping detail checks');
  }

  const checks: Array<[string, string, HeadersInit?]> = [
    ['public job list', `${baseUrl}/api/jobs`],
    ['professional job list', `${baseUrl}/api/professional/jobs`, auth],
    ['saved jobs', `${baseUrl}/api/professional/jobs/saved`, auth],
    ['external jobs', `${baseUrl}/api/professional/jobs/external`, auth],
    ['applications', `${baseUrl}/api/professional/applications`, auth],
  ];

  if (job) {
    checks.push([
      'professional job detail',
      `${baseUrl}/api/professional/jobs/${job.id}`,
      auth,
    ]);
    checks.push(['public job detail', `${baseUrl}/api/jobs/${job.id}`]);
  }

  let failures = 0;
  for (const [label, url, headers] of checks) {
    try {
      const response = await fetch(url, { headers: headers ?? {} });
      const body = (await response.json()) as Record<string, unknown>;
      const count =
        (body.results as number | undefined) ??
        (body.data ? Object.keys(body.data).length : 0);
      const ok = response.ok && body.status === 'success';
      if (!ok) failures += 1;
      console.log(
        `${ok ? 'PASS' : 'FAIL'}  ${label.padEnd(24)} HTTP ${response.status}  results=${count}`,
      );
      if (!ok) console.log('      body:', JSON.stringify(body).slice(0, 200));
    } catch (error) {
      failures += 1;
      console.log(`FAIL  ${label.padEnd(24)}`, error);
    }
  }

  console.log(failures === 0 ? '\nAll job routes OK' : `\n${failures} failing`);
  await prisma.$disconnect();
  if (failures > 0) process.exit(1);
};

main().catch(async (error) => {
  console.error('FAILED:', error);
  await prisma.$disconnect();
  process.exit(1);
});
