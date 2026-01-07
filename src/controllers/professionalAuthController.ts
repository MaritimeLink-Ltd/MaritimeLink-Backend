import { Request, Response, NextFunction } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { prisma } from '../config/prisma.js';
import { env } from '../config/env.js';
import { AppError } from '../utils/AppError.js';
import { catchAsync } from '../utils/catchAsync.js';
import { sendOTPEmail } from '../services/emailService.js';
import { uploadToSupabase } from '../services/storageService.js';

/**
 * @swagger
 * /api/professional/register:
 *   post:
 *     summary: Step 1 - Register a new professional
 *     tags: [Professional]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [fullname, email, password]
 *             properties:
 *               fullname: { type: string }
 *               email: { type: string, format: email }
 *               password: { type: string, minLength: 6 }
 *     responses:
 *       201:
 *         description: Registration successful, OTP sent.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status: { type: string, example: success }
 *                 message: { type: string }
 *                 data: { type: object, properties: { professionalId: { type: string } } }
 */
export const register = catchAsync(
  async (req: Request, res: Response, next: NextFunction) => {
    const { fullname, email, password } = req.body;

    const existingUser = await prisma.professional.findUnique({
      where: { email },
    });
    if (existingUser) {
      return next(new AppError('Email already registered', 400));
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
 * @swagger
 * /api/professional/verify-otp:
 *   post:
 *     summary: Step 2 - Verify OTP code
 *     tags: [Professional]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [professionalId, code]
 *             properties:
 *               professionalId: { type: string }
 *               code: { type: string, minLength: 6, maxLength: 6 }
 *     responses:
 *       200:
 *         description: OTP verified successfully.
 *       400:
 *         description: Invalid or expired OTP.
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
 * @swagger
 * /api/professional/upload-id:
 *   post:
 *     summary: Step 3 - Upload ID/Passport image
 *     tags: [Professional]
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required: [id_passport]
 *             properties:
 *               id_passport: { type: string, format: binary }
 *     responses:
 *       200:
 *         description: ID uploaded successfully.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status: { type: string, example: success }
 *                 data: { type: object, properties: { url: { type: string } } }
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
 * @swagger
 * /api/professional/complete-profile:
 *   post:
 *     summary: Step 4 - Complete profile
 *     tags: [Professional]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [professionalId, profession, idPassportUrl]
 *             properties:
 *               professionalId: { type: string }
 *               profession: { type: string }
 *               idPassportUrl: { type: string }
 *               bio: { type: string }
 *     responses:
 *       200:
 *         description: Profile completed. Returns JWT token.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status: { type: string, example: success }
 *                 token: { type: string }
 */
export const completeProfile = catchAsync(
  async (req: Request, res: Response, next: NextFunction) => {
    const { professionalId, profession, idPassportUrl, bio } = req.body;

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
        profession,
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
 * @swagger
 * /api/professional/login:
 *   post:
 *     summary: Log in as a professional
 *     tags: [Professional]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email, password]
 *             properties:
 *               email: { type: string }
 *               password: { type: string }
 *     responses:
 *       200:
 *         description: Login successful.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status: { type: string }
 *                 token: { type: string }
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
