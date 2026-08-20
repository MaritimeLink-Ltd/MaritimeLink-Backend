import jwt from 'jsonwebtoken';
import { prisma } from '../src/config/prisma.js';
import { env } from '../src/config/env.js';

/**
 * Read-only end-to-end check of GET /api/professional/jobs/external.
 * Signs a token for an existing professional and calls the running server.
 */
const main = async () => {
  const baseUrl = process.env.TEST_BASE_URL || 'http://localhost:3001';

  const professional = await prisma.professional.findFirst({
    where: { resume: { isNot: null }, status: 'VERIFIED' },
    orderBy: { updatedAt: 'desc' },
  });

  if (!professional) {
    console.error('No verified professional with a resume found.');
    process.exit(1);
  }

  console.log('acting as professional:', professional.id, professional.email);

  const token = jwt.sign({ id: professional.id }, env.JWT_SECRET, {
    expiresIn: '10m',
  });

  const startedAt = Date.now();
  const response = await fetch(`${baseUrl}/api/professional/jobs/external`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const elapsedMs = Date.now() - startedAt;

  console.log(
    'HTTP',
    response.status,
    `(${elapsedMs}ms — should be a fast DB read, no live SerpApi call)`,
  );
  const body = (await response.json()) as Record<string, unknown>;

  const jobs = (body.data as { jobs?: unknown[] })?.jobs ?? [];
  const rows = jobs as Array<Record<string, unknown>>;
  const matchedCount = Number(body.matchedCount) || 0;

  console.log('status      :', body.status);
  console.log('results     :', body.results);
  console.log('matchedCount:', matchedCount);
  console.log('personalized:', body.personalized);

  const describe = (job: Record<string, unknown>) =>
    `[${String(job.matchScore ?? '-').padStart(3)}] ${job.title} — ${job.via}`;

  console.log('\nMATCHED band (top):');
  rows
    .slice(0, matchedCount)
    .slice(0, 5)
    .forEach((job) => console.log('  ', describe(job)));
  console.log('\nMORE MARITIME band (bottom):');
  rows
    .slice(matchedCount)
    .slice(0, 5)
    .forEach((job) => console.log('  ', describe(job)));

  const outOfOrder = rows
    .slice(0, matchedCount)
    .some(
      (job, i, band) =>
        i > 0 && Number(job.matchScore) > Number(band[i - 1].matchScore),
    );
  console.log('\nmatched band sorted by score desc:', !outOfOrder);
  console.log(
    'all matched flagged correctly     :',
    rows.slice(0, matchedCount).every((job) => job.matched === true) &&
      rows.slice(matchedCount).every((job) => job.matched !== true),
  );

  const missingApply = (jobs as Array<Record<string, unknown>>).filter(
    (job) => !job.applyLink,
  ).length;
  console.log('jobs missing applyLink:', missingApply, 'of', jobs.length);

  await prisma.$disconnect();
};

main().catch(async (error) => {
  console.error('FAILED:', error);
  await prisma.$disconnect();
  process.exit(1);
});
