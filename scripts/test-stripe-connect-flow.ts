import request from 'supertest';
import app from '../src/app.js';
import { prisma } from '../src/config/prisma.js';
import bcrypt from 'bcryptjs';

async function testStripeConnectFlow() {
  console.log('🚀 Starting Stripe Connect Flow Integration Test...');

  const trainerEmail = `trainer_${Date.now()}@test.com`;
  const professionalEmail = `pro_${Date.now()}@test.com`;
  const adminEmail = `admin_${Date.now()}@test.com`;

  let trainerId: string | undefined;
  let professionalId: string | undefined;
  let adminId: string | undefined;
  let courseId: string | undefined;
  let adminToken: string;
  let proToken: string;

  try {
    // 1. Setup Admin
    console.log('\n--- 1. Setup Admin ---');
    const hashedPassword = await bcrypt.hash('AdminPassword123!', 12);
    const admin = await prisma.admin.create({
      data: {
        email: adminEmail,
        password: hashedPassword,
        role: 'SUPER_ADMIN',
      },
    });
    adminId = admin.id;

    const adminLoginRes = await request(app).post('/api/admin/login').send({
      email: adminEmail,
      password: 'AdminPassword123!',
    });
    adminToken = adminLoginRes.body.token;
    if (!adminToken) throw new Error('Admin login failed');
    console.log('✅ Admin Token received');

    // 2. Setup Trainer
    console.log('\n--- 2. Setup Trainer ---');
    const trainerRes = await request(app).post('/api/recruiter/register').send({
      email: trainerEmail,
      password: 'TrainerPassword123!',
      confirmPassword: 'TrainerPassword123!',
      role: 'TRAINING_AGENT',
    });
    trainerId = trainerRes.body.data.recruiterId;

    await prisma.recruiter.update({
      where: { id: trainerId },
      data: { status: 'APPROVED', isVerified: true },
    });
    console.log('✅ Trainer created and approved');

    // 3. Initiate Stripe Onboarding
    console.log('\n--- 3. Initiate Stripe Onboarding (Admin) ---');
    const onboardingRes = await request(app)
      .post(`/api/admin/trainers/${trainerId}/initiate-stripe`)
      .set('Authorization', `Bearer ${adminToken}`);

    console.log(
      'Onboarding URL received:',
      onboardingRes.body.data?.onboardingUrl,
    );
    if (!onboardingRes.body.data?.onboardingUrl) {
      console.error('Onboarding Error:', onboardingRes.body);
      throw new Error('No onboarding URL');
    }

    // 4. Simulate Onboarding Completion
    console.log('\n--- 4. Simulate Onboarding Completion ---');
    const updatedTrainer = await prisma.recruiter.update({
      where: { id: trainerId },
      data: {
        stripeOnboardingComplete: true,
      },
    });
    console.log(
      `✅ Trainer marked as Stripe Onboarded using account: ${updatedTrainer.stripeAccountId}`,
    );

    // 5. Create Course
    console.log('\n--- 5. Create Course ---');
    const course = await prisma.course.create({
      data: {
        title: 'Advanced Marine Safety',
        description: 'Master class for safety officers',
        category: 'Safety',
        price: 150.0,
        currency: 'GBP',
        recruiterId: trainerId,
        status: 'ACTIVE',
      },
    });
    courseId = course.id;
    console.log('✅ Course created:', course.title);

    // 6. Setup Professional
    console.log('\n--- 6. Setup Professional ---');
    const proRegisterRes = await request(app)
      .post('/api/professional/register')
      .send({
        firstName: 'John',
        lastName: 'Pro',
        email: professionalEmail,
        password: 'ProPassword123!',
        confirmPassword: 'ProPassword123!',
      });

    if (proRegisterRes.status !== 201) {
      console.error('Pro Register Error:', proRegisterRes.body);
      throw new Error('Pro registration failed');
    }

    await prisma.professional.update({
      where: { email: professionalEmail },
      data: { isVerified: true },
    });
    const proLoginRes = await request(app)
      .post('/api/professional/login')
      .send({
        email: professionalEmail,
        password: 'ProPassword123!',
      });
    proToken = proLoginRes.body.token;
    professionalId = proLoginRes.body.data.user.id;
    console.log('✅ Professional Token received');

    // 7. Test Split Payment Checkout
    console.log('\n--- 7. Test Split Payment Checkout ---');
    const checkoutRes = await request(app)
      .post(`/api/professional/courses/${courseId}/checkout`)
      .set('Authorization', `Bearer ${proToken}`)
      .send({
        sessionIds: [],
        documentIds: [],
      });

    console.log('Checkout Response Status:', checkoutRes.status);
    console.log('Checkout URL:', checkoutRes.body.data?.checkoutUrl);

    if (checkoutRes.status !== 200) {
      console.error('Error Details:', checkoutRes.body);
      throw new Error(`Checkout failed: ${checkoutRes.status}`);
    }

    // 8. Verify Booking Data
    const booking = await prisma.courseBooking.findFirst({
      where: { professionalId, courseId },
    });
    console.log('\n--- Data Verification ---');
    console.log('Platform Fee:', booking?.platformFee);
    console.log('Trainer Payout:', booking?.trainerPayout);

    if (Number(booking?.platformFee) !== 18)
      throw new Error('Platform fee should be 18 (12% of 150)');
    if (Number(booking?.trainerPayout) !== 132)
      throw new Error('Trainer payout should be 132 (88% of 150)');

    console.log('\n🎉 ALL STRIPE CONNECT FLOW TESTS PASSED! 🎉');
  } catch (error) {
    console.error('\n❌ TEST FAILED!');
    console.error(error);
    process.exit(1);
  } finally {
    console.log('\n🧹 Cleaning up test data...');
    try {
      if (courseId) await prisma.course.deleteMany({ where: { id: courseId } });
      if (trainerId) {
        await prisma.recruiterKyc.deleteMany({
          where: { recruiterId: trainerId },
        });
        await prisma.recruiter.deleteMany({ where: { id: trainerId } });
      }
      if (professionalId) {
        await prisma.professionalResume.deleteMany({
          where: { professionalId },
        });
        await prisma.professional.deleteMany({ where: { id: professionalId } });
      }
      if (adminId) await prisma.admin.deleteMany({ where: { id: adminId } });
    } catch (e) {
      console.error('Cleanup error:', e);
    }
    await prisma.$disconnect();
  }
}

testStripeConnectFlow();
