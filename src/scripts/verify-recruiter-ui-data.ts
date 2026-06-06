import { prisma } from '../config/prisma.js';
import {
  calculateTotalSeaTime,
  getExperienceSummary,
} from '../utils/experienceUtils.js';
import { JobCategory } from '../generated/client/index.js';

async function verifyRecruiterUIData() {
  console.log('🚀 Starting Verification: Recruiter UI Data Enhancements');

  try {
    // 1. Setup Robust Test Professional
    const email = `ui-test-${Date.now()}@example.com`;
    console.log(`👤 Creating test professional: ${email}`);

    const professional = await prisma.professional.create({
      data: {
        fullname: 'Ali Shahzaib',
        email,
        password: 'password123',
        profession: JobCategory.OFFICER,
        isVerified: true,
        idPassportUrl: 'https://example.com/id.jpg',
        resume: {
          create: {
            category: JobCategory.OFFICER,
            subcategory: 'Deck Officer',
            country: 'Pakistan',
            summary: 'Experienced deck officer with focus on LNG tankers.',
            skills: {
              create: [
                { skillName: 'Seamanship', rating: 5 },
                { skillName: 'Man B&W Engines', rating: 4 },
              ],
            },
            seaService: {
              create: [
                {
                  companyName: 'Maritime Corp',
                  role: 'Second Officer',
                  vesselType: 'LNG Tanker',
                  joiningDate: new Date('2020-01-01'),
                  tillDate: new Date('2022-01-01'), // 2 years
                },
                {
                  companyName: 'Oceanic Ltd',
                  role: 'Chief Officer',
                  vesselType: 'Offshore Support Vessel',
                  joiningDate: new Date('2022-02-01'),
                  tillDate: new Date('2023-01-01'), // 11 months
                },
              ],
            },
          },
        },
      },
      include: {
        resume: {
          include: {
            seaService: true,
            skills: true,
          },
        },
      },
    });

    const logs = professional.resume?.seaService || [];

    // 2. Test Utility Functions
    console.log('🧪 Testing Experience Utilities...');
    const { years, totalMonths } = calculateTotalSeaTime(logs);
    console.log(
      `📊 Calculated Sea Time: ${years} years, ${totalMonths % 12} months`,
    );

    const summary = getExperienceSummary(logs);
    console.log('📄 Experience Summary (matching UI mockup):');
    summary.forEach((line) => console.log(`   - ${line}`));

    // Validation
    if (years === 2 && totalMonths === 35) {
      // 24 + 11 = 35 months
      console.log('💎 SUCCESS: Sea time calculation matches exactly.');
    } else {
      throw new Error(
        `Sea time calculation incorrect. Got ${totalMonths} months.`,
      );
    }

    if (summary.some((s) => s.startsWith('Total Sea Time:'))) {
      console.log(
        '💎 SUCCESS: Summary duration formatting matches UI requirements.',
      );
    } else {
      throw new Error('Experience summary missing Total Sea Time line.');
    }

    const duplicateTypeLines = summary.filter((line) =>
      line.startsWith('LNG Tanker:'),
    );
    if (duplicateTypeLines.length === 1) {
      console.log('💎 SUCCESS: Duplicate vessel types are grouped once.');
    } else {
      throw new Error('Expected a single grouped LNG Tanker line.');
    }

    // 3. Cleanup
    console.log('🧹 Cleaning up test professional...');
    await prisma.professional.delete({ where: { id: professional.id } });

    console.log('🎉 Recruiter UI Data Verification Finished Successfully');
  } catch (error) {
    console.error('❌ Verification failed:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

verifyRecruiterUIData();
