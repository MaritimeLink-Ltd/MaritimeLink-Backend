import request from 'supertest';
import app from '../app.js';
import { prisma } from '../config/prisma.js';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';

describe('Professional Resume API', () => {
  let token: string;
  let userId: string;

  beforeAll(async () => {
    // Create a test professional
    const user = await prisma.professional.create({
      data: {
        fullname: 'Test Professional',
        email: `test-${Date.now()}@example.com`,
        password: 'Password123!',
        isVerified: true,
      },
    });
    userId = user.id;
    token = jwt.sign({ id: userId }, env.JWT_SECRET);
  });

  afterAll(async () => {
    // Cleanup
    await prisma.professional.delete({ where: { id: userId } });
    await prisma.$disconnect();
  });

  it('should create a new resume with all fields', async () => {
    const resumeData = {
      category: 'Deck',
      subcategory: 'Captain',
      address: '123 Harbor Lane',
      city: 'Seaville',
      summary: 'Experienced captain with 10 years at sea.',
      gender: 'Male',
      height: 185,
      weight: 80,
      skills: [{ skillName: 'Navigation', rating: 10 }],
      seaService: [
        {
          companyName: 'Oceanic Corp',
          vesselName: 'Sea Queen',
          role: 'Chief Officer',
          joiningDate: '2023-01-01',
          tillDate: '2023-12-31',
        },
      ],
    };

    const response = await request(app)
      .post('/api/professional/resume')
      .set('Authorization', `Bearer ${token}`)
      .send(resumeData);

    expect(response.status).toBe(200);
    expect(response.body.status).toBe('success');
    expect(response.body.message).toBe('Resume updated successfully');
  });

  it('should retrieve the created resume', async () => {
    const response = await request(app)
      .get('/api/professional/resume')
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body.data.resume.category).toBe('Deck');
    expect(response.body.data.resume.skills).toHaveLength(1);
    expect(response.body.data.resume.skills[0].skillName).toBe('Navigation');
    expect(response.body.data.resume.seaService).toHaveLength(1);
    expect(response.body.data.resume.seaService[0].vesselName).toBe(
      'Sea Queen',
    );
  });

  it('should update the resume (upsert logic)', async () => {
    const updatedData = {
      category: 'Bridge',
      skills: [
        { skillName: 'Navigation', rating: 9 },
        { skillName: 'Safety', rating: 8 },
      ],
    };

    const response = await request(app)
      .post('/api/professional/resume')
      .set('Authorization', `Bearer ${token}`)
      .send(updatedData);

    expect(response.status).toBe(200);

    const checkResponse = await request(app)
      .get('/api/professional/resume')
      .set('Authorization', `Bearer ${token}`);

    expect(checkResponse.body.data.resume.category).toBe('Bridge');
    expect(checkResponse.body.data.resume.skills).toHaveLength(2);
    // Previous list-based items should be replaced by new ones as per implementation
    expect(checkResponse.body.data.resume.seaService).toHaveLength(0);
  });

  it('should return 401 if not logged in', async () => {
    const response = await request(app).get('/api/professional/resume');
    expect(response.status).toBe(401);
  });
});
