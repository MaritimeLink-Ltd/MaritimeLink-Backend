import { Response, NextFunction } from 'express';
import { prisma, Prisma } from '../config/prisma.js';
import { AppError } from '../utils/AppError.js';
import { catchAsync } from '../utils/catchAsync.js';
import { uploadToSupabase } from '../services/storageService.js';
import {
  analyzeDocument,
  validateDocumentType,
} from '../services/geminiService.js';
import { env } from '../config/env.js';
import {
  uploadDocumentSchema,
  updateDocumentSchema,
} from '../validations/documentValidation.js';
import { CustomRequest } from '../types/index.js';
import {
  DocumentCategory,
  OCRStatus,
  VerificationStatus,
} from '../generated/client/index.js';

const DOCUMENT_CATEGORY_ALIASES: Record<string, DocumentCategory> = {
  STCW_CERTIFICATES: DocumentCategory.LICENSES_ENDORSEMENTS,
  STCW_CERTIFICATE: DocumentCategory.LICENSES_ENDORSEMENTS,
  STCW: DocumentCategory.LICENSES_ENDORSEMENTS,
};

const STCW_KEYWORDS = [
  'stcw',
  'basic safety',
  'safety training',
  'advanced firefighting',
  'medical first aid',
  'proficiency in survival craft',
  'survival craft',
  'bridge resource management',
  'engine room resource management',
  'radar',
  'gmdss',
  'ship security',
  'crowd management',
  'passenger safety',
  'watchkeeping',
];

const normalizeDocumentCategoryQuery = (value: unknown) => {
  if (typeof value !== 'string') return undefined;

  const normalized = value
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, '_');
  return (
    DOCUMENT_CATEGORY_ALIASES[normalized] || (normalized as DocumentCategory)
  );
};

const normalizeText = (value?: string | null) =>
  String(value || '')
    .trim()
    .toLowerCase();

const getDocumentDisplayCategory = (document: {
  category: DocumentCategory;
  name?: string | null;
  ocrData?: Prisma.JsonValue | null;
}) => {
  const rawCategory = String(document.category || '').toUpperCase();
  const ocrData = (document.ocrData || {}) as Record<string, unknown>;
  const sourceCategory = normalizeText(
    typeof ocrData.sourceCategory === 'string'
      ? ocrData.sourceCategory
      : undefined,
  );
  const searchableText = [
    document.name,
    typeof ocrData.name === 'string' ? ocrData.name : '',
    typeof ocrData.qualification === 'string' ? ocrData.qualification : '',
    typeof ocrData.title === 'string' ? ocrData.title : '',
    typeof ocrData.description === 'string' ? ocrData.description : '',
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  if (
    sourceCategory.includes('stcw') ||
    STCW_KEYWORDS.some((keyword) => searchableText.includes(keyword))
  ) {
    return 'stcw';
  }

  const inferredMap: Record<string, string> = {
    LICENSES_ENDORSEMENTS: 'licenses',
    MEDICAL_CERTIFICATES: 'medical',
    TRAVEL_DOCUMENTS: 'travel',
    SEAMANS_BOOK: 'seaman',
    ACADEMIC_QUALIFICATIONS: 'academic',
    MISC_COMPANY_LETTERS: 'company',
    RECENT_APPRAISALS: 'appraisals',
    CV_RESUME: 'resume',
    COVER_LETTER: 'cover-letter',
  };

  return inferredMap[rawCategory] || 'company';
};

type DocumentMatchValues = {
  name?: string | null;
  number?: string | null;
  issuingCountry?: string | null;
  issueDate?: string | Date | null;
  expiryDate?: string | Date | null;
};

const normalizeMatchText = (value?: string | null) =>
  value
    ?.trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim() || '';

const toDateOnly = (value?: string | Date | null) => {
  if (!value) return null;
  try {
    return new Date(value).toISOString().split('T')[0];
  } catch {
    return null;
  }
};

const isTextMatch = (left?: string | null, right?: string | null) => {
  const normalizedLeft = normalizeMatchText(left);
  const normalizedRight = normalizeMatchText(right);

  if (!normalizedLeft || !normalizedRight) return false;

  return (
    normalizedLeft === normalizedRight ||
    normalizedLeft.includes(normalizedRight) ||
    normalizedRight.includes(normalizedLeft)
  );
};

const isDateMatch = (
  left?: string | Date | null,
  right?: string | Date | null,
) => {
  const leftDate = toDateOnly(left);
  const rightDate = toDateOnly(right);

  return Boolean(leftDate && rightDate && leftDate === rightDate);
};

const scoreResumeDocumentCandidate = (
  candidate: DocumentMatchValues,
  expected: DocumentMatchValues,
) => {
  let score = 0;

  if (isTextMatch(candidate.number, expected.number)) score += 8;
  if (isTextMatch(candidate.name, expected.name)) score += 4;
  if (isTextMatch(candidate.issuingCountry, expected.issuingCountry))
    score += 3;
  if (isDateMatch(candidate.issueDate, expected.issueDate)) score += 2;
  if (isDateMatch(candidate.expiryDate, expected.expiryDate)) score += 2;

  return score;
};

const getResumeDocumentFallback = async (
  professionalId: string,
  category: DocumentCategory,
  rawCategory: string | undefined,
  requestValues: DocumentMatchValues,
  ocrValues: DocumentMatchValues | null,
) => {
  const resume = await prisma.professionalResume.findUnique({
    where: { professionalId },
    include: {
      licenses: true,
      education: true,
      stcwCertificates: true,
      medicalCertificates: true,
      travelDocuments: true,
    },
  });

  if (!resume) return null;

  let candidates: DocumentMatchValues[] = [];

  const normalizedRawCategory = rawCategory?.trim().toUpperCase();
  const isStcwUpload =
    normalizedRawCategory === 'STCW_CERTIFICATES' ||
    normalizedRawCategory === 'STCW_CERTIFICATE' ||
    normalizedRawCategory === 'STCW';

  if (category === DocumentCategory.LICENSES_ENDORSEMENTS && !isStcwUpload) {
    candidates = [
      ...resume.licenses.map((license) => ({
        name: license.name,
        number: license.number,
        issuingCountry: license.country,
        issueDate: license.issueDate,
        expiryDate: license.expiryDate,
      })),
    ];
  }

  if (isStcwUpload) {
    candidates = resume.stcwCertificates.map((certificate) => ({
      name: certificate.qualification,
      number: certificate.certificateNumber,
      issuingCountry: certificate.issuingCountry,
      issueDate: certificate.issueDate,
      expiryDate: certificate.expiryDate,
    }));
  }

  if (category === DocumentCategory.MEDICAL_CERTIFICATES) {
    candidates = resume.medicalCertificates.map((certificate) => ({
      name: certificate.name,
      number: certificate.documentNumber || certificate.certificateNumber,
      issuingCountry:
        certificate.issuingCountry || certificate.institutionCountry,
      issueDate: certificate.issueDate,
      expiryDate: certificate.expiryDate,
    }));
  }

  if (
    category === DocumentCategory.TRAVEL_DOCUMENTS ||
    category === DocumentCategory.SEAMANS_BOOK
  ) {
    candidates = resume.travelDocuments.map((document) => ({
      name: document.name,
      number: document.documentNumber,
      issuingCountry: document.issuingCountry || document.institutionCountry,
      issueDate: document.issueDate,
      expiryDate: document.expiryDate,
    }));
  }

  if (category === DocumentCategory.ACADEMIC_QUALIFICATIONS) {
    candidates = resume.education.map((education) => ({
      name: education.qualificationName,
      issuingCountry: education.country,
      issueDate: education.startDate,
      expiryDate: education.endDate,
    }));
  }

  if (candidates.length === 0) return null;

  const expected = {
    name: requestValues.name || ocrValues?.name,
    number: requestValues.number || ocrValues?.number,
    issuingCountry: requestValues.issuingCountry || ocrValues?.issuingCountry,
    issueDate: requestValues.issueDate || ocrValues?.issueDate,
    expiryDate: requestValues.expiryDate || ocrValues?.expiryDate,
  };

  const scoredCandidates = candidates
    .map((candidate) => ({
      candidate,
      score: scoreResumeDocumentCandidate(candidate, expected),
    }))
    .sort((a, b) => b.score - a.score);

  // Require a meaningful score before borrowing data from an existing resume entry.
  // A shared country alone is too weak and causes false "mismatch" banners.
  if (scoredCandidates[0]?.score >= 4) {
    return scoredCandidates[0].candidate;
  }

  // Only reuse resume data when we have at least one meaningful field match.
  // Returning an unrelated single candidate here causes false OCR mismatch banners
  // for users whose resume contains only a loosely related document.
  return null;
};

export const uploadDocument = catchAsync(
  async (req: CustomRequest, res: Response, next: NextFunction) => {
    if (!req.file) {
      return next(new AppError('Please upload a document file', 400));
    }

    const normalizeDateInput = (value: unknown) => {
      if (typeof value !== 'string' || !value.trim()) return value;

      const trimmed = value.trim();
      if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;

      const slashDateMatch = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
      if (slashDateMatch) {
        const [, month, day, year] = slashDateMatch;
        return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
      }

      return trimmed;
    };

    const bodyWithAliases = {
      ...req.body,
      number:
        req.body.number ||
        req.body.certificateNumber ||
        req.body.documentNumber,
      issuingCountry:
        req.body.issuingCountry ||
        req.body.issueCountry ||
        req.body.country ||
        req.body.issuingAuthorityCountry,
      issueDate: normalizeDateInput(
        req.body.issueDate || req.body.dateOfIssue || req.body.issuedAt,
      ),
      expiryDate: normalizeDateInput(
        req.body.expiryDate ||
          req.body.validTill ||
          req.body.validUntil ||
          req.body.expirationDate,
      ),
    };

    // Parse body data
    const validation = uploadDocumentSchema.safeParse(bodyWithAliases);

    if (!validation.success) {
      return next(new AppError(validation.error.issues[0].message, 400));
    }

    const { category, name, number, issuingCountry, issueDate, expiryDate } =
      validation.data;
    const rawCategory =
      typeof req.body.category === 'string' ? req.body.category : undefined;

    const professionalId = req.user?.id;

    if (!professionalId) {
      return next(new AppError('User not authenticated', 401));
    }

    // Upload to Supabase
    const sanitizedOriginalName = req.file.originalname.replace(
      /[^a-zA-Z0-9.]/g,
      '_',
    );
    const fileName = `${professionalId}/${Date.now()}-${sanitizedOriginalName}`;
    const publicUrl = await uploadToSupabase(
      req.file,
      fileName,
      env.SUPABASE_DOCUMENT_WALLET_BUCKET,
    );

    // 4. Gemini OCR Analysis (Parallelize if possible, but here we need results for DB)
    let ocrData = null;

    try {
      if (req.file.buffer) {
        const result = await analyzeDocument(
          req.file.buffer,
          req.file.mimetype,
        );
        if (result) {
          ocrData = result;
        }
      }
    } catch (error) {
      console.error('OCR Analysis failed:', error);
    }

    // 5. Cross-check Document Type (Optional but recommended)
    try {
      if (req.file.buffer && category) {
        await validateDocumentType(
          req.file.buffer,
          req.file.mimetype,
          category,
        );
      }
    } catch (error) {
      console.error('Document type validation failed:', error);
    }

    const resumeDocumentFallback = await getResumeDocumentFallback(
      professionalId,
      category,
      rawCategory,
      { name, number, issuingCountry, issueDate, expiryDate },
      ocrData,
    );

    const enteredName = name || resumeDocumentFallback?.name || null;
    const enteredNumber = number || resumeDocumentFallback?.number || null;
    const enteredIssuingCountry =
      issuingCountry || resumeDocumentFallback?.issuingCountry || null;
    const enteredIssueDate =
      toDateOnly(issueDate || resumeDocumentFallback?.issueDate) || null;
    const enteredExpiryDate =
      toDateOnly(expiryDate || resumeDocumentFallback?.expiryDate) || null;

    // Match Verification Logic
    const compare = (val1?: string | null, val2?: string | null) => {
      return isTextMatch(val1, val2);
    };

    const compareDateStr = (
      d1?: string | Date | null,
      d2?: string | Date | null,
    ) => {
      try {
        if (!d1 || !d2) return false;
        const date1 = new Date(d1).toISOString().split('T')[0];
        const date2 = new Date(d2).toISOString().split('T')[0];
        return date1 === date2;
      } catch {
        return false;
      }
    };

    const matchDetails = {
      name: {
        entered: enteredName,
        extracted: ocrData?.name || null,
        isMatched: ocrData?.name ? compare(enteredName, ocrData.name) : true,
      },
      number: {
        entered: enteredNumber,
        extracted: ocrData?.number || null,
        isMatched: compare(enteredNumber, ocrData?.number),
      },
      issuingCountry: {
        entered: enteredIssuingCountry,
        extracted: ocrData?.issuingCountry || null,
        isMatched: compare(enteredIssuingCountry, ocrData?.issuingCountry),
      },
      issueDate: {
        entered: enteredIssueDate,
        extracted: toDateOnly(ocrData?.issueDate) || null,
        isMatched: compareDateStr(enteredIssueDate, ocrData?.issueDate),
      },
      expiryDate: {
        entered: enteredExpiryDate,
        extracted: toDateOnly(ocrData?.expiryDate) || null,
        isMatched: compareDateStr(enteredExpiryDate, ocrData?.expiryDate),
      },
    };

    const comparableMatchDetails = [
      matchDetails.number,
      matchDetails.issuingCountry,
      matchDetails.issueDate,
      matchDetails.expiryDate,
    ];

    let isFullyMatched = true;
    if (enteredNumber && !matchDetails.number.isMatched) isFullyMatched = false;
    if (enteredIssuingCountry && !matchDetails.issuingCountry.isMatched)
      isFullyMatched = false;
    if (enteredIssueDate && !matchDetails.issueDate.isMatched)
      isFullyMatched = false;
    if (enteredExpiryDate && !matchDetails.expiryDate.isMatched)
      isFullyMatched = false;
    if (!ocrData || Object.keys(ocrData).length === 0) isFullyMatched = false;

    const hasOcrData = Boolean(ocrData && Object.keys(ocrData).length > 0);
    const hasEnteredOcrMismatch =
      hasOcrData &&
      comparableMatchDetails.some(
        (detail) =>
          Boolean(detail.entered) &&
          Boolean(detail.extracted) &&
          !detail.isMatched,
      );

    const matchStatus = {
      isFullyMatched,
      details: matchDetails,
    };

    // Use OCR data if user provided data is missing
    const finalName = enteredName || ocrData?.name || 'Untitled Document';
    const finalNumber = enteredNumber || ocrData?.number;
    const finalIssuingCountry =
      enteredIssuingCountry || ocrData?.issuingCountry;
    const finalIssueDate = enteredIssueDate || ocrData?.issueDate;
    const finalExpiryDate = enteredExpiryDate || ocrData?.expiryDate;
    const savedOcrData: Prisma.InputJsonValue | undefined = ocrData
      ? { ...ocrData, sourceCategory: rawCategory || category }
      : undefined;

    // 6. Create DB Record
    const document = await prisma.professionalDocument.create({
      data: {
        professionalId,
        category,
        name: finalName,
        number: finalNumber,
        issuingCountry: finalIssuingCountry,
        issueDate: finalIssueDate ? new Date(finalIssueDate) : null,
        expiryDate: finalExpiryDate ? new Date(finalExpiryDate) : null,
        fileUrl: publicUrl,
        mimeType: req.file.mimetype,
        ocrData: savedOcrData,
        ocrStatus: hasOcrData ? OCRStatus.COMPLETED : OCRStatus.FAILED,
        verificationStatus: hasEnteredOcrMismatch
          ? VerificationStatus.MISMATCH
          : VerificationStatus.PENDING,
      },
    });

    res.status(201).json({
      status: 'success',
      data: { document, ocrData, matchStatus },
    });
  },
);

export const uploadResume = catchAsync(
  async (req: CustomRequest, res: Response, next: NextFunction) => {
    if (!req.file) {
      return next(new AppError('Please upload a resume file', 400));
    }

    const professionalId = req.user?.id;
    if (!professionalId) {
      return next(new AppError('User not authenticated', 401));
    }

    // Upload to Supabase 'resumes' bucket
    const sanitizedOriginalName = req.file.originalname.replace(
      /[^a-zA-Z0-9.]/g,
      '_',
    );
    const fileName = `${professionalId}/resumes/${Date.now()}-${sanitizedOriginalName}`;

    const publicUrl = await uploadToSupabase(
      req.file,
      fileName,
      env.SUPABASE_RESUME_BUCKET,
    );

    // Save to ProfessionalDocument wallet for history
    const document = await prisma.professionalDocument.create({
      data: {
        professionalId,
        category: DocumentCategory.CV_RESUME,
        name: sanitizedOriginalName,
        fileUrl: publicUrl,
        ocrStatus: OCRStatus.COMPLETED,
        verificationStatus: VerificationStatus.PENDING,
      },
    });

    // Update Professional profile with the latest CV URL
    await prisma.professional.update({
      where: { id: professionalId },
      data: { cvUrl: publicUrl },
    });

    res.status(201).json({
      status: 'success',
      message: 'Resume uploaded successfully',
      data: { url: publicUrl, documentId: document.id },
    });
  },
);

export const uploadCoverLetter = catchAsync(
  async (req: CustomRequest, res: Response, next: NextFunction) => {
    if (!req.file) {
      return next(new AppError('Please upload a cover letter file', 400));
    }

    const professionalId = req.user?.id;
    if (!professionalId) {
      return next(new AppError('User not authenticated', 401));
    }

    // Upload to Supabase bucket
    const sanitizedOriginalName = req.file.originalname.replace(
      /[^a-zA-Z0-9.]/g,
      '_',
    );
    const fileName = `${professionalId}/cover-letters/${Date.now()}-${sanitizedOriginalName}`;

    // Using simple document wallet bucket
    const publicUrl = await uploadToSupabase(
      req.file,
      fileName,
      env.SUPABASE_DOCUMENT_WALLET_BUCKET,
    );

    // Save to ProfessionalDocument wallet for history
    const document = await prisma.professionalDocument.create({
      data: {
        professionalId,
        category: DocumentCategory.COVER_LETTER,
        name: sanitizedOriginalName,
        fileUrl: publicUrl,
        ocrStatus: OCRStatus.COMPLETED,
        verificationStatus: VerificationStatus.PENDING,
      },
    });

    res.status(201).json({
      status: 'success',
      message: 'Cover letter uploaded successfully',
      data: { url: publicUrl, documentId: document.id },
    });
  },
);

export const getMyResumes = catchAsync(
  async (req: CustomRequest, res: Response) => {
    const professionalId = req.user?.id;

    const resumes = await prisma.professionalDocument.findMany({
      where: {
        professionalId,
        category: DocumentCategory.CV_RESUME,
      },
      orderBy: { createdAt: 'desc' },
    });

    res.status(200).json({
      status: 'success',
      results: resumes.length,
      data: { resumes },
    });
  },
);

export const getDocuments = catchAsync(
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async (req: CustomRequest, res: Response, _next: NextFunction) => {
    const professionalId = req.user?.id;
    const { category } = req.query;

    const where: Prisma.ProfessionalDocumentWhereInput = { professionalId };
    const rawCategory =
      typeof category === 'string' ? category.trim().toUpperCase() : '';
    const normalizedCategory = category
      ? normalizeDocumentCategoryQuery(category)
      : undefined;

    if (normalizedCategory) {
      where.category = normalizedCategory;
    }

    const documents = await prisma.professionalDocument.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    });

    const summary = documents.reduce(
      (acc, document) => {
        const displayCategory = getDocumentDisplayCategory(document);
        acc[displayCategory] = (acc[displayCategory] || 0) + 1;
        acc.total += 1;
        return acc;
      },
      {
        total: 0,
        licenses: 0,
        stcw: 0,
        medical: 0,
        seaman: 0,
        travel: 0,
        academic: 0,
        company: 0,
        appraisals: 0,
        resume: 0,
        'cover-letter': 0,
      } as Record<string, number>,
    );

    const filteredDocuments =
      rawCategory === 'STCW_CERTIFICATES' ||
      rawCategory === 'STCW_CERTIFICATE' ||
      rawCategory === 'STCW'
        ? documents.filter(
            (document) => getDocumentDisplayCategory(document) === 'stcw',
          )
        : rawCategory === 'LICENSES_ENDORSEMENTS'
          ? documents.filter(
              (document) => getDocumentDisplayCategory(document) === 'licenses',
            )
          : documents;

    res.status(200).json({
      status: 'success',
      results: filteredDocuments.length,
      data: {
        summary,
        documents: filteredDocuments.map((document) => ({
          ...document,
          displayCategory: getDocumentDisplayCategory(document),
        })),
      },
    });
  },
);

export const updateDocument = catchAsync(
  async (req: CustomRequest, res: Response, next: NextFunction) => {
    const { id } = req.params;
    const validation = updateDocumentSchema.safeParse(req.body);

    if (!validation.success) {
      return next(new AppError(validation.error.issues[0].message, 400));
    }

    const document = await prisma.professionalDocument.findUnique({
      where: { id },
    });

    if (!document) {
      return next(new AppError('Document not found', 404));
    }

    if (document.professionalId !== req.user?.id) {
      return next(
        new AppError('You are not authorized to update this document', 403),
      );
    }

    const { issueDate, expiryDate, ...otherData } = validation.data;

    const updatedDocument = await prisma.professionalDocument.update({
      where: { id },
      data: {
        ...otherData,
        issueDate: issueDate ? new Date(issueDate) : undefined,
        expiryDate: expiryDate ? new Date(expiryDate) : undefined,
      },
    });

    res.status(200).json({
      status: 'success',
      data: { document: updatedDocument },
    });
  },
);

export const deleteDocument = catchAsync(
  async (req: CustomRequest, res: Response, next: NextFunction) => {
    const { id } = req.params;

    const document = await prisma.professionalDocument.findUnique({
      where: { id },
    });

    if (!document) {
      return next(new AppError('Document not found', 404));
    }

    if (document.professionalId !== req.user?.id) {
      return next(
        new AppError('You are not authorized to delete this document', 403),
      );
    }

    await prisma.professionalDocument.delete({
      where: { id },
    });

    res.status(204).json({
      status: 'success',
      data: null,
    });
  },
);
