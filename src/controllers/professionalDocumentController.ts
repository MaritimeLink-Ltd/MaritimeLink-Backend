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

export const uploadDocument = catchAsync(
  async (req: CustomRequest, res: Response, next: NextFunction) => {
    if (!req.file) {
      return next(new AppError('Please upload a document file', 400));
    }

    // Parse body data
    const validation = uploadDocumentSchema.safeParse(req.body);

    if (!validation.success) {
      return next(new AppError(validation.error.issues[0].message, 400));
    }

    const { category, name, number, issuingCountry, issueDate, expiryDate } =
      validation.data;

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

    // Match Verification Logic
    const compare = (val1?: string | null, val2?: string | null) => {
      if (!val1 || !val2) return false;
      return val1.trim().toLowerCase() === val2.trim().toLowerCase();
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
        entered: name || null,
        extracted: ocrData?.name || null,
        isMatched: compare(name, ocrData?.name),
      },
      number: {
        entered: number || null,
        extracted: ocrData?.number || null,
        isMatched: compare(number, ocrData?.number),
      },
      issuingCountry: {
        entered: issuingCountry || null,
        extracted: ocrData?.issuingCountry || null,
        isMatched: compare(issuingCountry, ocrData?.issuingCountry),
      },
      issueDate: {
        entered: issueDate || null,
        extracted: ocrData?.issueDate || null,
        isMatched: compareDateStr(issueDate, ocrData?.issueDate),
      },
      expiryDate: {
        entered: expiryDate || null,
        extracted: ocrData?.expiryDate || null,
        isMatched: compareDateStr(expiryDate, ocrData?.expiryDate),
      },
    };

    let isFullyMatched = true;
    if (name && !matchDetails.name.isMatched) isFullyMatched = false;
    if (number && !matchDetails.number.isMatched) isFullyMatched = false;
    if (issuingCountry && !matchDetails.issuingCountry.isMatched)
      isFullyMatched = false;
    if (issueDate && !matchDetails.issueDate.isMatched) isFullyMatched = false;
    if (expiryDate && !matchDetails.expiryDate.isMatched)
      isFullyMatched = false;
    if (!ocrData || Object.keys(ocrData).length === 0) isFullyMatched = false;

    const hasOcrData = Boolean(ocrData && Object.keys(ocrData).length > 0);
    const hasEnteredOcrMismatch =
      hasOcrData &&
      Object.values(matchDetails).some(
        (detail) => Boolean(detail.entered) && !detail.isMatched,
      );

    const matchStatus = {
      isFullyMatched,
      details: matchDetails,
    };

    // Use OCR data if user provided data is missing
    const finalName = name || ocrData?.name || 'Untitled Document';
    const finalNumber = number || ocrData?.number;
    const finalIssuingCountry = issuingCountry || ocrData?.issuingCountry;
    const finalIssueDate = issueDate || ocrData?.issueDate;
    const finalExpiryDate = expiryDate || ocrData?.expiryDate;
    const savedOcrData: Prisma.InputJsonValue | undefined = ocrData
      ? { ...ocrData }
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
    if (category) {
      where.category = category as Prisma.EnumDocumentCategoryFilter;
    }

    const documents = await prisma.professionalDocument.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    });

    res.status(200).json({
      status: 'success',
      results: documents.length,
      data: { documents },
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
