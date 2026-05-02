import { jest } from '@jest/globals';

const uploadToSupabaseMock = jest.fn() as jest.Mock;
const analyzeDocumentMock = jest.fn() as jest.Mock;
const validateDocumentTypeMock = jest.fn() as jest.Mock;

const mockPrisma = {
  professionalResume: {
    findUnique: jest.fn(),
  },
  professionalDocument: {
    create: jest.fn(),
  },
} as {
  professionalResume: {
    findUnique: jest.Mock;
  };
  professionalDocument: {
    create: jest.Mock;
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

  it('does not pull an unrelated resume record into OCR matching', async () => {
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
            issueDate?: { entered?: string | null; extracted?: string | null };
            expiryDate?: { entered?: string | null; extracted?: string | null };
          };
        };
      };
    };

    expect(payload.data?.matchStatus?.details?.issueDate?.entered).toBeNull();
    expect(payload.data?.matchStatus?.details?.expiryDate?.entered).toBeNull();
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
