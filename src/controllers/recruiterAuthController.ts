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
  sendPasswordResetEmail,
} from '../services/emailService.js';
import { uploadToSupabase } from '../services/storageService.js';

/**
 * Step 1: Registration
 */
export const register = catchAsync(
  async (req: Request, res: Response, next: NextFunction) => {
    const { email, password, role } = req.body;

    if (!email || !password || !role) {
      return next(new AppError('Please provide email, password and role', 400));
    }

    const existingRecruiter = await prisma.recruiter.findUnique({
      where: { email },
    });
    if (existingRecruiter) {
      return next(new AppError('Email already registered', 400));
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

    res.status(201).json({
      status: 'success',
      message: 'Registration successful. OTP sent to your email.',
      data: { recruiterId: recruiter.id },
    });
  },
);

/**
 * Step 2: Verification
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
      },
    });

    res.status(200).json({
      status: 'success',
      message: 'Email verified successfully. Please upload your ID documents.',
    });
  },
);

/**
 * Step 3: Upload ID (Multipart)
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
      data: { url: publicUrl },
    });
  },
);

/**
 * Step 4: Complete Profile
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

    if (
      !organizationName ||
      !address ||
      !website ||
      !orgEmail ||
      !idPassportUrl
    ) {
      return next(
        new AppError('Please provide all required organizational details', 400),
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

    if (recruiter.status !== 'APPROVED') {
      return next(
        new AppError(
          `Your account is currently ${recruiter.status.toLowerCase()}. Please wait for admin approval.`,
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

    res.status(200).json({
      status: 'success',
      token,
      data: {
        recruiter: {
          id: recruiter.id,
          email: recruiter.email,
          role: recruiter.role,
          organizationName: recruiter.organizationName,
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
