import { jest } from '@jest/globals';

type AsyncMock = jest.MockedFunction<(...args: unknown[]) => Promise<unknown>>;

const mockPrisma = {
  shareLink: {
    create: jest.fn() as AsyncMock,
    deleteMany: jest.fn() as AsyncMock,
    findUnique: jest.fn() as AsyncMock,
  },
};

jest.unstable_mockModule('../config/prisma.js', () => ({
  prisma: mockPrisma,
  Prisma: {},
}));

const { createShareCode, resolveShareToken, SHARE_CODE_LENGTH } =
  await import('../services/shareLinkService.js');

const JWT = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJwcm8tMSJ9.c2lnbmF0dXJl';

beforeEach(() => jest.clearAllMocks());

describe('createShareCode', () => {
  it('stores the signed token behind a short, unambiguous code', async () => {
    const expiresAt = new Date(Date.now() + 3600_000);
    const code = await createShareCode({
      professionalId: 'pro-1',
      token: JWT,
      expiresAt,
    });

    expect(code).toHaveLength(SHARE_CODE_LENGTH);
    expect(code).toMatch(/^[A-HJ-NP-Za-km-z2-9]+$/);
    expect(mockPrisma.shareLink.create).toHaveBeenCalledWith({
      data: { code, token: JWT, professionalId: 'pro-1', expiresAt },
    });
  });

  it('gives every link its own code', async () => {
    const expiresAt = new Date(Date.now() + 3600_000);
    const codes = await Promise.all(
      Array.from({ length: 200 }, () =>
        createShareCode({ professionalId: 'pro-1', token: JWT, expiresAt }),
      ),
    );
    expect(new Set(codes).size).toBe(200);
  });
});

describe('resolveShareToken', () => {
  it('looks a short code up', async () => {
    mockPrisma.shareLink.findUnique.mockResolvedValue({ token: JWT });
    expect(await resolveShareToken('Ab3dEf7hJk9m')).toBe(JWT);
  });

  it('keeps links sent before short codes working', async () => {
    expect(await resolveShareToken(JWT)).toBe(JWT);
    expect(mockPrisma.shareLink.findUnique).not.toHaveBeenCalled();
  });

  it('rejects unknown or malformed codes', async () => {
    mockPrisma.shareLink.findUnique.mockResolvedValue(null);
    expect(await resolveShareToken('Ab3dEf7hJk9m')).toBeNull();
    expect(await resolveShareToken('short')).toBeNull();
  });
});
