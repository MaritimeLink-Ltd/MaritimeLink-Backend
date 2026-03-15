import request from 'supertest';
import app from '../src/app.js';
import { prisma } from '../src/config/prisma.js';

async function testRecruiterFlow() {
  console.log('🚀 Starting Recruiter (Agent) Flow Integration Test...');

  const testEmail = `recruiter_${Date.now()}@example.com`;
  let recruiterId: string | undefined;
  let token: string;

  try {
    // 1. Step 1: Register
    console.log('\n--- Step 1: Register ---');
    const registerRes = await request(app)
      .post('/api/recruiter/register')
      .send({
        role: 'RECRUITMENT_AGENT',
        email: testEmail,
        password: 'Password123!',
        confirmPassword: 'Password123!',
      });

    if (registerRes.status !== 201)
      throw new Error(`Register failed: ${registerRes.text}`);
    recruiterId = registerRes.body.data.recruiterId;
    console.log('✅ Registered. ID:', recruiterId);
    console.log('Step:', registerRes.body.data.registrationStep);

    // 2. Step 2: Verify Email OTP
    console.log('\n--- Step 2: Verify Email (Bypassing OTP) ---');
    await prisma.recruiter.update({
      where: { id: recruiterId },
      data: { isVerified: true, registrationStep: 2 },
    });
    console.log('✅ Bypassed Email OTP verification.');

    // 3. Step 3: About Yourself
    console.log('\n--- Step 3: Tell Us About Yourself ---');
    const personalRes = await request(app)
      .patch('/api/recruiter/personal-info')
      .send({
        recruiterId,
        firstName: 'Asim',
        middleName: 'Abbas',
        lastName: 'Khan',
        phoneCode: '+92',
        phoneNumber: '3076517703',
        personalRole: 'Crewing Coordinator',
      });
    if (personalRes.status !== 200)
      throw new Error(`Personal info failed: ${personalRes.text}`);
    console.log('✅ Personal info saved.');
    console.log('Step:', personalRes.body.data.registrationStep);

    // 4. Step 4: Verify Phone OTP
    console.log('\n--- Step 4: Verify Phone (Bypassing OTP) ---');
    await prisma.recruiter.update({
      where: { id: recruiterId },
      data: { phoneVerified: true, registrationStep: 4 },
    });
    console.log('✅ Bypassed Phone OTP verification.');

    // 5. Step 5: Company Details
    console.log('\n--- Step 5: Company Details ---');
    const companyRes = await request(app)
      .patch('/api/recruiter/company-details')
      .send({
        recruiterId,
        organizationName: 'Devsinc',
        address: 'Sultan khel Isa khel Mainwali',
        companyCity: 'Mianwali',
        companyState: 'Punjab',
        companyZip: '42410',
        companyCountry: 'Pakistan',
        website: 'https://emedcrack.com/',
        companyLinkedIn: 'https://emedcrack.com/',
      });
    if (companyRes.status !== 200)
      throw new Error(`Company details failed: ${companyRes.text}`);
    console.log('✅ Company details saved.');
    console.log('Step:', companyRes.body.data.registrationStep);

    // 6. Step 6: Compliance & Trust
    console.log('\n--- Step 6: Compliance & Trust ---');
    const complianceRes = await request(app)
      .patch('/api/recruiter/compliance')
      .send({
        recruiterId,
        isAuthorized: true,
        agreedToTerms: true,
        howDidYouHear: 'Referral',
      });
    if (complianceRes.status !== 200)
      throw new Error(`Compliance failed: ${complianceRes.text}`);
    token = complianceRes.body.token;
    console.log('✅ Compliance declaration complete.');
    console.log('Step:', complianceRes.body.data.registrationStep);
    console.log('Token received:', !!token);

    // Verify Final Recruiter State
    const recruiter = await prisma.recruiter.findUnique({
      where: { id: recruiterId },
    });

    console.log('\n--- Final State Verification ---');
    if (!recruiter) throw new Error('Recruiter not found in DB');
    console.log('Role:', recruiter.role);
    console.log('Registration Step:', recruiter.registrationStep);
    console.log('Status:', recruiter.status); // Should be PENDING
    console.log('Organization:', recruiter.organizationName);

    if (recruiter.registrationStep !== 6)
      throw new Error('Final step should be 6');
    if (recruiter.status !== 'PENDING')
      throw new Error('Final status should be PENDING');

    console.log('\n🎉 ALL RECRUITER FLOW TESTS PASSED SUCCESSFULLY! 🎉');
  } catch (error) {
    console.error('\n❌ TEST FAILED!');
    console.error(error);
    process.exit(1);
  } finally {
    // Cleanup
    if (recruiterId) {
      // Need to handle relations if any, but for now recruiters might have dependencies
      // Let's just delete the recruiter record
      await prisma.recruiter.delete({ where: { id: recruiterId } });
      console.log('\n🧹 Cleanup: Deleted test recruiter.');
    }
    await prisma.$disconnect();
  }
}

testRecruiterFlow();
