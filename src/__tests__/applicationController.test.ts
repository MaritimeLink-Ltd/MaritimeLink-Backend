import { jest } from '@jest/globals';

const mockPrisma = {
  professional: {
    findUnique: jest.fn(),
  },
  job: {
    findUnique: jest.fn(),
  },
  professionalDocument: {
    count: jest.fn(),
  },
  jobApplication: {
    findUnique: jest.fn(),
    count: jest.fn(),
    create: jest.fn(),
  },
  jobInvitation: {
    updateMany: jest.fn(),
  },
} as {
  professional: {
    findUnique: jest.MockedFunction<(...args: unknown[]) => Promise<unknown>>;
  };
  job: {
    findUnique: jest.MockedFunction<(...args: unknown[]) => Promise<unknown>>;
  };
  professionalDocument: {
    count: jest.MockedFunction<(...args: unknown[]) => Promise<number>>;
  };
  jobApplication: {
    findUnique: jest.MockedFunction<(...args: unknown[]) => Promise<unknown>>;
    count: jest.MockedFunction<(...args: unknown[]) => Promise<number>>;
    create: jest.MockedFunction<(...args: unknown[]) => Promise<unknown>>;
  };
  jobInvitation: {
    updateMany: jest.MockedFunction<(...args: unknown[]) => Promise<unknown>>;
  };
};

jest.unstable_mockModule('../config/prisma.js', () => ({
  prisma: mockPrisma,
  Prisma: {},
}));

jest.unstable_mockModule('../services/activityLogger.js', () => ({
  logActivity: jest.fn(),
}));

jest.unstable_mockModule('../services/eventNotificationService.js', () => ({
  notifyApplicationStatusChanged: jest.fn(),
  notifyJobApplicationSubmitted: jest.fn(),
  safeNotify: jest.fn(),
}));

const { applyToJob } = await import('../controllers/applicationController.js');
const { JobStatus } = await import('../generated/client/index.js');

describe('applicationController.applyToJob', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    mockPrisma.professional.findUnique.mockResolvedValue({
      tier: 'FREE',
      cvUrl: null,
      lastCoverLetter: null,
      resume: { id: 'resume-1' },
    });
    mockPrisma.job.findUnique.mockResolvedValue({
      id: 'job-1',
      title: 'Test Job',
      status: JobStatus.ACTIVE,
      closingDate: null,
    });
    mockPrisma.professionalDocument.count.mockResolvedValue(1);
    mockPrisma.jobApplication.findUnique.mockResolvedValue(null);
    mockPrisma.jobApplication.count.mockResolvedValue(0);
    mockPrisma.jobApplication.create.mockResolvedValue({
      id: 'app-1',
      jobId: 'job-1',
      professionalId: 'prof-1',
    });
    mockPrisma.jobInvitation.updateMany.mockResolvedValue({ count: 0 });
  });

  it('rejects applications when the job is no longer active', async () => {
    mockPrisma.job.findUnique.mockResolvedValue({
      id: 'job-1',
      title: 'Closed Job',
      status: JobStatus.FILLED,
      closingDate: null,
    });

    const response = await invokeApply({
      params: { id: 'job-1' },
      user: { id: 'prof-1' },
      body: {},
    });

    expect(response.statusCode).toBe(400);
    expect(response.payload).toEqual(
      expect.objectContaining({
        message: 'This job is no longer accepting applications.',
      }),
    );
    expect(mockPrisma.jobApplication.create).not.toHaveBeenCalled();
  });

  it('only counts active applications on open jobs toward the free limit', async () => {
    mockPrisma.jobApplication.count.mockResolvedValue(10);

    const response = await invokeApply({
      params: { id: 'job-1' },
      user: { id: 'prof-1' },
      body: {},
    });

    expect(response.statusCode).toBe(403);
    expect(mockPrisma.jobApplication.count).toHaveBeenCalledWith({
      where: {
        professionalId: 'prof-1',
        status: {
          in: expect.arrayContaining(['APPLIED', 'UNDER_REVIEW']),
        },
        job: {
          status: JobStatus.ACTIVE,
          OR: [
            { closingDate: null },
            { closingDate: { gt: expect.any(Date) } },
          ],
        },
      },
    });
    expect(response.payload).toEqual(
      expect.objectContaining({
        message: expect.stringContaining(
          'active job applications on open jobs',
        ),
      }),
    );
  });

  it('attaches only validated wallet documents owned by the applicant', async () => {
    const response = await invokeApply({
      params: { id: 'job-1' },
      user: { id: 'prof-1' },
      body: { documentIds: ['doc-1', 'doc-1'] },
    });

    expect(response.statusCode).toBe(201);
    expect(mockPrisma.professionalDocument.count).toHaveBeenCalledWith({
      where: {
        id: { in: ['doc-1'] },
        professionalId: 'prof-1',
        category: {
          notIn: ['CV_RESUME', 'COVER_LETTER'],
        },
      },
    });
    expect(mockPrisma.jobApplication.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        attachedDocuments: {
          connect: [{ id: 'doc-1' }],
        },
      }),
    });
  });
});

async function invokeApply(req: {
  params: { id: string };
  user: { id: string };
  body: Record<string, unknown>;
}) {
  return new Promise<{ statusCode: number; payload: unknown }>((resolve) => {
    const res = {
      status(code: number) {
        return {
          json(payload: unknown) {
            resolve({ statusCode: code, payload });
          },
        };
      },
    };

    applyToJob(
      req as never,
      res as never,
      ((error: unknown) => {
        const appError = error as { statusCode?: number; message?: string };
        resolve({
          statusCode: appError.statusCode || 500,
          payload: { message: appError.message || 'Unknown error' },
        });
      }) as never,
    );
  });
}
