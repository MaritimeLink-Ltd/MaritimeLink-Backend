import { jest } from '@jest/globals';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';

type AsyncMock = jest.MockedFunction<(...args: unknown[]) => Promise<unknown>>;

const mockPrisma = {
  phoneHandoffToken: {
    create: jest.fn() as AsyncMock,
    deleteMany: jest.fn() as AsyncMock,
    updateMany: jest.fn() as AsyncMock,
    findUnique: jest.fn() as AsyncMock,
    findFirst: jest.fn() as AsyncMock,
  },
  professional: {
    findUnique: jest.fn() as AsyncMock,
  },
};
const logActivityMock = jest.fn() as AsyncMock;
const liftSuspensionMock = jest.fn() as AsyncMock;
const describeRestrictionMock =
  jest.fn<(...args: unknown[]) => string | null>();

jest.unstable_mockModule('../config/prisma.js', () => ({
  prisma: mockPrisma,
  Prisma: {},
}));
jest.unstable_mockModule('../services/activityLogger.js', () => ({
  logActivity: logActivityMock,
}));
jest.unstable_mockModule('../services/accountModerationService.js', () => ({
  liftExpiredProfessionalSuspension: liftSuspensionMock,
  describeRestriction: describeRestrictionMock,
}));

const { env } = await import('../config/env.js');
const {
  createPhoneHandoff,
  getPhoneHandoffStatus,
  redeemPhoneHandoff,
  PHONE_HANDOFF_TTL_MINUTES,
} = await import('../controllers/professionalPhoneHandoffController.js');

const sha256 = (value: string) =>
  crypto.createHash('sha256').update(value).digest('hex');

const mockRes = () => {
  const res = {
    statusCode: 0,
    body: undefined as unknown,
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    json(payload: unknown) {
      res.body = payload;
      return res;
    },
  };
  return res;
};

/** catchAsync hands back a function that doesn't return the promise, so wait for next/res. */
const run = async (
  handler: (req: never, res: never, next: never) => unknown,
  req: Record<string, unknown>,
) => {
  const res = mockRes();
  const next = jest.fn();
  await new Promise<void>((resolve) => {
    const done = () => resolve();
    res.json = ((json) => (payload: unknown) => {
      json(payload);
      done();
      return res;
    })(res.json.bind(res));
    next.mockImplementation(() => done());
    handler(req as never, res as never, next as never);
  });
  return { res, next };
};

const professional = {
  id: 'pro-1',
  fullname: 'Sam Seafarer',
  email: 'sam@example.com',
  profession: null,
  profilePhotoUrl: null,
  idPassportUrl: null,
  status: 'VERIFIED',
  isVerified: true,
  kyc: null,
};

beforeEach(() => {
  jest.clearAllMocks();
  liftSuspensionMock.mockResolvedValue('VERIFIED');
  describeRestrictionMock.mockReturnValue(null);
  mockPrisma.phoneHandoffToken.findUnique.mockResolvedValue({
    professionalId: 'pro-1',
  });
  mockPrisma.professional.findUnique.mockResolvedValue(professional);
  mockPrisma.phoneHandoffToken.create.mockResolvedValue({ id: 'h1' });
});

describe('createPhoneHandoff', () => {
  it('returns a random token and stores only its hash, valid for 10 minutes', async () => {
    const before = Date.now();
    const { res } = await run(createPhoneHandoff, { user: { id: 'pro-1' } });

    expect(res.statusCode).toBe(201);
    const { token, expiresAt } = (
      res.body as { data: { token: string; expiresAt: string } }
    ).data;
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    // Not a JWT: `protect` must never accept it as a login token.
    expect(token.split('.')).toHaveLength(1);

    const stored = mockPrisma.phoneHandoffToken.create.mock.calls[0][0] as {
      data: { tokenHash: string; professionalId: string; expiresAt: Date };
    };
    expect(stored.data.tokenHash).toBe(sha256(token));
    expect(stored.data.professionalId).toBe('pro-1');
    const ttlMs = Date.parse(expiresAt) - before;
    expect(ttlMs).toBeGreaterThanOrEqual(
      PHONE_HANDOFF_TTL_MINUTES * 60 * 1000 - 1000,
    );
    expect(ttlMs).toBeLessThanOrEqual(
      PHONE_HANDOFF_TTL_MINUTES * 60 * 1000 + 1000,
    );
  });
});

describe('redeemPhoneHandoff', () => {
  it('signs the phone in as the professional who created the link', async () => {
    mockPrisma.phoneHandoffToken.updateMany.mockResolvedValue({ count: 1 });

    const { res } = await run(redeemPhoneHandoff, {
      body: { token: 'abc' },
      get: () => 'iPhone',
      headers: {},
      socket: {},
    });

    expect(res.statusCode).toBe(200);
    const body = res.body as { token: string; data: { user: { id: string } } };
    expect(body.data.user.id).toBe('pro-1');
    expect((jwt.verify(body.token, env.JWT_SECRET) as { id: string }).id).toBe(
      'pro-1',
    );

    // Consumed atomically, and only while unused and unexpired.
    const where = (
      mockPrisma.phoneHandoffToken.updateMany.mock.calls[0][0] as {
        where: Record<string, unknown>;
      }
    ).where;
    expect(where.tokenHash).toBe(sha256('abc'));
    expect(where.usedAt).toBeNull();
    expect(where.expiresAt).toEqual({ gt: expect.any(Date) });
  });

  it('rejects a used, expired or unknown link', async () => {
    mockPrisma.phoneHandoffToken.updateMany.mockResolvedValue({ count: 0 });
    const { res, next } = await run(redeemPhoneHandoff, {
      body: { token: 'abc' },
    });

    expect(res.statusCode).toBe(0);
    expect((next.mock.calls[0][0] as { statusCode: number }).statusCode).toBe(
      401,
    );
    expect(mockPrisma.professional.findUnique).not.toHaveBeenCalled();
  });

  it('rejects a missing token without touching the database', async () => {
    const { next } = await run(redeemPhoneHandoff, { body: {} });
    expect((next.mock.calls[0][0] as { statusCode: number }).statusCode).toBe(
      401,
    );
    expect(mockPrisma.phoneHandoffToken.updateMany).not.toHaveBeenCalled();
  });

  it('applies the same account restrictions as a password login', async () => {
    mockPrisma.phoneHandoffToken.updateMany.mockResolvedValue({ count: 1 });
    describeRestrictionMock.mockReturnValue('Your account is suspended.');

    const { res, next } = await run(redeemPhoneHandoff, {
      body: { token: 'abc' },
    });
    expect(res.statusCode).toBe(0);
    expect((next.mock.calls[0][0] as { statusCode: number }).statusCode).toBe(
      403,
    );
  });
});

describe('getPhoneHandoffStatus', () => {
  const statusOf = async (row: unknown) => {
    mockPrisma.phoneHandoffToken.findFirst.mockResolvedValue(row);
    const { res } = await run(getPhoneHandoffStatus, {
      params: { id: 'h1' },
      user: { id: 'pro-1' },
    });
    return (res.body as { data: { usable: boolean } }).data.usable;
  };

  it('tells the desktop when its code has been used, expired or cleaned up', async () => {
    const future = new Date(Date.now() + 60_000);
    expect(await statusOf({ usedAt: null, expiresAt: future })).toBe(true);
    expect(await statusOf({ usedAt: new Date(), expiresAt: future })).toBe(
      false,
    );
    expect(
      await statusOf({ usedAt: null, expiresAt: new Date(Date.now() - 1000) }),
    ).toBe(false);
    expect(await statusOf(null)).toBe(false);
  });

  it('only looks at the professional’s own codes', async () => {
    await statusOf(null);
    expect(mockPrisma.phoneHandoffToken.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'h1', professionalId: 'pro-1' } }),
    );
  });
});
