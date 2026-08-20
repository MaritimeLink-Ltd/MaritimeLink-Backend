import { prisma } from '../src/config/prisma.js';
import {
  getExternalJobsForProfessional,
  professionalMatchInclude,
} from '../src/services/externalJobs/index.js';

/** Read-only: picks existing professionals and shows what they'd be matched to. */
const main = async () => {
  const professionals = await prisma.professional.findMany({
    where: { resume: { isNot: null } },
    include: professionalMatchInclude,
    take: 3,
    orderBy: { updatedAt: 'desc' },
  });

  console.log('professionals sampled:', professionals.length);

  for (const professional of professionals) {
    console.log('\n=====================================');
    console.log('professional:', professional.id);
    console.log('  profession :', professional.profession);
    console.log(
      '  subcategory:',
      professional.subcategory || professional.resume?.subcategory,
    );
    console.log(
      '  skills     :',
      professional.resume?.skills?.map((s) => s.skillName).slice(0, 6),
    );
    console.log(
      '  seaService :',
      professional.resume?.seaService?.map((s) => s.role).slice(0, 4),
    );
    console.log(
      '  location   :',
      professional.resume?.city,
      professional.resume?.country,
    );

    const result = await getExternalJobsForProfessional(professional);
    console.log(
      `  -> personalized: ${result.personalized} | total: ${result.jobs.length} | matched: ${result.matchedCount}`,
    );
    const describe = (job: (typeof result.jobs)[number]) =>
      `[${String(job.matchScore ?? '-').padStart(3)}] ${job.title} — ${job.via} (${job.provider})`;

    console.log('  -- MATCHED (top of list) --');
    result.jobs
      .slice(0, result.matchedCount)
      .slice(0, 5)
      .forEach((job) => {
        console.log('    ', describe(job));
      });
    console.log('  -- MORE MARITIME JOBS (below) --');
    result.jobs
      .slice(result.matchedCount)
      .slice(0, 5)
      .forEach((job) => {
        console.log('    ', describe(job));
      });
  }

  await prisma.$disconnect();
};

main().catch(async (error) => {
  console.error('FAILED:', error);
  await prisma.$disconnect();
  process.exit(1);
});
