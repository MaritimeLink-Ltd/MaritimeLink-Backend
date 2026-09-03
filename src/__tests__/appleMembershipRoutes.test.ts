import request from 'supertest';
import app from '../app.js';
import { prisma } from '../config/prisma.js';

describe('POST /api/professional/membership/apple/confirm', () => {
  const testRunId = Date.now();
  let professionalId: string;
  let token: string;

  beforeAll(async () => {
    const professional = await prisma.professional.create({
      data: {
        email: `apple_route_test_${testRunId}@example.com`,
        password: 'not-used-in-this-test',
        isVerified: true,
        status: 'VERIFIED',
      },
    });
    professionalId = professional.id;

    const jwt = (await import('jsonwebtoken')).default;
    const { env } = await import('../config/env.js');
    token = jwt.sign(
      { id: professionalId, role: 'PROFESSIONAL' },
      env.JWT_SECRET,
      {
        expiresIn: '1h',
      },
    );
  });

  afterAll(async () => {
    await prisma.professional
      .delete({ where: { id: professionalId } })
      .catch(() => {});
    await prisma.$disconnect();
  });

  it('requires auth', async () => {
    const res = await request(app)
      .post('/api/professional/membership/apple/confirm')
      .send({ signedTransactionInfo: 'anything' });
    expect(res.status).toBe(401);
  });

  it('requires signedTransactionInfo in the body', async () => {
    const res = await request(app)
      .post('/api/professional/membership/apple/confirm')
      .set('Authorization', `Bearer ${token}`)
      .send({});
    expect(res.status).toBe(400);
  });

  it('rejects a garbage/unsigned transaction rather than trusting it', async () => {
    const res = await request(app)
      .post('/api/professional/membership/apple/confirm')
      .set('Authorization', `Bearer ${token}`)
      .send({ signedTransactionInfo: 'not-a-real-jws' });

    expect(res.status).toBe(400);

    const professional = await prisma.professional.findUnique({
      where: { id: professionalId },
    });
    expect(professional?.tier).toBe('FREE');
  });
});

describe('POST /api/webhooks/apple', () => {
  it('rejects a request with no signedPayload', async () => {
    const res = await request(app).post('/api/webhooks/apple').send({});
    expect(res.status).toBe(400);
  });

  it('rejects a garbage signedPayload rather than trusting it', async () => {
    const res = await request(app)
      .post('/api/webhooks/apple')
      .send({ signedPayload: 'not-a-real-jws' });
    expect(res.status).toBe(400);
  });
});
