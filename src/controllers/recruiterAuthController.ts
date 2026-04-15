import crypto from 'crypto';
import { Request, Response, NextFunction } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { prisma } from '../config/prisma.js';
import { env } from '../config/env.js';
import { AppError } from '../utils/AppError.js';
import { catchAsync } from '../utils/catchAsync.js';
import {
  sendOTPEmail,
  sendPhoneOTPEmail,
  sendPasswordResetEmail,
} from '../services/emailService.js';
import { sendSMS } from '../services/smsService.js';
import {
  compareCompanyDetails,
  fetchGeminiCompanyDetails,
  getCompanyMetadata,
} from '../services/companyService.js';
import { uploadToSupabase } from '../services/storageService.js';
import { changePasswordSchema } from '../validations/passwordValidation.js';
import { CustomRequest } from '../types/index.js';
import { logActivity } from '../services/activityLogger.js';
import { ActorType, ActionStatus } from '../generated/client/index.js';

import {
  agentRegisterSchema,
  setPersonalInfoSchema,
  setCompanyDetailsSchema,
  setComplianceSchema,
} from '../validations/recruiterValidation.js';

/**
 * Step 1: Registration (Agent Sign Up)
 */
export const register = catchAsync(
  async (req: Request, res: Response, next: NextFunction) => {
    const validatedData = agentRegisterSchema.parse(req.body);
    const { email, password, role } = validatedData;

    if (!email || !password || !role) {
      return next(new AppError('Please provide email, password and role', 400));
    }

    const existingRecruiter = await prisma.recruiter.findUnique({
      where: { email },
    });
    if (existingRecruiter) {
      return next(new AppError('Email already registered as a recruiter', 400));
    }

    const existingProfessional = await prisma.professional.findUnique({
      where: { email },
    });
    if (existingProfessional) {
      return next(
        new AppError('Email already registered as a professional', 400),
      );
    }

    const hashedPassword = await bcrypt.hash(password, 12);

    const recruiter = await prisma.recruiter.create({
      data: {
        email,
        password: hashedPassword,
        role,
        isVerified: false,
      },
    });

    const otpCode = Math.floor(100000 + Math.random() * 900000).toString();
    const otpExpiresAt = new Date(Date.now() + 10 * 60 * 1000);

    await prisma.recruiter.update({
      where: { id: recruiter.id },
      data: {
        otpCode,
        otpExpiresAt,
      },
    });

    await sendOTPEmail(email, otpCode);

    await logActivity({
      action: 'REGISTER',
      actorId: recruiter.id,
      actorType: ActorType.RECRUITER,
      status: ActionStatus.SUCCESS,
      ipAddress: req.ip,
      userAgent: req.get('user-agent'),
    });

    res.status(201).json({
      status: 'success',
      message: 'Registration successful. OTP sent to your email.',
      data: {
        recruiterId: recruiter.id,
        registrationStep: 1,
      },
    });
  },
);

/**
 * Step 2: Verification (Email)
 */
export const verifyOTP = catchAsync(
  async (req: Request, res: Response, next: NextFunction) => {
    const { recruiterId, code } = req.body;

    const recruiter = await prisma.recruiter.findFirst({
      where: {
        id: recruiterId,
        otpCode: code,
        otpExpiresAt: { gt: new Date() },
      },
    });

    if (!recruiter) {
      return next(new AppError('Invalid or expired OTP', 400));
    }

    await prisma.recruiter.update({
      where: { id: recruiterId },
      data: {
        isVerified: true,
        otpCode: null,
        otpExpiresAt: null,
        registrationStep: 2,
      },
    });

    res.status(200).json({
      status: 'success',
      message: 'Email verified successfully. Please tell us about yourself.',
      data: { registrationStep: 2 },
    });
  },
);

/**
 * Step 3: Tell Us About Yourself
 */
export const setPersonalInfo = catchAsync(
  async (req: Request, res: Response) => {
    const validatedData = setPersonalInfoSchema.parse(req.body);
    const {
      recruiterId,
      firstName,
      middleName,
      lastName,
      phoneCode,
      phoneNumber,
      personalRole,
      otherRole,
    } = validatedData;

    // Generate Phone OTP
    const phoneOtpCode = Math.floor(100000 + Math.random() * 900000).toString();
    const phoneOtpExpiresAt = new Date(Date.now() + 10 * 60 * 1000);

    await prisma.recruiter.update({
      where: { id: recruiterId },
      data: {
        firstName,
        middleName,
        lastName,
        phoneCode,
        phoneNumber,
        personalRole,
        otherRole,
        phoneOtpCode,
        phoneOtpExpiresAt,
        registrationStep: 3,
      },
    });

    // Send OTP via SMS
    const message = `Your MaritimeLink verification code is: ${phoneOtpCode}`;
    try {
      await sendSMS(phoneCode + phoneNumber, message);
    } catch (error) {
      console.error('Failed to send phone OTP SMS:', error);
    }

    // Fetch recruiter email to send OTP via email as requested
    const recruiter = await prisma.recruiter.findUnique({
      where: { id: recruiterId },
      select: { email: true },
    });

    if (recruiter?.email) {
      try {
        await sendPhoneOTPEmail(recruiter.email, phoneOtpCode);
      } catch (error) {
        console.error('Failed to send phone OTP email:', error);
        // We don't throw here to avoid breaking the registration flow
      }
    }

    res.status(200).json({
      status: 'success',
      message: 'Personal info saved. OTP sent to your phone.',
      data: { registrationStep: 3 },
    });
  },
);

/**
 * Step 4: Verify Phone
 */
export const verifyPhone = catchAsync(
  async (req: Request, res: Response, next: NextFunction) => {
    const { recruiterId, code } = req.body;

    const recruiter = await prisma.recruiter.findFirst({
      where: {
        id: recruiterId,
        phoneOtpCode: code,
        phoneOtpExpiresAt: { gt: new Date() },
      },
    });

    if (!recruiter) {
      return next(new AppError('Invalid or expired phone OTP', 400));
    }

    await prisma.recruiter.update({
      where: { id: recruiterId },
      data: {
        phoneVerified: true,
        phoneOtpCode: null,
        phoneOtpExpiresAt: null,
        registrationStep: 4,
      },
    });

    res.status(200).json({
      status: 'success',
      message: 'Phone verified successfully. Please provide company details.',
      data: { registrationStep: 4 },
    });
  },
);

/**
 * Step 5: Company Details
 */
export const setCompanyDetails = catchAsync(
  async (req: Request, res: Response) => {
    const validatedData = setCompanyDetailsSchema.parse(req.body);
    const { recruiterId, ...companyData } = validatedData;
    const externalCompany = await fetchGeminiCompanyDetails(companyData);
    const companyMatch = compareCompanyDetails(companyData, externalCompany);

    await prisma.recruiter.update({
      where: { id: recruiterId },
      data: {
        ...companyData,
        registrationStep: 5,
      },
    });

    const existingKyc = await prisma.recruiterKyc.findUnique({
      where: { recruiterId },
      select: { id: true },
    });

    if (existingKyc) {
      await prisma.recruiterKyc.update({
        where: { recruiterId },
        data: {
          ...(companyMatch.mismatchDetected
            ? {
                riskLevel: companyMatch.riskLevel,
                mismatchDetected: true,
                mismatchDetails: companyMatch.mismatchDetails,
              }
            : {}),
        },
      });
    }

    res.status(200).json({
      status: 'success',
      message: 'Company details saved. Please complete compliance declaration.',
      data: {
        registrationStep: 5,
        companyVerification: {
          source: externalCompany ? 'GEMINI_GOOGLE_SEARCH' : null,
          mismatchDetected: companyMatch.mismatchDetected,
          riskLevel: companyMatch.riskLevel,
        },
      },
    });
  },
);

/**
 * Lookup full company details using Gemini + Google Search grounding
 */
export const lookupCompanyDetails = catchAsync(
  async (req: Request, res: Response, next: NextFunction) => {
    const {
      url,
      organizationName,
      address,
      companyCity,
      companyState,
      companyZip,
      companyCountry,
      companyLinkedIn,
    } = req.query;

    if (
      (!url || typeof url !== 'string') &&
      (!organizationName || typeof organizationName !== 'string')
    ) {
      return next(
        new AppError('Please provide a company URL or organizationName', 400),
      );
    }

    const details = await fetchGeminiCompanyDetails({
      website: typeof url === 'string' ? url : undefined,
      organizationName:
        typeof organizationName === 'string' ? organizationName : undefined,
      address: typeof address === 'string' ? address : undefined,
      companyCity: typeof companyCity === 'string' ? companyCity : undefined,
      companyState: typeof companyState === 'string' ? companyState : undefined,
      companyZip: typeof companyZip === 'string' ? companyZip : undefined,
      companyCountry:
        typeof companyCountry === 'string' ? companyCountry : undefined,
      companyLinkedIn:
        typeof companyLinkedIn === 'string' ? companyLinkedIn : undefined,
    });

    if (!details) {
      return next(new AppError('Could not fetch company details', 404));
    }

    res.status(200).json({
      status: 'success',
      data: { company: details },
    });
  },
);

/**
 * Get Company Preview
 */
export const getCompanyPreview = catchAsync(
  async (req: Request, res: Response, next: NextFunction) => {
    const { url } = req.query;

    if (!url || typeof url !== 'string') {
      return next(new AppError('Please provide a valid company URL', 400));
    }

    // Clean URL to domain
    const domain = url
      .replace(/^(?:https?:\/\/)?(?:www\.)?/i, '')
      .split('/')[0];

    const metadata = await getCompanyMetadata(domain);

    if (!metadata) {
      return next(new AppError('Could not fetch company details', 404));
    }

    res.status(200).json({
      status: 'success',
      data: metadata,
    });
  },
);

/**
 * Step 6: Compliance & Trust
 */
export const setCompliance = catchAsync(async (req: Request, res: Response) => {
  const validatedData = setComplianceSchema.parse(req.body);
  const { recruiterId, isAuthorized, agreedToTerms, howDidYouHear } =
    validatedData;

  const recruiter = await prisma.recruiter.update({
    where: { id: recruiterId },
    data: {
      isAuthorized,
      agreedToTerms,
      howDidYouHear,
      registrationStep: 6,
      status: 'PENDING',
    },
  });

  // Issue token upon completion
  const token = jwt.sign(
    { id: recruiter.id, role: recruiter.role },
    env.JWT_SECRET,
    { expiresIn: '7d' },
  );

  res.status(200).json({
    status: 'success',
    message: 'Registration complete. Your account is under review.',
    token,
    data: { registrationStep: 6 },
  });
});

/**
 * Step 3: Upload ID (Multipart) - Legacy support for existing routes
 */
export const uploadID = catchAsync(
  async (req: Request, res: Response, next: NextFunction) => {
    const file = req.file;

    if (!file) {
      return next(new AppError('Please upload an ID or Passport image', 400));
    }

    const sanitizedOriginalName = file.originalname.replace(
      /[^a-zA-Z0-9.]/g,
      '_',
    );
    const fileName = `recruiter-temp-ids/${Date.now()}-${sanitizedOriginalName}`;

    // Use the recruiter specific bucket
    const publicUrl = await uploadToSupabase(
      file,
      fileName,
      env.SUPABASE_RECRUITER_BUCKET_NAME,
    );

    res.status(200).json({
      status: 'success',
      message: 'ID uploaded successfully.',
      data: {
        url: publicUrl,
      },
    });
  },
);

/**
 * Step 5b: Upload Profile Photo
 */
export const uploadProfilePhoto = catchAsync(
  async (req: Request, res: Response, next: NextFunction) => {
    const { recruiterId } = req.body;
    const file = req.file;

    if (!file) {
      return next(new AppError('Please upload a profile photo', 400));
    }

    if (!recruiterId) {
      return next(new AppError('recruiterId is required', 400));
    }

    const sanitizedOriginalName = file.originalname.replace(
      /[^a-zA-Z0-9.]/g,
      '_',
    );
    const fileName = `recruiter-profile-photos/${recruiterId}-${Date.now()}-${sanitizedOriginalName}`;

    // Use recruiter bucket
    const publicUrl = await uploadToSupabase(
      file,
      fileName,
      env.SUPABASE_RECRUITER_BUCKET_NAME,
    );

    await prisma.recruiter.update({
      where: { id: recruiterId },
      data: {
        profilePhotoUrl: publicUrl,
      },
    });

    res.status(200).json({
      status: 'success',
      message: 'Profile photo uploaded successfully.',
      data: {
        url: publicUrl,
      },
    });
  },
);

/**
 * Step 4: Complete Profile - Legacy support for existing routes
 */
export const completeProfile = catchAsync(
  async (req: Request, res: Response, next: NextFunction) => {
    const {
      recruiterId,
      organizationName,
      address,
      website,
      orgEmail,
      idPassportUrl,
    } = req.body;

    if (!recruiterId) {
      return next(
        new AppError('recruiterId is required to complete the profile', 400),
      );
    }

    const recruiter = await prisma.recruiter.findUnique({
      where: { id: recruiterId },
    });

    if (!recruiter) {
      return next(new AppError('Recruiter not found', 404));
    }

    if (!recruiter.isVerified) {
      return next(new AppError('Please verify your email first', 401));
    }

    await prisma.recruiter.update({
      where: { id: recruiterId },
      data: {
        organizationName,
        address,
        website,
        orgEmail,
        idPassportUrl,
        status: 'PENDING',
      },
    });

    res.status(200).json({
      status: 'success',
      message:
        'Profile submitted successfully. It is now pending admin approval.',
    });
  },
);

/**
 * Login
 */
export const login = catchAsync(
  async (req: Request, res: Response, next: NextFunction) => {
    const { email, password } = req.body;

    const recruiter = await prisma.recruiter.findUnique({ where: { email } });

    if (!recruiter || !(await bcrypt.compare(password, recruiter.password))) {
      return next(new AppError('Incorrect email or password', 401));
    }

    if (!recruiter.isVerified) {
      return next(
        new AppError('Email not verified. Please verify your email.', 401),
      );
    }

    if (['REJECTED', 'BLOCKED'].includes(recruiter.status)) {
      return next(
        new AppError(
          `Your account is currently ${recruiter.status.toLowerCase()}. Please contact support.`,
          403,
        ),
      );
    }

    const token = jwt.sign(
      { id: recruiter.id, role: recruiter.role },
      env.JWT_SECRET,
      {
        expiresIn: '7d',
      },
    );

    await logActivity({
      action: 'LOGIN',
      actorId: recruiter.id,
      actorType: ActorType.RECRUITER,
      status: ActionStatus.SUCCESS,
      ipAddress: req.ip,
      userAgent: req.get('user-agent'),
    });

    res.status(200).json({
      status: 'success',
      token,
      data: {
        recruiter: {
          id: recruiter.id,
          email: recruiter.email,
          role: recruiter.role,
          organizationName: recruiter.organizationName,
          profilePhotoUrl: recruiter.profilePhotoUrl,
          status: recruiter.status,
        },
      },
    });
  },
);

/**
 * Resend OTP
 */
export const resendOTP = catchAsync(
  async (req: Request, res: Response, next: NextFunction) => {
    const { email } = req.body;

    if (!email) {
      return next(new AppError('Please provide an email address', 400));
    }

    const recruiter = await prisma.recruiter.findUnique({
      where: { email },
    });

    if (!recruiter) {
      return next(new AppError('Recruiter not found', 404));
    }

    if (recruiter.isVerified) {
      return next(new AppError('Account is already verified', 400));
    }

    const otpCode = Math.floor(100000 + Math.random() * 900000).toString();
    const otpExpiresAt = new Date(Date.now() + 10 * 60 * 1000);

    await prisma.recruiter.update({
      where: { id: recruiter.id },
      data: {
        otpCode,
        otpExpiresAt,
      },
    });

    await sendOTPEmail(email, otpCode);

    res.status(200).json({
      status: 'success',
      message: 'OTP resent to your email.',
    });
  },
);

/**
 * Forgot Password
 */
export const forgotPassword = catchAsync(
  async (req: Request, res: Response, next: NextFunction) => {
    const { email } = req.body;

    if (!email) {
      return next(new AppError('Please provide an email address', 400));
    }

    const recruiter = await prisma.recruiter.findUnique({
      where: { email },
    });

    if (!recruiter) {
      return next(
        new AppError('No recruiter found with that email address', 404),
      );
    }

    // Generate random reset token
    const resetToken = crypto.randomBytes(32).toString('hex');

    // Hash token and set expiry
    const hashedToken = crypto
      .createHash('sha256')
      .update(resetToken)
      .digest('hex');
    const resetExpires = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    await prisma.recruiter.update({
      where: { id: recruiter.id },
      data: {
        passwordResetToken: hashedToken,
        passwordResetExpires: resetExpires,
      },
    });

    // Send email
    const resetURL = `${env.FRONTEND_URL}/reset-password/${resetToken}`;

    try {
      await sendPasswordResetEmail(email, resetURL);
      res.status(200).json({
        status: 'success',
        message: 'Password reset link sent to your email.',
      });
    } catch {
      // If email fails, clear the token fields
      await prisma.recruiter.update({
        where: { id: recruiter.id },
        data: {
          passwordResetToken: null,
          passwordResetExpires: null,
        },
      });
      return next(
        new AppError(
          'There was an error sending the email. Try again later.',
          500,
        ),
      );
    }
  },
);

/**
 * Reset Password
 */
export const resetPassword = catchAsync(
  async (req: Request, res: Response, next: NextFunction) => {
    const { token } = req.params;
    const { password } = req.body;

    if (!password) {
      return next(new AppError('Please provide a new password', 400));
    }

    // Hash the token from params to compare with DB
    const hashedToken = crypto.createHash('sha256').update(token).digest('hex');

    const recruiter = await prisma.recruiter.findFirst({
      where: {
        passwordResetToken: hashedToken,
        passwordResetExpires: { gt: new Date() },
      },
    });

    if (!recruiter) {
      return next(new AppError('Token is invalid or has expired', 400));
    }

    // Update password, clear token fields
    const hashedPassword = await bcrypt.hash(password, 12);

    await prisma.recruiter.update({
      where: { id: recruiter.id },
      data: {
        password: hashedPassword,
        passwordResetToken: null,
        passwordResetExpires: null,
      },
    });

    // Issuing token (Optional based on UX choice, let's keep it consistent with Professional)
    const jwtToken = jwt.sign(
      { id: recruiter.id, role: recruiter.role },
      env.JWT_SECRET,
      {
        expiresIn: '7d',
      },
    );

    res.status(200).json({
      status: 'success',
      message: 'Password reset successful.',
      token: jwtToken,
    });
  },
);

/**
 * Update Password (Authenticated)
 */
export const updatePassword = catchAsync(
  async (req: CustomRequest, res: Response, next: NextFunction) => {
    const validatedData = changePasswordSchema.parse(req.body);
    const { oldPassword, newPassword } = validatedData;

    const recruiter = await prisma.recruiter.findUnique({
      where: { id: req.user?.id },
    });

    if (
      !recruiter ||
      !(await bcrypt.compare(oldPassword, recruiter.password))
    ) {
      return next(new AppError('Incorrect old password', 401));
    }

    const hashedPassword = await bcrypt.hash(newPassword, 12);

    await prisma.recruiter.update({
      where: { id: recruiter.id },
      data: {
        password: hashedPassword,
      },
    });

    res.status(200).json({
      status: 'success',
      message: 'Password updated successfully.',
    });
  },
);
