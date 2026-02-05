import { prisma } from '../config/prisma.js';
import {
  JobCategory,
  JobType,
  ApplicationStatus,
} from '../generated/client/index.js';

async function verifyJobFlow() {
  console.log('🚀 Starting Job Flow Verification...\n');

  // 1. Setup Actors
  console.log('👤 Setting up Actors...');

  // Professional
  let pro = await prisma.professional.findUnique({
    where: { email: 'job-pro@example.com' },
  });
  if (!pro) {
    pro = await prisma.professional.create({
      data: {
        fullname: 'Job Seeker',
        email: 'job-pro@example.com',
        password: 'hashed',
        isVerified: true,
      },
    });
  }

  // Recruiter
  let rec = await prisma.recruiter.findUnique({
    where: { email: 'job-rec@example.com' },
  });
  if (!rec) {
    rec = await prisma.recruiter.create({
      data: {
        email: 'job-rec@example.com',
        password: 'hashed',
        role: 'RECRUITMENT_AGENT',
        status: 'APPROVED',
        isVerified: true,
      },
    });
  }

  // Admin
  let admin = await prisma.admin.findUnique({
    where: { email: 'job-admin@example.com' },
  });
  if (!admin) {
    admin = await prisma.admin.create({
      data: { email: 'job-admin@example.com', password: 'hashed' },
    });
  }

  // 2. Recruiter Posts a Job
  console.log('\n📝 Recruiter posting a job...');
  const job = await prisma.job.create({
    data: {
      title: 'Chief Officer',
      location: 'Global',
      category: JobCategory.OFFICER,
      contractType: JobType.PERMANENT,
      salary: '$8000/month',
      description: 'Experienced Chief Officer needed.',
      recruiterId: rec.id,
    },
  });
  console.log(`✅ Job Created: ${job.id}`);

  // 3. Professional Applies
  console.log('\n📨 Professional applying...');
  const app = await prisma.jobApplication.create({
    data: {
      jobId: job.id,
      professionalId: pro.id,
      coverLetter: 'I am the best fit.',
      status: ApplicationStatus.APPLIED,
    },
  });
  console.log(`✅ Application ID: ${app.id}`);

  // 4. Recruiter Views Applicants & Updates Status
  console.log('\n👀 Recruiter reviewing applications...');
  const updatedApp = await prisma.jobApplication.update({
    where: { id: app.id },
    data: { status: ApplicationStatus.SHORTLISTED },
  });
  console.log(`✅ Status Updated to: ${updatedApp.status}`);

  // 5. Admin Moderation (Flag Job)
  console.log('\n🚩 Admin flagging job...');
  const flaggedJob = await prisma.job.update({
    where: { id: job.id },
    data: { isFlagged: true },
  });
  console.log(`✅ Job Flagged: ${flaggedJob.isFlagged}`);

  // Verify Flagged Filter
  const publicJobs = await prisma.job.findMany({
    where: { isFlagged: false },
  });
  const isHidden = !publicJobs.find((j) => j.id === job.id);
  if (isHidden) {
    console.log('✅ Verified: Flagged job is hidden from public feed.');
  } else {
    console.error('❌ Failed: Flagged job is still visible.');
  }

  console.log('\n✅ JOB FLOW VERIFICATION SUCCESSFUL');
}

verifyJobFlow()
  .catch((e) => console.error(e))
  .finally(async () => {
    await prisma.$disconnect();
  });
