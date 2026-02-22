import { prisma } from '../config/prisma.js';
import {
  ApplicationStatus,
  JobCategory,
  JobType,
} from '../generated/client/index.js';

async function verifyCvFlow() {
  console.log('🚀 Starting Verification: CV & Cover Letter Flow');

  try {
    // 1. Create/Update Mock Professional
    const professional = await prisma.professional.upsert({
      where: { email: 'cv-test@example.com' },
      update: {
        cvUrl: null,
        lastCoverLetter: null,
      },
      create: {
        email: 'cv-test@example.com',
        fullname: 'CV Tester',
        password: 'password123',
        profession: JobCategory.OFFICER,
        isVerified: true,
      },
    });
    console.log('✅ Mock professional prepared.');

    // 2. Create Mock Job
    const job = await prisma.job.create({
      data: {
        title: 'CV Test Engineer',
        location: 'Remote',
        category: JobCategory.OFFICER,
        contractType: JobType.PERMANENT,
        salary: '50000',
        description: 'Testing CV upload and reuse logic.',
      },
    });
    console.log('✅ Mock job created.');

    // 3. Simulate Application with documents
    const testCvUrl = 'https://supabase.com/resumes/test-cv.pdf';
    const testCoverLetter = 'I am very interested in this CV Test role.';

    console.log('📦 Applying to job with CV and Cover Letter...');
    const application = await prisma.jobApplication.create({
      data: {
        jobId: job.id,
        professionalId: professional.id,
        cvUrl: testCvUrl,
        coverLetter: testCoverLetter,
        status: ApplicationStatus.APPLIED,
      },
    });

    // 4. Update Professional Profile (simulating applyToJob controller logic)
    await prisma.professional.update({
      where: { id: professional.id },
      data: {
        cvUrl: testCvUrl,
        lastCoverLetter: testCoverLetter,
      },
    });

    console.log('✅ Application created and professional profile updated.');

    // 5. Verify Profile Update
    const updatedProf = await prisma.professional.findUnique({
      where: { id: professional.id },
    });

    if (
      updatedProf?.cvUrl === testCvUrl &&
      updatedProf?.lastCoverLetter === testCoverLetter
    ) {
      console.log(
        '💎 SUCCESS: Profile correctly stored CV and Cover Letter for reuse.',
      );
    } else {
      throw new Error('Profile update failed.');
    }

    // 6. Verify Application Data
    const savedApp = await prisma.jobApplication.findUnique({
      where: { id: application.id },
    });

    if (
      savedApp?.cvUrl === testCvUrl &&
      savedApp?.coverLetter === testCoverLetter
    ) {
      console.log(
        '💎 SUCCESS: Application correctly stored specific CV and Cover Letter.',
      );
    } else {
      throw new Error('Application data mismatch.');
    }

    // 7. Cleanup
    console.log('🧹 Cleaning up...');
    await prisma.jobApplication.delete({ where: { id: application.id } });
    await prisma.job.delete({ where: { id: job.id } });
    // NOTE: We keep the professional for reuse/reference but we could delete if needed.

    console.log('🎉 CV Flow Verification Finished Successfully');
  } catch (error) {
    console.error('❌ Verification failed:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

verifyCvFlow();
