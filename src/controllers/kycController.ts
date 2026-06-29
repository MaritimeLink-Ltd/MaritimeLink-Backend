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
import {
  notifyKycSubmitted,
  safeNotify,
} from '../services/eventNotificationService.js';
import { isKycPackComplete } from '../utils/kycSubmissionComplete.js';
import {
  compareCompanyDetails,
  fetchGeminiCompanyDetails,
} from '../services/companyService.js';
import { KycRiskLevel } from '../generated/client/index.js';

/**
 * Helper to upload KYC doc and return signed URL (Recruiter)
 */
const processKYCUpload = async (
  file: Express.Multer.File,
  side: 'front' | 'back' | 'selfie',
  recruiterId: string | undefined,
) => {
  const sanitizedOriginalName = file.originalname.replace(
    /[^a-zA-Z0-9.]/g,
    '_',
  );
  const path = `kyc-docs/${recruiterId || 'unknown'}/${Date.now()}-${side}-${sanitizedOriginalName}`;

  const publicUrl = await uploadToSupabase(
    file,
    path,
    env.SUPABASE_RECRUITER_KYC_DOCS_BUCKET,
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

    // Gemini OCR Analysis
    let ocrData = null;
    try {
      if (file.buffer) {
        ocrData = await analyzeDocument(file.buffer, file.mimetype);
      }
    } catch (error) {
      console.error('Recruiter KYC OCR analysis failed:', error);
    }

    // Validate if the document is actually a valid KYC document
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
      data: {
        url: publicUrl,
        ocrData,
        isTypeValidated,
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

    // Gemini OCR Analysis
    let ocrData = null;
    try {
      if (file.buffer) {
        ocrData = await analyzeDocument(file.buffer, file.mimetype);
      }
    } catch (error) {
      console.error('Recruiter KYC OCR Back analysis failed:', error);
    }

    // Validate if the document is actually a valid KYC document
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
      data: {
        url: publicUrl,
        ocrData,
        isTypeValidated,
      },
    });
  },
);

/**
 * Upload Identity Document (Legacy/Single)
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
  async (req: CustomRequest, res: Response, next: NextFunction) => {
    const file = req.file;
    const { recruiterId } = req.body;

    if (!file) {
      return next(new AppError('Please upload a selfie image', 400));
    }

    if (!recruiterId) {
      return next(new AppError('recruiterId is required', 400));
    }

    if (req.user?.id && req.user.id !== recruiterId) {
      return next(
        new AppError('You can only upload KYC for your account', 403),
      );
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

    const updatedKyc = await prisma.recruiterKyc.update({
      where: { recruiterId },
      data: { selfieUrl: publicUrl },
    });

    if (isKycPackComplete(updatedKyc)) {
      safeNotify('kyc-submitted', () =>
        notifyKycSubmitted({ audience: 'RECRUITER', userId: recruiterId }),
      );
    }

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

    if (req.user?.id && req.user.id !== recruiterId) {
      return next(
        new AppError('You can only submit KYC for your account', 403),
      );
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
      organizationVerified,
      organizationRiskLevel,
      organizationVerificationSource,
    } = validationResult.data;

    // Check if KYC already exists
    const existingKyc = await prisma.recruiterKyc.findUnique({
      where: { recruiterId },
    });

    if (existingKyc && existingKyc.status === 'APPROVED') {
      return next(new AppError('KYC already approved', 400));
    }

    const recruiter = await prisma.recruiter.findUnique({
      where: { id: recruiterId },
      select: {
        organizationName: true,
        address: true,
        companyCity: true,
        companyState: true,
        companyZip: true,
        companyCountry: true,
        website: true,
        companyLinkedIn: true,
      },
    });

    const externalCompany = recruiter
      ? await fetchGeminiCompanyDetails(recruiter)
      : null;
    const companyMatch = compareCompanyDetails(
      recruiter ?? {},
      externalCompany,
    );
    const selectedOrganizationRiskLevel =
      organizationVerified === true
        ? KycRiskLevel.LOW
        : organizationVerified === false
          ? KycRiskLevel.HIGH
          : organizationRiskLevel === 'HIGH'
            ? KycRiskLevel.HIGH
            : companyMatch.riskLevel;
    const selectedOrganizationMismatch =
      organizationVerified === true
        ? false
        : organizationVerified === false
          ? true
          : companyMatch.mismatchDetected;
    const selectedOrganizationMismatchDetails =
      organizationVerified === false
        ? JSON.stringify({
            source: organizationVerificationSource || 'USER_DECLINED_LOOKUP',
            reason:
              'User declined the fetched public organization and continued with manually entered company details.',
          })
        : organizationVerified === true
          ? null
          : companyMatch.mismatchDetails;

    const kycData = {
      firstName,
      lastName,
      dateOfBirth: new Date(dateOfBirth),
      documentType,
      documentNumber,
      expiryDate: new Date(expiryDate),
      issueCountry,
      documentUrl: (documentUrl as string) || undefined,
      documentFrontUrl: documentFrontUrl || (documentUrl as string),
      documentBackUrl,
      status: 'PENDING' as const,
      riskLevel: selectedOrganizationRiskLevel,
      mismatchDetected: selectedOrganizationMismatch,
      mismatchDetails: selectedOrganizationMismatchDetails,
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
