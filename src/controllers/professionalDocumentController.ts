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

    // Use OCR data if user provided data is missing
    const finalName = name || ocrData?.name || 'Untitled Document';
    const finalNumber = number || ocrData?.number;
    const finalIssuingCountry = issuingCountry || ocrData?.issuingCountry;
    const finalIssueDate = issueDate || ocrData?.issueDate;
    const finalExpiryDate = expiryDate || ocrData?.expiryDate;

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
      },
    });

    res.status(201).json({
      status: 'success',
      data: { document, ocrData },
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
