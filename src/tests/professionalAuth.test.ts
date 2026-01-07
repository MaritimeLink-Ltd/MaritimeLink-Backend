import request from 'supertest';
import app from '../app.js';
import { prisma } from '../config/prisma.js';
import * as emailService from '../services/emailService.js';
import * as storageService from '../services/storageService.js';

// Mock services
jest.mock('../services/emailService.js');
jest.mock('../services/storageService.js');

describe('Professional Auth 4-Step Flow', () => {
  let professionalId: string;
  const testUser = {
    fullname: 'Jest Tester',
    email: `test-${Date.now()}@example.com`,
    password: 'password123',
  };

  beforeAll(async () => {
    // Clean up before tests if necessary
    await prisma.oTP.deleteMany();
    await prisma.professional.deleteMany({ where: { email: testUser.email } });
  });

  afterAll(async () => {
    // Cleanup
    await prisma.oTP.deleteMany();
    await prisma.professional.deleteMany({ where: { email: testUser.email } });
    await prisma.$disconnect();
  });

  it('Step 1: Should register a new professional and send OTP', async () => {
    (emailService.sendOTPEmail as jest.Mock).mockResolvedValue(undefined);

    const response = await request(app)
      .post('/api/professional/register')
      .send(testUser);

    expect(response.status).toBe(201);
    expect(response.body.status).toBe('success');
    expect(response.body.data).toHaveProperty('professionalId');

    professionalId = response.body.data.professionalId;
  });

  it('Step 2: Should verify OTP', async () => {
    // Get the OTP from DB since it's an integration test
    const otp = await prisma.oTP.findFirst({
      where: { professionalId },
    });

    const response = await request(app)
      .post('/api/professional/verify-otp')
      .send({
        professionalId,
        code: otp?.code,
      });

    expect(response.status).toBe(200);
    expect(response.body.status).toBe('success');

    const user = await prisma.professional.findUnique({
      where: { id: professionalId },
    });
    expect(user?.isVerified).toBe(true);
  });

  it('Step 3: Should upload ID and return URL', async () => {
    const mockUrl = 'https://supabase.com/mock-id.jpg';
    (storageService.uploadToSupabase as jest.Mock).mockResolvedValue(mockUrl);

    const response = await request(app)
      .post('/api/professional/upload-id')
      .attach('id_passport', Buffer.from('fake-image-data'), 'test.jpg');

    expect(response.status).toBe(200);
    expect(response.body.status).toBe('success');
    expect(response.body.data.url).toBe(mockUrl);
  });

  it('Step 4: Should complete profile (profession + ID URL)', async () => {
    const profileData = {
      professionalId,
      profession: 'Pilot',
      idPassportUrl: 'https://supabase.com/mock-id.jpg',
      bio: 'Experienced maritime pilot',
    };

    const response = await request(app)
      .post('/api/professional/complete-profile')
      .send(profileData);

    expect(response.status).toBe(200);
    expect(response.body.status).toBe('success');
    expect(response.body.data.user.profession).toBe('Pilot');
    expect(response.body.data.user.idPassportUrl).toBe(
      profileData.idPassportUrl,
    );
  });

  it('Final Step: Should login successfully', async () => {
    const response = await request(app).post('/api/professional/login').send({
      email: testUser.email,
      password: testUser.password,
    });

    expect(response.status).toBe(200);
    expect(response.body.status).toBe('success');
    expect(response.body).toHaveProperty('token');
    expect(response.body.data.user.email).toBe(testUser.email);
  });
});
