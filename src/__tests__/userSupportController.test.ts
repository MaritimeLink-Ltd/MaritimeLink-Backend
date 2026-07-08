import { jest } from '@jest/globals';

const mockPrisma = {
  professional: {
    findUnique: jest.fn(),
  },
  recruiter: {
    findUnique: jest.fn(),
  },
  supportCase: {
    count: jest.fn(),
    create: jest.fn(),
  },
} as {
  professional: {
    findUnique: jest.MockedFunction<(...args: unknown[]) => Promise<unknown>>;
  };
  recruiter: {
    findUnique: jest.MockedFunction<(...args: unknown[]) => Promise<unknown>>;
  };
  supportCase: {
    count: jest.MockedFunction<(...args: unknown[]) => Promise<number>>;
    create: jest.MockedFunction<(...args: unknown[]) => Promise<unknown>>;
  };
};

const logActivityMock: jest.MockedFunction<
  (...args: unknown[]) => Promise<void>
> = jest.fn();

jest.unstable_mockModule('../config/prisma.js', () => ({
  prisma: mockPrisma,
}));

jest.unstable_mockModule('../services/activityLogger.js', () => ({
  logActivity: logActivityMock,
}));

const { createCase } = await import('../controllers/userSupportController.js');

const createResponse = () => {
  const state: { statusCode?: number; payload?: unknown } = {};
  const res = {
    status(code: number) {
      state.statusCode = code;
      return {
        json(payload: unknown) {
          state.payload = payload;
          return undefined;
        },
      };
    },
  };
  return { res, state };
};

describe('userSupportController.createCase', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPrisma.supportCase.count.mockResolvedValue(2);
    mockPrisma.supportCase.create.mockImplementation((async (args: {
      data?: Record<string, unknown>;
    }) => ({
      id: 'case-1',
      ...(args?.data || {}),
    })) as never);
    logActivityMock.mockResolvedValue(undefined);
  });

  it('assigns HIGH priority to premium professionals', async () => {
    mockPrisma.professional.findUnique.mockResolvedValue({ tier: 'PRO' });
    const next = jest.fn();

    const req = {
      user: { id: 'prof-1' },
      body: {
        subject: 'Document issue',
        description: 'Mismatch on uploaded license',
        category: 'Document Wallet',
        priority: 'LOW',
      },
    } as never;
    const { res, state } = createResponse();

    createCase(req, res as never, next as never);
    await new Promise((resolve) => setImmediate(resolve));

    expect(state.statusCode).toBe(201);
    expect(mockPrisma.supportCase.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          priority: 'HIGH',
          userType: 'PROFESSIONAL',
        }),
      }),
    );
  });

  it('assigns LOW priority to free professionals', async () => {
    mockPrisma.professional.findUnique.mockResolvedValue({ tier: 'FREE' });
    const next = jest.fn();

    const req = {
      user: { id: 'prof-2' },
      body: {
        subject: 'Billing question',
        description: 'Need invoice copy',
        category: 'Billing',
      },
    } as never;
    const { res, state } = createResponse();

    createCase(req, res as never, next as never);
    await new Promise((resolve) => setImmediate(resolve));

    expect(state.statusCode).toBe(201);
    expect(mockPrisma.supportCase.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          priority: 'LOW',
          userType: 'PROFESSIONAL',
        }),
      }),
    );
  });

  it('assigns LOW priority to a Free-tier recruiter/trainer', async () => {
    mockPrisma.recruiter.findUnique.mockResolvedValue({ tier: 'FREE' });
    const next = jest.fn();
    const req = {
      user: {
        id: 'rec-1',
        email: 'trainer@example.com',
        role: 'TRAINING_AGENT',
      },
      body: {
        subject: 'Course issue',
        description: 'Need help with course setup',
        category: 'Course Booking',
        priority: 'HIGH',
      },
    } as never;
    const { res, state } = createResponse();

    createCase(req, res as never, next as never);
    await new Promise((resolve) => setImmediate(resolve));

    expect(state.statusCode).toBe(201);
    expect(mockPrisma.professional.findUnique).not.toHaveBeenCalled();
    expect(mockPrisma.recruiter.findUnique).toHaveBeenCalled();
    expect(mockPrisma.supportCase.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          priority: 'LOW',
          userType: 'RECRUITER',
        }),
      }),
    );
  });

  it('assigns HIGH priority to a Premium-tier recruiter/trainer', async () => {
    mockPrisma.recruiter.findUnique.mockResolvedValue({ tier: 'PREMIUM' });
    const next = jest.fn();
    const req = {
      user: {
        id: 'rec-2',
        email: 'premium-recruiter@example.com',
        role: 'RECRUITMENT_AGENT',
      },
      body: {
        subject: 'Job posting issue',
        description: 'Need help with a listing',
        category: 'Jobs',
      },
    } as never;
    const { res, state } = createResponse();

    createCase(req, res as never, next as never);
    await new Promise((resolve) => setImmediate(resolve));

    expect(state.statusCode).toBe(201);
    expect(mockPrisma.recruiter.findUnique).toHaveBeenCalled();
    expect(mockPrisma.supportCase.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          priority: 'HIGH',
          userType: 'RECRUITER',
        }),
      }),
    );
  });

  it('keeps platform admins at LOW priority without a recruiter lookup', async () => {
    const next = jest.fn();
    const req = {
      user: {
        id: 'admin-1',
        email: 'admin@example.com',
        role: 'SUPER_ADMIN',
      },
      body: {
        subject: 'Internal check',
        description: 'Testing admin-created case priority',
        category: 'Internal',
      },
    } as never;
    const { res, state } = createResponse();

    createCase(req, res as never, next as never);
    await new Promise((resolve) => setImmediate(resolve));

    expect(state.statusCode).toBe(201);
    expect(mockPrisma.professional.findUnique).not.toHaveBeenCalled();
    expect(mockPrisma.recruiter.findUnique).not.toHaveBeenCalled();
    expect(mockPrisma.supportCase.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          priority: 'LOW',
          userType: 'RECRUITER',
        }),
      }),
    );
  });
});
