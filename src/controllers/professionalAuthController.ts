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
import {
  registerSchema,
  completeProfileSchema,
} from '../validations/professionalValidation.js';

/**
 * Step 1: Registration
 */
export const register = catchAsync(
  async (req: Request, res: Response, next: NextFunction) => {
    const validatedData = registerSchema.parse(req.body);
    const { fullname, email, password } = validatedData;

    const existingUser = await prisma.professional.findUnique({
      where: { email },
    });
    if (existingUser) {
      return next(
        new AppError('Email already registered as a professional', 400),
      );
    }

    const existingRecruiter = await prisma.recruiter.findUnique({
      where: { email },
    });
    if (existingRecruiter) {
      return next(new AppError('Email already registered as a recruiter', 400));
    }

    const hashedPassword = await bcrypt.hash(password, 12);

    const professional = await prisma.professional.create({
      data: {
        fullname,
        email,
        password: hashedPassword,
        isVerified: false,
      },
    });

    const otpCode = Math.floor(100000 + Math.random() * 900000).toString();
    const otpExpiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    await prisma.professional.update({
      where: { id: professional.id },
      data: {
        otpCode,
        otpExpiresAt,
      },
    });

    await sendOTPEmail(email, otpCode);

    res.status(201).json({
      status: 'success',
      message: 'Registration successful. OTP sent to your email.',
      data: { professionalId: professional.id },
    });
  },
);

/**
 * Step 2: Verification
 */
export const verifyOTP = catchAsync(
  async (req: Request, res: Response, next: NextFunction) => {
    const { professionalId, code } = req.body;

    const professional = await prisma.professional.findFirst({
      where: {
        id: professionalId,
        otpCode: code,
        otpExpiresAt: { gt: new Date() },
      },
    });

    if (!professional) {
      return next(new AppError('Invalid or expired OTP', 400));
    }

    await prisma.professional.update({
      where: { id: professionalId },
      data: {
        isVerified: true,
        otpCode: null,
        otpExpiresAt: null,
      },
    });

    res.status(200).json({
      status: 'success',
      message:
        'Account verified successfully. Please upload your ID to proceed.',
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

    // Sanitize filename to avoid "Invalid key" errors in Supabase (no spaces or special chars)
    const sanitizedOriginalName = file.originalname.replace(
      /[^a-zA-Z0-9.]/g,
      '_',
    );
    const fileName = `temp-ids/${Date.now()}-${sanitizedOriginalName}`;
    const publicUrl = await uploadToSupabase(file, fileName);

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
    const validatedData = completeProfileSchema.parse(req.body);
    const { professionalId, profession, idPassportUrl, bio } = validatedData;

    const professional = await prisma.professional.findUnique({
      where: { id: professionalId },
    });

    if (!professional) {
      return next(new AppError('User not found', 404));
    }

    if (!professional.isVerified) {
      return next(
        new AppError(
          'Please verify your email before completing the profile',
          401,
        ),
      );
    }

    const updatedProfessional = await prisma.professional.update({
      where: { id: professionalId },
      data: {
        profession, // Zod should validate this is a valid JobCategory
        bio,
        idPassportUrl,
      },
    });

    const token = jwt.sign({ id: updatedProfessional.id }, env.JWT_SECRET, {
      expiresIn: '7d',
    });

    res.status(200).json({
      status: 'success',
      message: 'Profile completed successfully.',
      token,
      data: {
        user: {
          id: updatedProfessional.id,
          fullname: updatedProfessional.fullname,
          email: updatedProfessional.email,
          profession: updatedProfessional.profession,
          idPassportUrl: updatedProfessional.idPassportUrl,
        },
      },
    });
  },
);

/**
 * Login
 */
export const login = catchAsync(
  async (req: Request, res: Response, next: NextFunction) => {
    const { email, password } = req.body;

    const professional = await prisma.professional.findUnique({
      where: { email },
    });

    if (
      !professional ||
      !(await bcrypt.compare(password, professional.password))
    ) {
      return next(new AppError('Incorrect email or password', 401));
    }

    if (!professional.isVerified) {
      return next(
        new AppError('Account not verified. Please verify your email.', 401),
      );
    }

    const token = jwt.sign({ id: professional.id }, env.JWT_SECRET, {
      expiresIn: '7d',
    });

    res.status(200).json({
      status: 'success',
      token,
      data: {
        user: {
          id: professional.id,
          fullname: professional.fullname,
          email: professional.email,
          profession: professional.profession,
          idPassportUrl: professional.idPassportUrl,
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

    const professional = await prisma.professional.findUnique({
      where: { email },
    });

    if (!professional) {
      return next(new AppError('Professional not found', 404));
    }

    if (professional.isVerified) {
      return next(new AppError('Account is already verified', 400));
    }

    const otpCode = Math.floor(100000 + Math.random() * 900000).toString();
    const otpExpiresAt = new Date(Date.now() + 10 * 60 * 1000);

    await prisma.professional.update({
      where: { id: professional.id },
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

    const professional = await prisma.professional.findUnique({
      where: { email },
    });

    if (!professional) {
      return next(new AppError('No user found with that email address', 404));
    }

    // Generate random reset token
    const resetToken = crypto.randomBytes(32).toString('hex');

    // Hash token and set expiry
    const hashedToken = crypto
      .createHash('sha256')
      .update(resetToken)
      .digest('hex');
    const resetExpires = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    await prisma.professional.update({
      where: { id: professional.id },
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
      await prisma.professional.update({
        where: { id: professional.id },
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

    const professional = await prisma.professional.findFirst({
      where: {
        passwordResetToken: hashedToken,
        passwordResetExpires: { gt: new Date() },
      },
    });

    if (!professional) {
      return next(new AppError('Token is invalid or has expired', 400));
    }

    // Update password, clear token fields
    const hashedPassword = await bcrypt.hash(password, 12);

    await prisma.professional.update({
      where: { id: professional.id },
      data: {
        password: hashedPassword,
        passwordResetToken: null,
        passwordResetExpires: null,
      },
    });

    // Log the user in
    const jwtToken = jwt.sign({ id: professional.id }, env.JWT_SECRET, {
      expiresIn: '7d',
    });

    res.status(200).json({
      status: 'success',
      message: 'Password reset successful.',
      token: jwtToken,
    });
  },
);
