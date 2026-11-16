import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import app from '../app.js';
import { prisma } from '../config/prisma.js';
import { env } from '../config/env.js';

/**
 * End-to-end check of short-lived file links: upload → API returns a signed
 * link while the database keeps the permanent one → the bucket is switched to
 * private → signed links and share links still work, the permanent public
 * link no longer does.
 *
 * This writes files to storage, so it only runs against a local stand-in for
 * Supabase Storage (SUPABASE_URL on localhost), never a real project.
 */
const runsAgainstLocalStorage = /localhost|127\.0\.0\.1/.test(env.SUPABASE_URL);
const describeLocal = runsAgainstLocalStorage ? describe : describe.skip;

describeLocal('Stored files are sent as short-lived signed links', () => {
  const suffix = `${Date.now()}`;
  let professionalId: string;
  let token: string;
  const bucket = env.SUPABASE_DOCUMENT_WALLET_BUCKET;
  const storageAdmin = env.SUPABASE_URL.replace(/\/+$/, '');

  beforeAll(async () => {
    const professional = await prisma.professional.create({
      data: {
        firstName: 'Signed',
        lastName: 'Links',
        fullname: 'Signed Links',
        email: `signed-${suffix}@example.com`,
        password: await bcrypt.hash('Password123!', 4),
        isVerified: true,
        status: 'VERIFIED',
        registrationStep: 5,
        tier: 'PRO',
      },
    });
    professionalId = professional.id;
    token = jwt.sign({ id: professionalId }, env.JWT_SECRET, {
      expiresIn: '1h',
    });
  });

  afterAll(async () => {
    await fetch(`${storageAdmin}/__bucket/${bucket}?public=true`, {
      method: 'PUT',
    });
    await prisma.professional.deleteMany({ where: { id: professionalId } });
    await prisma.$disconnect();
  });

  it('upload response and wallet list carry signed links; DB keeps the stored link', async () => {
    const upload = await request(app)
      .post('/api/professional/documents/upload')
      .set('Authorization', `Bearer ${token}`)
      .field('category', 'TRAVEL_DOCUMENTS')
      .field('name', 'Passport')
      .attach('document', Buffer.from('%PDF-1.4 test passport'), {
        filename: 'passport.pdf',
        contentType: 'application/pdf',
      });
    expect([200, 201]).toContain(upload.status);

    const stored = await prisma.professionalDocument.findFirst({
      where: { professionalId },
    });
    expect(stored?.fileUrl).toContain('/storage/v1/object/public/');

    const list = await request(app)
      .get('/api/professional/documents')
      .set('Authorization', `Bearer ${token}`);
    expect(list.status).toBe(200);
    const body = JSON.stringify(list.body);
    expect(body).toContain('/storage/v1/object/sign/');
    expect(body).not.toContain('/storage/v1/object/public/');
  });

  it('after the bucket goes private: public link fails, signed link and share link still work', async () => {
    const stored = await prisma.professionalDocument.findFirstOrThrow({
      where: { professionalId },
    });

    await fetch(`${storageAdmin}/__bucket/${bucket}?public=false`, {
      method: 'PUT',
    });

    const publicFetch = await fetch(stored.fileUrl);
    expect(publicFetch.ok).toBe(false);

    const list = await request(app)
      .get('/api/professional/documents')
      .set('Authorization', `Bearer ${token}`);
    const signedUrl = JSON.stringify(list.body).match(
      /https?:[^"]*\/storage\/v1\/object\/sign\/[^"]*/,
    )?.[0];
    expect(signedUrl).toBeDefined();
    const signedFetch = await fetch(signedUrl!);
    expect(signedFetch.ok).toBe(true);
    expect(await signedFetch.text()).toContain('test passport');

    const share = await request(app)
      .post('/api/professional/documents/share-link')
      .set('Authorization', `Bearer ${token}`)
      .send({ documentIds: [stored.id] });
    expect([200, 201]).toContain(share.status);
    const link: string =
      share.body.data?.secureLink ??
      share.body.data?.url ??
      share.body.secureLink ??
      JSON.stringify(share.body).match(/documents\/shared\/([^"]+)/)?.[0];
    const code = String(link).split('/').pop();

    const file = await request(app).get(
      `/api/professional/documents/shared/${code}/file/${stored.id}`,
    );
    expect(file.status).toBe(200);
    expect(file.headers['content-type']).toContain('application/pdf');
    expect(Buffer.from(file.body).toString()).toContain('test passport');
  });

  it('a signed link sent back by the app is stored in its permanent form', async () => {
    const stored = await prisma.professionalDocument.findFirstOrThrow({
      where: { professionalId },
    });
    const list = await request(app)
      .get('/api/professional/documents')
      .set('Authorization', `Bearer ${token}`);
    const signedUrl = JSON.stringify(list.body).match(
      /https?:[^"]*\/storage\/v1\/object\/sign\/[^"]*/,
    )?.[0];

    const kyc = await request(app)
      .post('/api/professional/kyc/submit')
      .set('Authorization', `Bearer ${token}`)
      .send({
        firstName: 'Signed',
        lastName: 'Links',
        dateOfBirth: '1990-01-01',
        documentType: 'PASSPORT',
        documentNumber: 'P123',
        expiryDate: '2035-01-01',
        issueCountry: 'GB',
        documentFrontUrl: signedUrl,
      });
    expect(kyc.status).toBe(200);
    const saved = await prisma.professionalKyc.findUniqueOrThrow({
      where: { professionalId },
    });
    expect(saved.documentFrontUrl).toBe(stored.fileUrl);
  });
});
