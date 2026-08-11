import { prisma } from '../config/prisma.js';

/**
 * One-time pre-launch data reset: wipes all Professional/Recruiter accounts
 * and their activity EXCEPT a fixed keep-list, which is preserved but has
 * its activity (jobs, applications, messages, bookings, etc.) cleared too.
 *
 *   tsx src/scripts/reset-database-keep-accounts.ts            (dry run, counts only)
 *   tsx src/scripts/reset-database-keep-accounts.ts --execute  (actually deletes)
 */

const KEEP_PROFESSIONAL_IDS = [
  '27c3001c-66e9-4657-9b90-d4feea9682c7', // Kingsley Osifo
  '2c0ff773-5bbf-4c00-b090-e8ef8e3f2e3e', // Kingsley Osifo
  '866fa208-4873-4781-968c-efff940f7c62', // Klaudia Osifo
  '8ca9b492-9761-4c6d-9164-6304d9e018c8', // Ifunanya Stella Ezeoye-Ikegwuonu
];

const KEEP_RECRUITER_IDS = [
  '810be24c-cce0-4fa6-baef-c086a4891354', // kingsley.osifo@gotosea.com (RECRUITMENT_AGENT)
  'a03bc6b2-9029-431f-b5be-9973fee27169', // kingsley.osifo@maritimelink.co (RECRUITMENT_AGENT)
  'df5f35b0-9acf-44bd-8821-82f07627935b', // kingbei.dubaimor@maritimelink.co (TRAINING_AGENT)
  'f36fe62a-500c-43d5-b583-4b4f919f93f6', // k.osifo@training.maritimelink.co (TRAINING_AGENT)
];

const dryRun = !process.argv.includes('--execute');

async function main() {
  console.log(
    `[reset] mode: ${dryRun ? 'DRY RUN (no changes will be made)' : 'EXECUTE (changes will be committed)'}`,
  );
  console.log(
    `[reset] keeping ${KEEP_PROFESSIONAL_IDS.length} professionals, ${KEEP_RECRUITER_IDS.length} recruiters/training agents`,
  );

  const totalProfessionals = await prisma.professional.count();
  const totalRecruiters = await prisma.recruiter.count();
  console.log(
    `[reset] current totals: ${totalProfessionals} professionals, ${totalRecruiters} recruiters`,
  );

  const run = async (
    label: string,
    fn: () => Promise<number | { count: number }>,
  ) => {
    const result = await fn();
    const count = typeof result === 'number' ? result : result.count;
    console.log(
      `  ${dryRun ? 'would delete' : 'deleted'} ${count} rows — ${label}`,
    );
    return result;
  };

  await prisma.$transaction(
    async (tx) => {
      console.log('\n--- Phase A: clear activity for KEPT accounts ---');

      await run('Job (posted by kept recruiters)', () =>
        dryRun
          ? tx.job.count({ where: { recruiterId: { in: KEEP_RECRUITER_IDS } } })
          : tx.job.deleteMany({
              where: { recruiterId: { in: KEEP_RECRUITER_IDS } },
            }),
      );

      await run('Course (posted by kept recruiters)', () =>
        dryRun
          ? tx.course.count({
              where: { recruiterId: { in: KEEP_RECRUITER_IDS } },
            })
          : tx.course.deleteMany({
              where: { recruiterId: { in: KEEP_RECRUITER_IDS } },
            }),
      );

      await run('Conversation (kept professionals/recruiters)', () =>
        dryRun
          ? tx.conversation.count({
              where: {
                OR: [
                  { professionalId: { in: KEEP_PROFESSIONAL_IDS } },
                  { recruiterId: { in: KEEP_RECRUITER_IDS } },
                ],
              },
            })
          : tx.conversation.deleteMany({
              where: {
                OR: [
                  { professionalId: { in: KEEP_PROFESSIONAL_IDS } },
                  { recruiterId: { in: KEEP_RECRUITER_IDS } },
                ],
              },
            }),
      );

      await run('Alert (kept professionals)', () =>
        dryRun
          ? tx.alert.count({
              where: { professionalId: { in: KEEP_PROFESSIONAL_IDS } },
            })
          : tx.alert.deleteMany({
              where: { professionalId: { in: KEEP_PROFESSIONAL_IDS } },
            }),
      );

      await run('ProfessionalFeedback (kept professionals)', () =>
        dryRun
          ? tx.professionalFeedback.count({
              where: { professionalId: { in: KEEP_PROFESSIONAL_IDS } },
            })
          : tx.professionalFeedback.deleteMany({
              where: { professionalId: { in: KEEP_PROFESSIONAL_IDS } },
            }),
      );

      await run('ProfessionalDocument (kept professionals)', () =>
        dryRun
          ? tx.professionalDocument.count({
              where: { professionalId: { in: KEEP_PROFESSIONAL_IDS } },
            })
          : tx.professionalDocument.deleteMany({
              where: { professionalId: { in: KEEP_PROFESSIONAL_IDS } },
            }),
      );

      console.log(
        '\n--- Phase B: remove all other Professional/Recruiter accounts entirely ---',
      );

      await run(
        'Professional (not in keep-list) — cascades resume/kyc/jobs/etc.',
        () =>
          dryRun
            ? tx.professional.count({
                where: { id: { notIn: KEEP_PROFESSIONAL_IDS } },
              })
            : tx.professional.deleteMany({
                where: { id: { notIn: KEEP_PROFESSIONAL_IDS } },
              }),
      );

      await run(
        'Recruiter (not in keep-list) — cascades jobs/courses/kyc/etc.',
        () =>
          dryRun
            ? tx.recruiter.count({
                where: { id: { notIn: KEEP_RECRUITER_IDS } },
              })
            : tx.recruiter.deleteMany({
                where: { id: { notIn: KEEP_RECRUITER_IDS } },
              }),
      );

      console.log('\n--- Phase C: wipe global log/moderation tables ---');

      await run('ActivityLog (all)', () =>
        dryRun ? tx.activityLog.count() : tx.activityLog.deleteMany(),
      );

      await run('UserReport (all, cascades ReportNote)', () =>
        dryRun ? tx.userReport.count() : tx.userReport.deleteMany(),
      );

      await run('SupportCase (all, cascades CaseNote)', () =>
        dryRun ? tx.supportCase.count() : tx.supportCase.deleteMany(),
      );
    },
    { timeout: 120_000, maxWait: 20_000 },
  );

  console.log('\n--- Post-check: kept accounts still present ---');
  const keptProfessionals = await prisma.professional.findMany({
    where: { id: { in: KEEP_PROFESSIONAL_IDS } },
    select: {
      id: true,
      email: true,
      resume: { select: { id: true } },
      kyc: { select: { id: true } },
    },
  });
  const keptRecruiters = await prisma.recruiter.findMany({
    where: { id: { in: KEEP_RECRUITER_IDS } },
    select: {
      id: true,
      email: true,
      companyId: true,
      kyc: { select: { id: true } },
    },
  });
  console.table(keptProfessionals);
  console.table(keptRecruiters);

  const remainingProfessionals = await prisma.professional.count();
  const remainingRecruiters = await prisma.recruiter.count();
  console.log(
    `\n[reset] remaining totals: ${remainingProfessionals} professionals, ${remainingRecruiters} recruiters`,
  );

  if (dryRun) {
    console.log(
      '\n[reset] DRY RUN complete — no data was changed. Re-run with --execute to apply.',
    );
  } else {
    console.log('\n[reset] EXECUTE complete — changes committed.');
  }
}

main()
  .catch((err) => {
    console.error('[reset] failed:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
