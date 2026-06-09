import { prisma } from '../config/prisma.js';
import {
  buildSeaServiceExperience,
  calculateTotalSeaTime,
} from '../utils/experienceUtils.js';

async function main() {
  const id = process.argv[2];

  const professionals = id
    ? await prisma.professional.findMany({
        where: { id },
        include: { resume: { include: { seaService: true } } },
      })
    : await prisma.professional.findMany({
        take: 10,
        orderBy: { updatedAt: 'desc' },
        include: { resume: { include: { seaService: true } } },
      });

  for (const p of professionals) {
    const logs = p.resume?.seaService || [];
    const total = calculateTotalSeaTime(logs);
    const exp = buildSeaServiceExperience(logs);

    console.log('\n===', p.fullname, '|', p.id, '===');
    console.log('Sea service records:', logs.length);

    logs.forEach((log, i) => {
      console.log(`  [${i + 1}]`, {
        vesselName: log.vesselName,
        vesselType: log.vesselType,
        joiningDate: log.joiningDate,
        tillDate: log.tillDate,
      });
    });

    console.log('Calculated totalMonths:', total.totalMonths);
    console.log('Profile label:', exp.total.label);
    console.log('Experience lines:');
    exp.experienceLines.forEach((line) => console.log('  -', line));
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
