import request from 'supertest';
import app from '../app.js';
import { prisma } from '../config/prisma.js';

describe('Professional Flow E2E Tests', () => {
  let professionalId: string;
  let token: string;
  const testEmail = `prof_${Date.now()}@example.com`;
  const testPassword = 'Password123!';

  beforeAll(async () => {
    // Any specific setup if needed
  });

  afterAll(async () => {
    // Cleanup
    if (professionalId) {
      await prisma.professional.delete({ where: { id: professionalId } });
    }
    await prisma.$disconnect();
  });

  describe('Registration & Onboarding (Steps 1-5)', () => {
    it('Step 1: should register a new professional', async () => {
      const res = await request(app).post('/api/professional/register').send({
        firstName: 'John',
        lastName: 'Doe',
        email: testEmail,
        password: testPassword,
      });

      expect(res.status).toBe(201);
      expect(res.body.status).toBe('success');
      professionalId = res.body.data.professionalId;
      expect(professionalId).toBeDefined();
    });

    it('Step 2: should verify email OTP', async () => {
      // Mock OTP in DB
      await prisma.professional.update({
        where: { id: professionalId },
        data: { otpCode: '123456', otpExpiresAt: new Date(Date.now() + 10000) },
      });

      const res = await request(app).post('/api/professional/verify-otp').send({
        professionalId,
        code: '123456',
      });

      expect(res.status).toBe(200);
      expect(res.body.data.registrationStep).toBe(2);
    });

    it('Step 3: should select profession', async () => {
      const res = await request(app)
        .patch('/api/professional/profession')
        .send({
          professionalId,
          profession: 'OFFICER',
        });

      expect(res.status).toBe(200);
      expect(res.body.data.registrationStep).toBe(3);
    });

    it('Step 4: should upload profile photo', async () => {
      // Mocking file upload with a small buffer
      const res = await request(app)
        .post('/api/professional/upload-photo')
        .field('professionalId', professionalId)
        .attach('photo', Buffer.from('fake-image-data'), 'profile.jpg');

      expect(res.status).toBe(200);
      expect(res.body.data.registrationStep).toBe(4);
      expect(res.body.data.url).toBeDefined();
    });

    it('Step 5: should set role and issue token', async () => {
      const res = await request(app).patch('/api/professional/role').send({
        professionalId,
        role: 'Deck Officer',
        subcategory: 'Chief Officer',
      });

      expect(res.status).toBe(200);
      expect(res.body.token).toBeDefined();
      token = res.body.token;
      expect(res.body.data.registrationStep).toBe(5);
    });
  });

  describe('Resume Builder (Steps 6-15)', () => {
    it('Step 6: should save personal info', async () => {
      const res = await request(app)
        .patch('/api/professional/resume/personal-info')
        .set('Authorization', `Bearer ${token}`)
        .send({
          firstName: 'John',
          lastName: 'Doe',
          dateOfBirth: '1990-01-01',
          address: '123 Sea St',
          city: 'London',
          state: 'Greater London',
          postcode: 'SW1A 1AA',
          country: 'United Kingdom',
          phoneCode: '+44',
          phoneNumber: '7700900000',
          emailAddress: testEmail,
        });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('success');
    });

    it('Step 7: should save professional summary', async () => {
      const res = await request(app)
        .patch('/api/professional/resume/summary')
        .set('Authorization', `Bearer ${token}`)
        .send({
          summary:
            'Experienced Deck Officer with deep sea experience and a strong background in navigation.',
        });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('success');
    });

    it('Step 8: should save a skill', async () => {
      const res = await request(app)
        .post('/api/professional/resume/skills')
        .set('Authorization', `Bearer ${token}`)
        .send({
          skillName: 'Navigation',
          rating: 5,
        });

      expect(res.status).toBe(201);
      expect(res.body.status).toBe('success');
    });

    it('Step 9: should save a license', async () => {
      const res = await request(app)
        .post('/api/professional/resume/licenses')
        .set('Authorization', `Bearer ${token}`)
        .send({
          name: 'Master Unlimited',
          number: '12345',
          country: 'UK',
          issueDate: '2020-01-01',
          expiryDate: '2025-01-01',
        });

      expect(res.status).toBe(201);
      expect(res.body.status).toBe('success');
    });

    it('Step 10: should save sea service', async () => {
      const res = await request(app)
        .post('/api/professional/resume/sea-service')
        .set('Authorization', `Bearer ${token}`)
        .send({
          companyName: 'Oceanic',
          vesselName: 'Sea Star',
          role: 'Second Officer',
          joiningDate: '2021-01-01',
          tillDate: '2022-01-01',
        });

      expect(res.status).toBe(201);
      expect(res.body.status).toBe('success');
    });

    it('Step 11a: should save education', async () => {
      const res = await request(app)
        .post('/api/professional/resume/education')
        .set('Authorization', `Bearer ${token}`)
        .send({
          qualificationName: 'BSc Navigation',
          institution: 'Maritime Academy',
          startDate: '2010-09-01',
          endDate: '2014-06-01',
        });

      expect(res.status).toBe(201);
      expect(res.body.status).toBe('success');
    });

    it('Step 11b: should save STCW certificate', async () => {
      const res = await request(app)
        .post('/api/professional/resume/stcw-certificates')
        .set('Authorization', `Bearer ${token}`)
        .send({
          qualification: 'Basic Safety Training',
          issueDate: '2022-01-01',
          expiryDate: '2027-01-01',
        });

      expect(res.status).toBe(201);
      expect(res.body.status).toBe('success');
    });

    it('Step 12: should save medical certificate', async () => {
      const res = await request(app)
        .post('/api/professional/resume/medical-travel-documents')
        .set('Authorization', `Bearer ${token}`)
        .send({
          name: 'ENG1',
          issueDate: '2023-01-01',
          expiryDate: '2025-01-01',
          type: 'MEDICAL',
        });

      expect(res.status).toBe(201);
      expect(res.body.status).toBe('success');
    });

    it('Step 13: should save biometrics', async () => {
      const res = await request(app)
        .patch('/api/professional/resume/biometrics')
        .set('Authorization', `Bearer ${token}`)
        .send({
          gender: 'MALE',
          height: 180,
          weight: 75,
          eyeColor: 'Blue',
          overallSize: 'L',
        });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('success');
    });

    it('Step 14: should save next of kin', async () => {
      const res = await request(app)
        .post('/api/professional/resume/next-of-kin')
        .set('Authorization', `Bearer ${token}`)
        .send({
          name: 'Jane Doe',
          relationship: 'Spouse',
          countryCode: '+44',
          phoneNumber: '7700900001',
          email: 'jane@example.com',
        });

      expect(res.status).toBe(201);
      expect(res.body.status).toBe('success');
    });

    it('Step 15: should save a referee', async () => {
      const res = await request(app)
        .post('/api/professional/resume/referees')
        .set('Authorization', `Bearer ${token}`)
        .send({
          name: 'Capt. Smith',
          position: 'Master',
          companyName: 'Oceanic',
          countryCode: '+44',
          phoneNumber: '7700900002',
          email: 'smith@example.com',
        });

      expect(res.status).toBe(201);
      expect(res.body.status).toBe('success');
    });
  });

  describe('Document Upload with OCR matching', () => {
    it('should upload a document and return matchStatus correctly (graceful fallback without OCR key)', async () => {
      // Mocking file upload and passing form data
      const res = await request(app)
        .post('/api/professional/documents/upload')
        .set('Authorization', `Bearer ${token}`)
        .field('category', 'LICENSES_ENDORSEMENTS')
        .field('name', 'John Doe')
        .field('number', '12345')
        .field('issuingCountry', 'UK')
        .field('issueDate', '2020-01-01T00:00:00Z')
        .field('expiryDate', '2025-01-01T00:00:00Z')
        .attach('document', Buffer.from('fake-pdf-content'), 'certificate.pdf');

      expect(res.status).toBe(201);
      expect(res.body.status).toBe('success');
      expect(res.body.data.matchStatus).toBeDefined();
      // Without API key, OCR returns {} so matching fails gracefully
      expect(res.body.data.matchStatus.isFullyMatched).toBe(false);
      expect(res.body.data.matchStatus.details.name.isMatched).toBe(false);
    });
  });

  describe('Edge Cases', () => {
    it('should return 400 when registering with an existing email', async () => {
      const res = await request(app).post('/api/professional/register').send({
        firstName: 'Duplicate',
        lastName: 'User',
        email: testEmail,
        password: testPassword,
      });

      expect(res.status).toBe(400);
    });

    it('should return 400 for incorrect OTP', async () => {
      const res = await request(app).post('/api/professional/verify-otp').send({
        professionalId,
        code: '000000',
      });

      expect(res.status).toBe(400);
      expect(res.body.message).toBe('Invalid or expired OTP');
    });

    it('should return 401 when accessing protected route without token', async () => {
      const res = await request(app)
        .patch('/api/professional/resume/personal-info')
        .send({ gender: 'Male' });

      expect(res.status).toBe(401);
    });
  });
});
