import { Request, Response, NextFunction } from 'express';
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
 * Upload Identity Document
 */
export const uploadKYCDocument = catchAsync(
  async (req: Request, res: Response, next: NextFunction) => {
    const file = req.file;

    if (!file) {
      return next(
        new AppError('Please upload an identity document image', 400),
      );
    }

    const sanitizedOriginalName = file.originalname.replace(
      /[^a-zA-Z0-9.]/g,
      '_',
    );
    const fileName = `kyc-docs/${Date.now()}-${sanitizedOriginalName}`;

    const publicUrl = await uploadToSupabase(
      file,
      fileName,
      env.SUPABASE_RECRUITER_KYC_DOCS_BUCKET,
    );

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
      console.error('Recruiter KYC document type validation failed:', error);
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
 * Upload Selfie
 */
export const uploadKYCSelfie = catchAsync(
  async (req: Request, res: Response, next: NextFunction) => {
    const file = req.file;
    const { recruiterId } = req.body;

    if (!file) {
      return next(new AppError('Please upload a selfie image', 400));
    }

    if (!recruiterId) {
      return next(new AppError('recruiterId is required', 400));
    }

    const sanitizedOriginalName = file.originalname.replace(
      /[^a-zA-Z0-9.]/g,
      '_',
    );
    const fileName = `kyc-selfies/${Date.now()}-${sanitizedOriginalName}`;

    const publicUrl = await uploadToSupabase(
      file,
      fileName,
      env.SUPABASE_RECRUITER_KYC_SELFIES_BUCKET,
    );

    // Update the KYC record with the selfie URL
    await prisma.recruiterKyc.update({
      where: { recruiterId },
      data: { selfieUrl: publicUrl },
    });

    res.status(200).json({
      status: 'success',
      message: 'Selfie uploaded and linked to KYC successfully.',
      data: { url: publicUrl },
    });
  },
);

/**
 * Submit KYC Details
 */
export const submitKYC = catchAsync(
  async (req: CustomRequest, res: Response, next: NextFunction) => {
    const recruiterId = req.body.recruiterId as string;

    if (!recruiterId) {
      return next(new AppError('recruiterId is required', 400));
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
      documentUrl,
    } = validationResult.data;

    // Check if KYC already exists
    const existingKyc = await prisma.recruiterKyc.findUnique({
      where: { recruiterId },
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
      documentUrl: documentUrl as string,
      status: 'PENDING' as const,
    };

    if (existingKyc) {
      await prisma.recruiterKyc.update({
        where: { recruiterId },
        data: kycData,
      });
    } else {
      await prisma.recruiterKyc.create({
        data: {
          ...kycData,
          recruiter: {
            connect: { id: recruiterId },
          },
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
