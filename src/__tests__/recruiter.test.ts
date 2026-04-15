import request from 'supertest';
import app from '../app.js';
import { prisma } from '../config/prisma.js';

describe('Recruiter & Trainer Flow E2E Tests', () => {
  let recruiterId: string;
  let trainerId: string;
  let recruiterToken: string;
  let trainerToken: string;

  const testRecruiterEmail = `rec_${Date.now()}@example.com`;
  const testTrainerEmail = `train_${Date.now()}@example.com`;
  const testPassword = 'Password123!';

  afterAll(async () => {
    // Cleanup
    if (recruiterId)
      await prisma.recruiter
        .delete({ where: { id: recruiterId } })
        .catch(() => {});
    if (trainerId)
      await prisma.recruiter
        .delete({ where: { id: trainerId } })
        .catch(() => {});
    await prisma.$disconnect();
  });

  describe('Recruiter Registration Flow (Steps 1-6)', () => {
    it('Step 1: should register a new recruiter (Agent)', async () => {
      const res = await request(app).post('/api/recruiter/register').send({
        email: testRecruiterEmail,
        password: testPassword,
        confirmPassword: testPassword,
        role: 'RECRUITMENT_AGENT',
      });

      expect(res.status).toBe(201);
      recruiterId = res.body.data.recruiterId;
      expect(recruiterId).toBeDefined();
    });

    it('Step 2: should verify email OTP', async () => {
      await prisma.recruiter.update({
        where: { id: recruiterId },
        data: { otpCode: '123456', otpExpiresAt: new Date(Date.now() + 10000) },
      });

      const res = await request(app)
        .post('/api/recruiter/verify-otp')
        .send({ recruiterId, code: '123456' });

      expect(res.status).toBe(200);
      expect(res.body.data.registrationStep).toBe(2);
    });

    it('Step 3: should save personal info', async () => {
      const res = await request(app)
        .patch('/api/recruiter/personal-info')
        .send({
          recruiterId,
          firstName: 'Harris',
          lastName: 'Abbas',
          phoneCode: '+92',
          phoneNumber: '3076517700',
          personalRole: 'Recruitment Manager',
        });

      expect(res.status).toBe(200);
      expect(res.body.data.registrationStep).toBe(3);
    });

    it('Step 4: should verify phone OTP', async () => {
      await prisma.recruiter.update({
        where: { id: recruiterId },
        data: {
          phoneOtpCode: '123456',
          phoneOtpExpiresAt: new Date(Date.now() + 10000),
        },
      });

      const res = await request(app)
        .post('/api/recruiter/verify-phone')
        .send({ recruiterId, code: '123456' });

      expect(res.status).toBe(200);
      expect(res.body.data.registrationStep).toBe(4);
    });

    it('Step 5: should save company details', async () => {
      const res = await request(app)
        .patch('/api/recruiter/company-details')
        .send({
          recruiterId,
          organizationName: 'Global Maritime',
          address: 'Ocean View St, London',
          companyCity: 'London',
          companyState: 'London',
          companyZip: 'EC1A 1BB',
          companyCountry: 'UK',
        });

      expect(res.status).toBe(200);
      expect(res.body.data.registrationStep).toBe(5);
    });

    it('Step 6: should complete registration and issue token', async () => {
      const res = await request(app).patch('/api/recruiter/compliance').send({
        recruiterId,
        isAuthorized: true,
        agreedToTerms: true,
        howDidYouHear: 'LinkedIn',
      });

      expect(res.status).toBe(200);
      expect(res.body.token).toBeDefined();
      recruiterToken = res.body.token;
    });

    it('should allow a pending recruiter to login after verification', async () => {
      const res = await request(app)
        .post('/api/recruiter/login')
        .send({ email: testRecruiterEmail, password: testPassword });

      expect(res.status).toBe(200);
      expect(res.body.token).toBeDefined();
      expect(res.body.data.recruiter.status).toBe('PENDING');
    });
  });

  describe('Trainer Registration Flow (Minimal Steps)', () => {
    it('should register a new trainer provider', async () => {
      const res = await request(app).post('/api/recruiter/register').send({
        email: testTrainerEmail,
        password: testPassword,
        confirmPassword: testPassword,
        role: 'TRAINING_AGENT',
      });

      expect(res.status).toBe(201);
      trainerId = res.body.data.recruiterId;

      // Advance trainer to completion for dashboard testing
      await prisma.recruiter.update({
        where: { id: trainerId },
        data: { isVerified: true, status: 'PENDING', registrationStep: 6 },
      });

      // Login as pending trainer
      const loginRes = await request(app)
        .post('/api/trainer/login')
        .send({ email: testTrainerEmail, password: testPassword });

      trainerToken = loginRes.body.token;
      expect(loginRes.status).toBe(200);
      expect(trainerToken).toBeDefined();
      expect(loginRes.body.data.recruiter.status).toBe('PENDING');

      await prisma.recruiter.update({
        where: { id: trainerId },
        data: { status: 'APPROVED' },
      });
    });
  });

  describe('Dashboard Stats Verification', () => {
    it('should retrieve recruiter dashboard statistics', async () => {
      // Recruiter must be approved to access dashboard
      await prisma.recruiter.update({
        where: { id: recruiterId },
        data: { status: 'APPROVED' },
      });

      const res = await request(app)
        .get('/api/recruiter/dashboard/stats')
        .set('Authorization', `Bearer ${recruiterToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.stats).toHaveProperty('activeJobsCount');
    });

    it('should retrieve trainer dashboard statistics', async () => {
      const res = await request(app)
        .get('/api/trainer/dashboard/stats')
        .set('Authorization', `Bearer ${trainerToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.stats).toHaveProperty('activeCoursesCount');
    });
  });

  describe('KYC Process', () => {
    it('KYC Step 1: should upload identity document', async () => {
      const res = await request(app)
        .post('/api/recruiter/kyc/upload-document')
        .set('Authorization', `Bearer ${recruiterToken}`)
        .attach('document', Buffer.from('fake-doc'), 'passport.pdf');

      expect(res.status).toBe(200);
      expect(res.body.data.url).toBeDefined();
    });

    it('KYC Step 2: should submit personal details and doc URL', async () => {
      const res = await request(app)
        .post('/api/recruiter/kyc/submit')
        .set('Authorization', `Bearer ${recruiterToken}`)
        .send({
          recruiterId,
          firstName: 'Harris',
          lastName: 'Abbas',
          dateOfBirth: '1995-01-01',
          documentType: 'PASSPORT',
          documentNumber: 'A1234567',
          expiryDate: '2030-01-01',
          issueCountry: 'UK',
          documentUrl: 'http://example.com/passport.pdf',
        });

      expect(res.status).toBe(200);
    });

    it('KYC Step 3: should upload selfie', async () => {
      const res = await request(app)
        .post('/api/recruiter/kyc/upload-selfie')
        .set('Authorization', `Bearer ${recruiterToken}`)
        .field('recruiterId', recruiterId)
        .attach('selfie', Buffer.from('fake-selfie'), 'selfie.jpg');

      expect(res.status).toBe(200);
    });
  });

  describe('SMS OTP Verification', () => {
    it('Step 3 should generate a 6-digit phone OTP when saving personal info', async () => {
      // Use the already-created recruiter from earlier steps
      // Reset their step so we can re-trigger personal info
      await prisma.recruiter.update({
        where: { id: recruiterId },
        data: { registrationStep: 2, phoneVerified: false },
      });

      const res = await request(app)
        .patch('/api/recruiter/personal-info')
        .send({
          recruiterId,
          firstName: 'Harris',
          lastName: 'Test',
          phoneCode: '+92',
          phoneNumber: '3076517703',
          personalRole: 'Crew Manager',
        });

      expect(res.status).toBe(200);
      expect(res.body.data.registrationStep).toBe(3);

      // Verify that a 6-digit phoneOtpCode was stored in the database
      const updatedRecruiter = await prisma.recruiter.findUnique({
        where: { id: recruiterId },
        select: { phoneOtpCode: true, phoneOtpExpiresAt: true },
      });

      expect(updatedRecruiter?.phoneOtpCode).toBeDefined();
      expect(updatedRecruiter?.phoneOtpCode).toHaveLength(6);
      expect(updatedRecruiter?.phoneOtpExpiresAt).toBeDefined();

      // Restore registration step for any following tests
      await prisma.recruiter.update({
        where: { id: recruiterId },
        data: { registrationStep: 6, phoneVerified: true },
      });
    });
  });

  describe('Company Preview', () => {
    it('should return company logo and name for a valid domain', async () => {
      const res = await request(app)
        .get('/api/recruiter/company-preview')
        .query({ url: 'google.com' });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('success');
      expect(res.body.data).toHaveProperty('name');
      expect(res.body.data).toHaveProperty('logo');
      expect(res.body.data).toHaveProperty('domain');
      expect(res.body.data.logo).toContain('logo.clearbit.com');
    });

    it('should return company preview for a URL with https prefix', async () => {
      const res = await request(app)
        .get('/api/recruiter/company-preview')
        .query({ url: 'https://www.zyntrify.com' });

      expect(res.status).toBe(200);
      expect(res.body.data.domain).toBe('zyntrify.com');
    });

    it('should return 400 when no URL is provided', async () => {
      const res = await request(app).get('/api/recruiter/company-preview');

      expect(res.status).toBe(400);
    });
  });
});
