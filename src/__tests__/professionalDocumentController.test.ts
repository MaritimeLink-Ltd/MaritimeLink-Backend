import { jest } from '@jest/globals';

const uploadToSupabaseMock: jest.MockedFunction<
  (...args: unknown[]) => Promise<string>
> = jest.fn();
const analyzeDocumentMock: jest.MockedFunction<
  (...args: unknown[]) => Promise<unknown>
> = jest.fn();
const validateDocumentTypeMock: jest.MockedFunction<
  (...args: unknown[]) => Promise<boolean>
> = jest.fn();

const mockPrisma = {
  professionalResume: {
    findUnique: jest.fn(),
  },
  professionalDocument: {
    create: jest.fn(),
  },
} as {
  professionalResume: {
    findUnique: jest.MockedFunction<(...args: unknown[]) => Promise<unknown>>;
  };
  professionalDocument: {
    create: jest.MockedFunction<(...args: unknown[]) => Promise<unknown>>;
  };
};

jest.unstable_mockModule('../services/storageService.js', () => ({
  uploadToSupabase: uploadToSupabaseMock,
}));

jest.unstable_mockModule('../services/geminiService.js', () => ({
  analyzeDocument: analyzeDocumentMock,
  validateDocumentType: validateDocumentTypeMock,
}));

jest.unstable_mockModule('../config/prisma.js', () => ({
  prisma: mockPrisma,
  Prisma: {},
}));

const { uploadDocument } =
  await import('../controllers/professionalDocumentController.js');

describe('professionalDocumentController.uploadDocument', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    uploadToSupabaseMock.mockResolvedValue(
      'https://example.com/documents/license.png',
    );
    analyzeDocumentMock.mockResolvedValue({
      number: '0000000000',
      issuingCountry: 'Pakistan',
      issueDate: '2026-04-02',
      expiryDate: '2026-04-30',
    });
    validateDocumentTypeMock.mockResolvedValue(true);
    mockPrisma.professionalDocument.create.mockResolvedValue({
      id: 'doc-1',
      fileUrl: 'https://example.com/documents/license.png',
      name: 'Screenshot 2026-05-02',
    });
  });

  it('compares license uploads against the resume license record', async () => {
    mockPrisma.professionalResume.findUnique.mockResolvedValue({
      licenses: [
        {
          name: 'Testing License',
          number: '9999999999',
          country: 'Pakistan',
          issueDate: new Date('2026-04-09'),
          expiryDate: new Date('2026-04-15'),
        },
      ],
      education: [],
      stcwCertificates: [],
      medicalCertificates: [],
      travelDocuments: [],
    });

    const req = {
      user: { id: 'prof-1' },
      file: {
        buffer: Buffer.from('fake-image-data'),
        mimetype: 'image/png',
        originalname: 'license.png',
      },
      body: {
        category: 'LICENSES_ENDORSEMENTS',
        name: 'Screenshot 2026-05-02',
        number: '',
        issuingCountry: '',
        issueDate: '',
        expiryDate: '',
      },
    } as never;

    const response = await new Promise<{
      statusCode: number;
      payload: unknown;
    }>((resolve) => {
      const res = {
        status(code: number) {
          return {
            json(payload: unknown) {
              resolve({ statusCode: code, payload });
            },
          };
        },
      };

      uploadDocument(req, res as never, jest.fn() as never);
    });

    expect(response.statusCode).toBe(201);
    const payload = response.payload as {
      data?: {
        matchStatus?: {
          isFullyMatched?: boolean;
          details?: {
            number?: { entered?: string | null; extracted?: string | null };
            issueDate?: { entered?: string | null; extracted?: string | null };
            expiryDate?: { entered?: string | null; extracted?: string | null };
          };
        };
      };
    };

    expect(payload.data?.matchStatus?.isFullyMatched).toBe(false);
    expect(payload.data?.matchStatus?.details?.number?.entered).toBe(
      '9999999999',
    );
    expect(payload.data?.matchStatus?.details?.number?.extracted).toBe(
      '0000000000',
    );
    expect(payload.data?.matchStatus?.details?.issueDate?.entered).toBe(
      '2026-04-09',
    );
    expect(payload.data?.matchStatus?.details?.expiryDate?.entered).toBe(
      '2026-04-15',
    );
    expect(mockPrisma.professionalResume.findUnique).toHaveBeenCalledWith({
      where: { professionalId: 'prof-1' },
      include: {
        licenses: true,
        education: true,
        stcwCertificates: true,
        medicalCertificates: true,
        travelDocuments: true,
      },
    });
  });

  it('does not use license resume data for STCW uploads', async () => {
    mockPrisma.professionalResume.findUnique.mockResolvedValue({
      licenses: [
        {
          name: 'Testing License',
          number: '9999999999',
          country: 'Pakistan',
          issueDate: new Date('2026-04-09'),
          expiryDate: new Date('2026-04-15'),
        },
      ],
      stcwCertificates: [],
      education: [],
      medicalCertificates: [],
      travelDocuments: [],
    });

    const req = {
      user: { id: 'prof-1' },
      file: {
        buffer: Buffer.from('fake-image-data'),
        mimetype: 'image/png',
        originalname: 'stcw.png',
      },
      body: {
        category: 'STCW_CERTIFICATES',
        name: 'Screenshot 2026-05-02 at 2',
        number: '',
        issuingCountry: '',
        issueDate: '',
        expiryDate: '',
      },
    } as never;

    const response = await new Promise<{
      statusCode: number;
      payload: unknown;
    }>((resolve) => {
      const res = {
        status(code: number) {
          return {
            json(payload: unknown) {
              resolve({ statusCode: code, payload });
            },
          };
        },
      };

      uploadDocument(req, res as never, jest.fn() as never);
    });

    expect(response.statusCode).toBe(201);
    const payload = response.payload as {
      data?: {
        matchStatus?: {
          details?: {
            issueDate?: { entered?: string | null };
            expiryDate?: { entered?: string | null };
          };
        };
      };
    };

    expect(payload.data?.matchStatus?.details?.issueDate?.entered).toBeNull();
    expect(payload.data?.matchStatus?.details?.expiryDate?.entered).toBeNull();
  });
});
