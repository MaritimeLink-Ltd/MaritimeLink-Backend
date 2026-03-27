import { Response, NextFunction } from 'express';
import { CustomRequest } from '../types/index.js';
import { prisma } from '../config/prisma.js';
import { env } from '../config/env.js';
import { AppError } from '../utils/AppError.js';
import { catchAsync } from '../utils/catchAsync.js';
import { uploadToSupabase } from '../services/storageService.js';
import {
  analyzeDocument,
  validateDocumentType,
} from '../services/geminiService.js';
import { submitKYCSchema } from '../validations/kycValidation.js';

/**
 * Helper to upload KYC doc and return signed URL
 */
const processKYCUpload = async (
  file: Express.Multer.File,
  side: 'front' | 'back' | 'selfie',
  professionalId: string | undefined,
) => {
  const sanitizedOriginalName = file.originalname.replace(
    /[^a-zA-Z0-9.]/g,
    '_',
  );
  const path = `professional-kyc-docs/${professionalId || 'unknown'}/${Date.now()}-${side}-${sanitizedOriginalName}`;

  const publicUrl = await uploadToSupabase(
    file,
    path,
    env.SUPABASE_PROFESSIONAL_KYC_DOCS_BUCKET,
  );

  return { publicUrl, path };
};

/**
 * Upload Identity Document Front
 */
export const uploadKYCDocumentFront = catchAsync(
  async (req: CustomRequest, res: Response, next: NextFunction) => {
    const file = req.file;
    if (!file) {
      return next(
        new AppError('Please upload the front of your document', 400),
      );
    }

    const { publicUrl } = await processKYCUpload(file, 'front', req.user?.id);

    // Gemini OCR Analysis (on front side usually)
    let ocrData = null;
    try {
      if (file.buffer) {
        ocrData = await analyzeDocument(file.buffer, file.mimetype);
      }
    } catch (error) {
      console.error('Professional KYC OCR Front failed:', error);
    }

    res.status(200).json({
      status: 'success',
      message: 'Front document uploaded successfully.',
      data: {
        url: publicUrl,
        ocrData,
      },
    });
  },
);

/**
 * Upload Identity Document Back
 */
export const uploadKYCDocumentBack = catchAsync(
  async (req: CustomRequest, res: Response, next: NextFunction) => {
    const file = req.file;
    if (!file) {
      return next(new AppError('Please upload the back of your document', 400));
    }

    const { publicUrl } = await processKYCUpload(file, 'back', req.user?.id);

    res.status(200).json({
      status: 'success',
      message: 'Back document uploaded successfully.',
      data: {
        url: publicUrl,
      },
    });
  },
);

/**
 * Upload Identity Document (Legacy single upload)
 */
export const uploadKYCDocument = catchAsync(
  async (req: CustomRequest, res: Response, next: NextFunction) => {
    const file = req.file;

    if (!file) {
      return next(
        new AppError('Please upload an identity document image', 400),
      );
    }

    const { publicUrl } = await processKYCUpload(file, 'front', req.user?.id);

    // Gemini OCR Analysis
    let ocrData = null;
    try {
      if (file.buffer) {
        ocrData = await analyzeDocument(file.buffer, file.mimetype);
      }
    } catch (error) {
      console.error('Professional KYC OCR analysis failed:', error);
    }

    // Validate if the document is actually a valid KYC document (General check)
    let isTypeValidated = true;
    try {
      if (file.buffer) {
        isTypeValidated = await validateDocumentType(
          file.buffer,
          file.mimetype,
          'Identity Document',
        );
      }
    } catch (error) {
      console.error('Professional KYC document type validation failed:', error);
    }

    res.status(200).json({
      status: 'success',
      message: 'Document uploaded successfully.',
      data: {
        url: publicUrl,
        ocrData,
        isTypeValidated,
      },
    });
  },
);

/**
 * Submit KYC Details (Step 2)
 */
export const submitKYC = catchAsync(
  async (req: CustomRequest, res: Response, next: NextFunction) => {
    const { professionalId } = req.body;

    if (!professionalId) {
      return next(new AppError('professionalId is required', 400));
    }

    const validationResult = submitKYCSchema.safeParse(req.body);

    if (!validationResult.success) {
      return next(new AppError(validationResult.error.message, 400));
    }

    const {
      firstName,
      lastName,
      dateOfBirth,
      documentType,
      documentNumber,
      expiryDate,
      issueCountry,
      documentUrl, // Legacy
      documentFrontUrl,
      documentBackUrl,
    } = validationResult.data;

    // Check if KYC already exists
    const existingKyc = await prisma.professionalKyc.findUnique({
      where: { professionalId },
    });

    if (existingKyc && existingKyc.status === 'APPROVED') {
      return next(new AppError('KYC already approved', 400));
    }

    const kycData = {
      firstName,
      lastName,
      dateOfBirth: new Date(dateOfBirth),
      documentType,
      documentNumber,
      expiryDate: new Date(expiryDate),
      issueCountry,
      // Mapping logic: if new fields are present, use them. Otherwise fallback to documentUrl
      documentFrontUrl: documentFrontUrl || documentUrl,
      documentBackUrl,
      // We explicitly provide documentUrl for backward compatibility in DB if schema hasn't migrated yet
      // but since I changed schema to documentFrontUrl/BackUrl, I'll use those.
      status: 'PENDING' as const,
    };

    if (existingKyc) {
      await prisma.professionalKyc.update({
        where: { professionalId },
        data: kycData,
      });
    } else {
      await prisma.professionalKyc.create({
        data: {
          ...kycData,
          professionalId,
        },
      });
    }

    res.status(200).json({
      status: 'success',
      message:
        'KYC details submitted successfully. Please upload a selfie next.',
    });
  },
);

/**
 * Upload Selfie (Step 3)
 */
export const uploadKYCSelfie = catchAsync(
  async (req: CustomRequest, res: Response, next: NextFunction) => {
    const file = req.file;
    const { professionalId } = req.body;

    if (!file) {
      return next(new AppError('Please upload a selfie image', 400));
    }

    if (!professionalId) {
      return next(new AppError('professionalId is required', 400));
    }

    const { publicUrl } = await processKYCUpload(
      file,
      'selfie',
      professionalId,
    );

    // Update the KYC record with the selfie URL
    await prisma.professionalKyc.update({
      where: { professionalId },
      data: { selfieUrl: publicUrl },
    });

    res.status(200).json({
      status: 'success',
      message: 'Selfie uploaded and linked to KYC successfully.',
      data: {
        url: publicUrl,
      },
    });
  },
);
