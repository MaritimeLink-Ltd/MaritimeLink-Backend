import request from 'supertest';
import app from '../src/app.js';
import { prisma } from '../src/config/prisma.js';

async function testFlow() {
  console.log('🚀 Starting Professional Flow Integration Test...');

  const testEmail = `testuser_${Date.now()}@example.com`;
  let professionalId: string | undefined;
  let token: string;

  try {
    // 1. Step 1: Register
    console.log('\n--- Step 1: Register ---');
    const registerRes = await request(app)
      .post('/api/professional/register')
      .send({
        firstName: 'Test',
        lastName: 'User',
        email: testEmail,
        password: 'Password123!',
      });

    if (registerRes.status !== 201)
      throw new Error(`Register failed: ${registerRes.text}`);
    professionalId = registerRes.body.data.professionalId;
    console.log('✅ Registered. ID:', professionalId);

    // 2. Step 2: Verify OTP
    // We'll update the DB directly to set isVerified=true since we can't easily get the OTP from email here
    console.log('\n--- Step 2: Verify (Bypassing OTP) ---');
    await prisma.professional.update({
      where: { id: professionalId },
      data: { isVerified: true, registrationStep: 2 },
    });
    console.log('✅ Bypassed OTP verification.');

    // 3. Step 3: Set Profession
    console.log('\n--- Step 3: Set Profession ---');
    const professionRes = await request(app)
      .patch('/api/professional/profession')
      .send({
        professionalId,
        profession: 'OFFICER',
      });
    if (professionRes.status !== 200)
      throw new Error(`Profession failed: ${professionRes.text}`);
    console.log('✅ Profession set.');

    // 4. Step 4: Upload Photo (Skip actual upload, just advance step for test)
    console.log('\n--- Step 4: Upload Photo (Bypassing upload) ---');
    await prisma.professional.update({
      where: { id: professionalId },
      data: {
        profilePhotoUrl: 'https://example.com/photo.jpg',
        registrationStep: 4,
      },
    });
    console.log('✅ Photo set in DB.');

    // 5. Step 5: Set Role
    console.log('\n--- Step 5: Set Role ---');
    const roleRes = await request(app).patch('/api/professional/role').send({
      professionalId,
      subcategory: 'Deck Officer',
    });
    if (roleRes.status !== 200) throw new Error(`Role failed: ${roleRes.text}`);
    token = roleRes.body.token;
    console.log('✅ Role set. Token received.');

    // 6. Step 6: Resume - Personal Info
    console.log('\n--- Step 6: Resume - Personal Info ---');
    const personalRes = await request(app)
      .patch('/api/professional/resume/personal-info')
      .set('Authorization', `Bearer ${token}`)
      .send({
        firstName: 'Test',
        lastName: 'User',
        dateOfBirth: '1990-01-01',
        address: '123 Sea St',
        city: 'Ocean',
        state: 'Wet',
        postcode: '12345',
        country: 'Deep Blue',
        phoneCode: '+1',
        phoneNumber: '5550199',
        emailAddress: testEmail,
      });
    if (personalRes.status !== 200)
      throw new Error(`Personal info failed: ${personalRes.text}`);
    console.log('✅ Personal info updated.');

    // 7. Step 7: Resume - Summary
    console.log('\n--- Step 7: Resume - Summary ---');
    const summaryRes = await request(app)
      .patch('/api/professional/resume/summary')
      .set('Authorization', `Bearer ${token}`)
      .send({
        summary:
          'I am a highly experienced deck officer with many years at sea.',
      });
    if (summaryRes.status !== 200)
      throw new Error(`Summary failed: ${summaryRes.text}`);
    console.log('✅ Summary updated.');

    // 8. Step 8: Resume - Skills
    console.log('\n--- Step 8: Resume - Skills ---');
    const skillRes = await request(app)
      .post('/api/professional/resume/skills')
      .set('Authorization', `Bearer ${token}`)
      .send({
        skillName: 'Navigation',
        rating: 5,
      });
    if (skillRes.status !== 201)
      throw new Error(`Skills failed: ${skillRes.text}`);
    console.log('✅ Skill added.');

    // Verify Final Resume Object
    const getRes = await request(app)
      .get('/api/professional/resume')
      .set('Authorization', `Bearer ${token}`);

    console.log('\n--- Final Resume Verification ---');
    if (getRes.status !== 200) {
      console.log('Error Status:', getRes.status);
      console.log('Error Body:', JSON.stringify(getRes.body, null, 2));
      throw new Error('Get resume failed');
    }
    const resume = getRes.body.data.resume;
    console.log('Resume ID:', resume.id);
    console.log('Summary:', resume.summary);
    console.log('Skills Count:', resume.skills.length);
    console.log(
      'Professional ID match:',
      resume.professionalId === professionalId,
    );

    console.log('\n🎉 ALL TESTS PASSED SUCCESSFULLY! 🎉');
  } catch (error) {
    console.error('\n❌ TEST FAILED!');
    console.error(error);
    process.exit(1);
  } finally {
    // Cleanup
    if (professionalId) {
      await prisma.professional.delete({ where: { id: professionalId } });
      console.log('\n🧹 Cleanup: Deleted test user.');
    }
    await prisma.$disconnect();
  }
}

testFlow();
