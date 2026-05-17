import { NextFunction, Response } from 'express';
import { prisma } from '../config/prisma.js';
import { catchAsync } from '../utils/catchAsync.js';
import { AppError } from '../utils/AppError.js';
import { CustomRequest } from '../types/index.js';
import { uploadToSupabase } from '../services/storageService.js';
import { env } from '../config/env.js';
import {
  getRecruiterNotificationPreferences,
  mergeRecruiterAccountSettings,
  normalizeNotificationPreferences,
} from '../services/recruiterAccountSettingsService.js';

const mapBilling = (tier: string) => {
  const normalizedTier = String(tier || 'FREE').toUpperCase();
  const planName =
    normalizedTier === 'PRO'
      ? 'Professional'
      : normalizedTier === 'ENTERPRISE'
        ? 'Enterprise'
        : 'Free';

  const amount =
    normalizedTier === 'PRO' ? 299 : normalizedTier === 'ENTERPRISE' ? 599 : 0;

  const features = [
    'Unlimited Job Postings',
    'Advanced Candidate Search',
    'Priority Support',
  ];

  if (normalizedTier === 'ENTERPRISE') {
    features.push('Dedicated Account Manager');
  }

  return {
    currentPlan: planName,
    amount,
    currency: 'USD',
    billingCycle: 'monthly',
    features,
    canUpgrade: normalizedTier !== 'ENTERPRISE',
  };
};

export const getRecruiterSettings = catchAsync(
  async (req: CustomRequest, res: Response, next: NextFunction) => {
    const recruiterId = req.user?.id;
    if (!recruiterId) {
      return next(new AppError('Recruiter account not found', 401));
    }

    const recruiter = await prisma.recruiter.findUnique({
      where: { id: recruiterId },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        phoneCode: true,
        phoneNumber: true,
        personalRole: true,
        profilePhotoUrl: true,
        organizationName: true,
        website: true,
        companyLinkedIn: true,
        address: true,
        companyCity: true,
        companyState: true,
        companyZip: true,
        companyCountry: true,
        tier: true,
        accountSettings: true,
        organizationVerificationData: true,
      },
    });

    if (!recruiter) {
      return next(new AppError('Recruiter account not found', 404));
    }

    res.status(200).json({
      status: 'success',
      data: {
        profile: {
          firstName: recruiter.firstName || '',
          lastName: recruiter.lastName || '',
          email: recruiter.email,
          countryCode: recruiter.phoneCode || '+44',
          phoneNumber: recruiter.phoneNumber || '',
          role: recruiter.personalRole || '',
          profilePhotoUrl: recruiter.profilePhotoUrl || null,
        },
        company: {
          name: recruiter.organizationName || '',
          website: recruiter.website || '',
          linkedin: recruiter.companyLinkedIn || '',
          address: recruiter.address || '',
          city: recruiter.companyCity || '',
          state: recruiter.companyState || '',
          postcode: recruiter.companyZip || '',
          country: recruiter.companyCountry || '',
        },
        notifications: getRecruiterNotificationPreferences(
          recruiter.accountSettings,
          recruiter.organizationVerificationData,
        ),
        billing: mapBilling(recruiter.tier),
      },
    });
  },
);

export const updateRecruiterProfileSettings = catchAsync(
  async (req: CustomRequest, res: Response, next: NextFunction) => {
    const recruiterId = req.user?.id;
    if (!recruiterId) {
      return next(new AppError('Recruiter account not found', 401));
    }

    const { firstName, lastName, email, countryCode, phoneNumber, role } =
      req.body as Record<string, string>;

    if (!firstName || !lastName || !email) {
      return next(
        new AppError('First name, last name, and email are required', 400),
      );
    }

    const currentRecruiter = await prisma.recruiter.findUnique({
      where: { id: recruiterId },
      select: { email: true },
    });

    if (!currentRecruiter) {
      return next(new AppError('Recruiter account not found', 404));
    }

    if (email !== currentRecruiter.email) {
      const existingRecruiter = await prisma.recruiter.findUnique({
        where: { email },
        select: { id: true },
      });
      if (existingRecruiter && existingRecruiter.id !== recruiterId) {
        return next(new AppError('Email is already in use', 400));
      }
    }

    const updated = await prisma.recruiter.update({
      where: { id: recruiterId },
      data: {
        firstName,
        lastName,
        email,
        phoneCode: countryCode || null,
        phoneNumber: phoneNumber || null,
        personalRole: role || null,
      },
      select: {
        firstName: true,
        lastName: true,
        email: true,
        phoneCode: true,
        phoneNumber: true,
        personalRole: true,
        profilePhotoUrl: true,
      },
    });

    res.status(200).json({
      status: 'success',
      message: 'Profile updated successfully.',
      data: {
        profile: {
          firstName: updated.firstName || '',
          lastName: updated.lastName || '',
          email: updated.email,
          countryCode: updated.phoneCode || '+44',
          phoneNumber: updated.phoneNumber || '',
          role: updated.personalRole || '',
          profilePhotoUrl: updated.profilePhotoUrl || null,
        },
      },
    });
  },
);

export const updateRecruiterCompanySettings = catchAsync(
  async (req: CustomRequest, res: Response, next: NextFunction) => {
    const recruiterId = req.user?.id;
    if (!recruiterId) {
      return next(new AppError('Recruiter account not found', 401));
    }

    const { name, website, linkedin, address, city, state, postcode, country } =
      req.body as Record<string, string>;

    if (!name) {
      return next(new AppError('Company name is required', 400));
    }

    const updated = await prisma.recruiter.update({
      where: { id: recruiterId },
      data: {
        organizationName: name,
        website: website || null,
        companyLinkedIn: linkedin || null,
        address: address || null,
        companyCity: city || null,
        companyState: state || null,
        companyZip: postcode || null,
        companyCountry: country || null,
      },
      select: {
        organizationName: true,
        website: true,
        companyLinkedIn: true,
        address: true,
        companyCity: true,
        companyState: true,
        companyZip: true,
        companyCountry: true,
      },
    });

    res.status(200).json({
      status: 'success',
      message: 'Company profile updated successfully.',
      data: {
        company: {
          name: updated.organizationName || '',
          website: updated.website || '',
          linkedin: updated.companyLinkedIn || '',
          address: updated.address || '',
          city: updated.companyCity || '',
          state: updated.companyState || '',
          postcode: updated.companyZip || '',
          country: updated.companyCountry || '',
        },
      },
    });
  },
);

export const updateRecruiterNotificationSettings = catchAsync(
  async (req: CustomRequest, res: Response, next: NextFunction) => {
    const recruiterId = req.user?.id;
    if (!recruiterId) {
      return next(new AppError('Recruiter account not found', 401));
    }

    const normalized = normalizeNotificationPreferences(
      (req.body || {}) as Record<string, unknown>,
    );

    const recruiter = await prisma.recruiter.findUnique({
      where: { id: recruiterId },
      select: { accountSettings: true },
    });

    if (!recruiter) {
      return next(new AppError('Recruiter account not found', 404));
    }

    await prisma.recruiter.update({
      where: { id: recruiterId },
      data: {
        accountSettings: mergeRecruiterAccountSettings(
          recruiter.accountSettings,
          normalized,
        ),
      },
    });

    res.status(200).json({
      status: 'success',
      message: 'Notification preferences updated successfully.',
      data: {
        notifications: normalized,
      },
    });
  },
);

export const getRecruiterBillingSettings = catchAsync(
  async (req: CustomRequest, res: Response, next: NextFunction) => {
    const recruiterId = req.user?.id;
    if (!recruiterId) {
      return next(new AppError('Recruiter account not found', 401));
    }

    const recruiter = await prisma.recruiter.findUnique({
      where: { id: recruiterId },
      select: {
        tier: true,
        role: true,
        stripeOnboardingComplete: true,
      },
    });

    if (!recruiter) {
      return next(new AppError('Recruiter account not found', 404));
    }

    res.status(200).json({
      status: 'success',
      data: {
        billing: {
          ...mapBilling(recruiter.tier),
          role: recruiter.role,
          stripeOnboardingComplete: recruiter.stripeOnboardingComplete,
        },
      },
    });
  },
);

export const updateRecruiterProfilePhoto = catchAsync(
  async (req: CustomRequest, res: Response, next: NextFunction) => {
    const recruiterId = req.user?.id;
    const file = req.file;

    if (!recruiterId) {
      return next(new AppError('Recruiter account not found', 401));
    }

    if (!file) {
      return next(new AppError('Please upload a profile photo', 400));
    }

    const sanitizedOriginalName = file.originalname.replace(
      /[^a-zA-Z0-9.]/g,
      '_',
    );
    const fileName = `recruiter-profile-photos/${recruiterId}-${Date.now()}-${sanitizedOriginalName}`;

    const publicUrl = await uploadToSupabase(
      file,
      fileName,
      env.SUPABASE_RECRUITER_BUCKET_NAME,
    );

    await prisma.recruiter.update({
      where: { id: recruiterId },
      data: { profilePhotoUrl: publicUrl },
    });

    res.status(200).json({
      status: 'success',
      message: 'Profile photo uploaded successfully.',
      data: { profilePhotoUrl: publicUrl },
    });
  },
);

export const removeRecruiterProfilePhoto = catchAsync(
  async (req: CustomRequest, res: Response, next: NextFunction) => {
    const recruiterId = req.user?.id;
    if (!recruiterId) {
      return next(new AppError('Recruiter account not found', 401));
    }

    await prisma.recruiter.update({
      where: { id: recruiterId },
      data: { profilePhotoUrl: null },
    });

    res.status(200).json({
      status: 'success',
      message: 'Profile photo removed successfully.',
      data: { profilePhotoUrl: null },
    });
  },
);
