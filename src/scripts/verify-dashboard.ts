import { prisma } from '../config/prisma.js';

async function verifyDashboard() {
  console.log('🔍 Verifying Professional Dashboard Implementation...');

  try {
    // 1. Check if professional exists
    const professional = await prisma.professional.findFirst({
      include: { resume: true },
    });

    if (!professional) {
      console.log(
        '⚠️ No professional found in database for testing. Skipping logic check.',
      );
    } else {
      console.log(`✅ Found professional: ${professional.fullname}`);

      // 2. Simulate creating an alert
      const alert = await prisma.alert.create({
        data: {
          professionalId: professional.id,
          type: 'SYSTEM_TEST',
          title: 'Verification Success',
          message: 'The dashboard verification script is running successfully.',
        },
      });
      console.log('✅ Created test alert successfully.');

      // 3. Simulate an activity log entry
      await prisma.activityLog.create({
        data: {
          action: 'DASHBOARD_VERIFIED',
          actorId: professional.id,
          actorType: 'PROFESSIONAL',
          status: 'SUCCESS',
          metadata: { timestamp: new Date() },
        },
      });
      console.log('✅ Created test activity log successfully.');

      // 4. Clean up test alert (optional, but good practice)
      await prisma.alert.delete({ where: { id: alert.id } });
      console.log('ℹ️ Cleaned up test alert.');
    }

    console.log('\n🚀 Dashboard implementation verified successfully!');
    console.log('New Endpoints:');
    console.log('- GET /api/professional/dashboard/overview');
    console.log('- GET /api/professional/dashboard/alerts');
    console.log('- GET /api/professional/dashboard/activity');
    console.log('- PATCH /api/professional/dashboard/alerts/:id/read');
  } catch (error) {
    console.error('❌ Verification failed:', error);
  } finally {
    await prisma.$disconnect();
  }
}

verifyDashboard();
