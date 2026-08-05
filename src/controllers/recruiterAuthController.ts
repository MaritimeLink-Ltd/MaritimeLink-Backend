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
import {
  sendSMS,
  isPhoneVerifyConfigured,
  startPhoneVerification,
  checkPhoneVerification,
  toE164,
} from '../services/smsService.js';
import {
  compareCompanyDetails,
  fetchGeminiCompanyDetails,
  getCompanyMetadata,
} from '../services/companyService.js';
import { uploadToSupabase } from '../services/storageService.js';
import { changePasswordSchema } from '../validations/passwordValidation.js';
import { CustomRequest } from '../types/index.js';
import { logActivity } from '../services/activityLogger.js';
import {
  ActorType,
  ActionStatus,
  KycRiskLevel,
  Prisma,
} from '../generated/client/index.js';
import { getClientIp } from '../utils/requestMetadata.js';
import {
  describeRestriction,
  liftExpiredRecruiterSuspension,
} from '../services/accountModerationService.js';
import {
  recruiterKycLoginSelect,
  mapKycForLogin,
} from '../utils/kycLoginPayload.js';
import {
  isRecruiterSignupIncomplete,
  SIGNUP_INCOMPLETE_CODE,
  SIGNUP_INCOMPLETE_MESSAGE,
} from '../utils/signupProgress.js';

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

    console.log(
      `[LOCAL TEST OTP] Recruiter email OTP for ${email}: ${otpCode}`,
    );

    await sendOTPEmail(email, otpCode);

    await logActivity({
      action: 'REGISTER',
      actorId: recruiter.id,
      actorType: ActorType.RECRUITER,
      status: ActionStatus.SUCCESS,
      ipAddress: getClientIp(req),
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

    // With Twilio Verify the code lives on Twilio's side, so nothing is stored
    // locally. The fallback below keeps local development (and the test suite)
    // working without Twilio credentials.
    const useVerify = isPhoneVerifyConfigured();
    const phoneOtpCode = useVerify
      ? null
      : Math.floor(100000 + Math.random() * 900000).toString();
    const phoneOtpExpiresAt = phoneOtpCode
      ? new Date(Date.now() + 10 * 60 * 1000)
      : null;

    if (phoneOtpCode) {
      console.log(
        `[LOCAL TEST OTP] Recruiter phone OTP for ${phoneCode}${phoneNumber}: ${phoneOtpCode}`,
      );
    }

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

    if (useVerify) {
      // A delivery failure here is worth surfacing: there is no stored code to
      // fall back on, so the user cannot continue without a resend.
      await startPhoneVerification(toE164(phoneCode, phoneNumber));
    } else {
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

      if (recruiter?.email && phoneOtpCode) {
        try {
          await sendPhoneOTPEmail(recruiter.email, phoneOtpCode);
        } catch (error) {
          console.error('Failed to send phone OTP email:', error);
          // We don't throw here to avoid breaking the registration flow
        }
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

    if (isPhoneVerifyConfigured()) {
      const recruiter = await prisma.recruiter.findUnique({
        where: { id: recruiterId },
        select: { phoneCode: true, phoneNumber: true },
      });

      if (!recruiter?.phoneCode || !recruiter.phoneNumber) {
        return next(
          new AppError('No phone number on file. Please complete step 3.', 400),
        );
      }

      const result = await checkPhoneVerification(
        toE164(recruiter.phoneCode, recruiter.phoneNumber),
        String(code ?? ''),
      );

      if (result === 'mismatch') {
        return next(
          new AppError(
            'That code is not correct. Please check the most recent SMS and try again.',
            400,
          ),
        );
      }

      // Requesting a new code cancels the previous one, so the most common way
      // to land here is entering an older code after tapping Resend. Say so —
      // "invalid or expired" sends people back to retype the same dead code.
      if (result === 'no_pending_code') {
        return next(
          new AppError(
            'This code has expired, or a newer code was sent. Please enter the code from the most recent SMS, or tap Resend to get a new one.',
            400,
          ),
        );
      }
    } else {
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
    const {
      recruiterId,
      organizationVerified,
      organizationRiskLevel,
      organizationVerificationSource,
      organizationVerificationDecision,
      organizationVerificationData,
      ...companyData
    } = validatedData;
    const organizationDecisionProvided =
      typeof organizationVerified === 'boolean' || organizationRiskLevel;
    const externalCompany = organizationDecisionProvided
      ? null
      : await fetchGeminiCompanyDetails(companyData);
    const companyMatch = organizationDecisionProvided
      ? {
          mismatchDetected: organizationVerified === false,
          mismatchDetails:
            organizationVerified === false
              ? JSON.stringify({
                  source:
                    organizationVerificationSource || 'USER_DECLINED_LOOKUP',
                  reason:
                    'User declined the fetched public organization and continued with manually entered company details.',
                  verificationData: organizationVerificationData,
                })
              : null,
          riskLevel:
            organizationVerified === false
              ? KycRiskLevel.HIGH
              : KycRiskLevel.LOW,
        }
      : compareCompanyDetails(companyData, externalCompany);
    const selectedOrganizationRiskLevel =
      organizationVerified === true
        ? KycRiskLevel.LOW
        : organizationVerified === false
          ? KycRiskLevel.HIGH
          : organizationRiskLevel === 'HIGH'
            ? KycRiskLevel.HIGH
            : companyMatch.riskLevel;

    await prisma.recruiter.update({
      where: { id: recruiterId },
      data: {
        ...companyData,
        registrationStep: 5,
        ...(organizationDecisionProvided
          ? {
              organizationVerified,
              organizationRiskLevel: selectedOrganizationRiskLevel,
              organizationVerificationSource:
                organizationVerificationSource ||
                (externalCompany ? 'GEMINI_GOOGLE_SEARCH' : null),
              organizationVerificationDecision:
                organizationVerificationDecision ||
                (organizationVerified === true
                  ? 'CONFIRMED_PUBLIC_LOOKUP'
                  : organizationVerified === false
                    ? 'DECLINED_PUBLIC_LOOKUP'
                    : null),
              organizationVerificationSelectedAt: new Date(),
              organizationVerificationData: (organizationVerificationData ??
                externalCompany ??
                companyData) as Prisma.InputJsonValue,
            }
          : {}),
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
          ...(organizationDecisionProvided
            ? {
                riskLevel: selectedOrganizationRiskLevel,
                mismatchDetected: organizationVerified === false,
                mismatchDetails:
                  organizationVerified === false
                    ? JSON.stringify({
                        source:
                          organizationVerificationSource ||
                          'USER_DECLINED_LOOKUP',
                        reason:
                          'User declined the fetched public organization and continued with manually entered company details.',
                        verificationData: organizationVerificationData,
                      })
                    : null,
              }
            : companyMatch.mismatchDetected
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
          riskLevel: selectedOrganizationRiskLevel,
          organizationVerified,
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

    const enteredCompany = {
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
    };
    const companyVerification = compareCompanyDetails(enteredCompany, details);

    res.status(200).json({
      status: 'success',
      data: {
        company: details,
        enteredCompany,
        companyVerification: {
          source: details.source || 'GEMINI_GOOGLE_SEARCH',
          mismatchDetected: companyVerification.mismatchDetected,
          mismatchDetails: companyVerification.mismatchDetails,
          riskLevel: companyVerification.riskLevel,
        },
      },
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

    const recruiter = await prisma.recruiter.findUnique({
      where: { email },
      include: { kyc: { select: recruiterKycLoginSelect } },
    });

    if (!recruiter || !(await bcrypt.compare(password, recruiter.password))) {
      return next(new AppError('Incorrect email or password', 401));
    }

    if (!recruiter.isVerified) {
      // isVerified only flips true once step 2 (email OTP) completes, so an
      // unverified account is always sitting at step 1 — send the frontend
      // what it needs to drop the user straight back on the OTP screen
      // instead of a dead-end error. Shared by both Recruiter and Training
      // Agent logins, since they use the same account model and this handler.
      // 403 rather than 401: the client treats a login 401 as a dead session and
      // tears down local storage, which would wipe the ids the resume needs.
      return next(
        new AppError(
          'Your email address has not been verified yet. Enter the code we sent you to finish creating your account.',
          403,
          'ACCOUNT_NOT_VERIFIED',
          {
            recruiterId: recruiter.id,
            email: recruiter.email,
            role: recruiter.role,
          },
        ),
      );
    }

    const effectiveStatus = await liftExpiredRecruiterSuspension(recruiter);
    const restriction = describeRestriction({
      ...recruiter,
      status: effectiveStatus,
    });
    if (restriction) {
      return next(new AppError(restriction, 403));
    }

    if (effectiveStatus === 'REJECTED') {
      return next(
        new AppError(
          'Your account is currently rejected. Please contact support.',
          403,
        ),
      );
    }

    // Signed up but never finished the wizard (personal info, phone
    // verification, company details, compliance). Send the client the step
    // they stopped at so it can resume there rather than dropping a half-built
    // account on the dashboard.
    if (
      isRecruiterSignupIncomplete({
        status: effectiveStatus,
        registrationStep: recruiter.registrationStep,
      })
    ) {
      return next(
        new AppError(SIGNUP_INCOMPLETE_MESSAGE, 403, SIGNUP_INCOMPLETE_CODE, {
          recruiterId: recruiter.id,
          email: recruiter.email,
          role: recruiter.role,
          registrationStep: recruiter.registrationStep,
        }),
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
      ipAddress: getClientIp(req),
      userAgent: req.get('user-agent'),
    });

    const { kyc, kycSubmitted } = mapKycForLogin(recruiter.kyc);

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
          kyc,
          kycSubmitted,
        },
      },
    });
  },
);

/**
 * Resend the phone OTP issued by `setPersonalInfo` (signup step 3).
 *
 * Shared by recruiters and training agents. The code is delivered by SMS and mirrored
 * to the account email, matching how step 3 sends it in the first place.
 */
export const resendPhoneOTP = catchAsync(
  async (req: Request, res: Response, next: NextFunction) => {
    const { recruiterId } = req.body;

    if (!recruiterId) {
      return next(new AppError('Please provide a recruiterId', 400));
    }

    const recruiter = await prisma.recruiter.findUnique({
      where: { id: recruiterId },
      select: {
        id: true,
        email: true,
        phoneCode: true,
        phoneNumber: true,
        phoneVerified: true,
      },
    });

    if (!recruiter) {
      return next(new AppError('Account not found', 404));
    }

    if (recruiter.phoneVerified) {
      return next(new AppError('Phone number is already verified', 400));
    }

    if (!recruiter.phoneCode || !recruiter.phoneNumber) {
      return next(
        new AppError('No phone number on file. Please complete step 3.', 400),
      );
    }

    if (isPhoneVerifyConfigured()) {
      // Twilio owns the code, so a stale local one must not stay valid.
      await prisma.recruiter.update({
        where: { id: recruiter.id },
        data: { phoneOtpCode: null, phoneOtpExpiresAt: null },
      });

      // A failed resend is reported: there is nothing else to fall back on, and
      // Twilio's own rate limiting comes back as a 429 the user can act on.
      await startPhoneVerification(
        toE164(recruiter.phoneCode, recruiter.phoneNumber),
      );
    } else {
      const phoneOtpCode = Math.floor(
        100000 + Math.random() * 900000,
      ).toString();
      const phoneOtpExpiresAt = new Date(Date.now() + 10 * 60 * 1000);

      await prisma.recruiter.update({
        where: { id: recruiter.id },
        data: { phoneOtpCode, phoneOtpExpiresAt },
      });

      console.log(
        `[LOCAL TEST OTP] Resent phone OTP for ${recruiter.phoneCode}${recruiter.phoneNumber}: ${phoneOtpCode}`,
      );

      // Neither channel is allowed to fail the request — the code is already saved,
      // and step 3 treats delivery the same way.
      const message = `Your MaritimeLink verification code is: ${phoneOtpCode}`;
      try {
        await sendSMS(recruiter.phoneCode + recruiter.phoneNumber, message);
      } catch (error) {
        console.error('Failed to resend phone OTP SMS:', error);
      }

      if (recruiter.email) {
        try {
          await sendPhoneOTPEmail(recruiter.email, phoneOtpCode);
        } catch (error) {
          console.error('Failed to resend phone OTP email:', error);
        }
      }
    }

    res.status(200).json({
      status: 'success',
      // Sending a new code cancels the previous one, so saying only "resent"
      // invites the user to retry the older code they still have on screen.
      message:
        'A new code has been sent to your phone. Earlier codes no longer work — please use the latest SMS.',
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

    console.log(
      `[LOCAL TEST OTP] Recruiter resend email OTP for ${email}: ${otpCode}`,
    );

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

/**
 * Delete Account (Authenticated)
 */
export const deleteMyAccount = catchAsync(
  async (req: CustomRequest, res: Response) => {
    await prisma.recruiter.delete({
      where: { id: req.user?.id },
    });

    res.status(200).json({
      status: 'success',
      message: 'Account deleted successfully.',
    });
  },
);
