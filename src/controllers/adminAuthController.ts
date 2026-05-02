import crypto from 'crypto';
import { Request, Response, NextFunction } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { prisma } from '../config/prisma.js';
import { env } from '../config/env.js';
import { AppError } from '../utils/AppError.js';
import { catchAsync } from '../utils/catchAsync.js';
import { sendPasswordResetEmail } from '../services/emailService.js';
import { logActivity } from '../services/activityLogger.js';
import { ActionStatus, ActorType } from '../generated/client/index.js';
import { getClientIp } from '../utils/requestMetadata.js';

/**
 * Admin Login
 */
export const login = catchAsync(
  async (req: Request, res: Response, next: NextFunction) => {
    const { email, password } = req.body;

    if (!email || !password) {
      return next(new AppError('Please provide email and password', 400));
    }

    const admin = await prisma.admin.findUnique({
      where: { email },
    });

    if (!admin || !(await bcrypt.compare(password, admin.password))) {
      return next(new AppError('Incorrect email or password', 401));
    }

    const token = jwt.sign({ id: admin.id, role: admin.role }, env.JWT_SECRET, {
      expiresIn: '7d',
    });

    await logActivity({
      action: 'LOGIN',
      actorId: admin.id,
      actorType: ActorType.ADMIN,
      status: ActionStatus.SUCCESS,
      ipAddress: getClientIp(req),
      userAgent: req.get('user-agent') || undefined,
      metadata: {
        email: admin.email,
      },
    });

    res.status(200).json({
      status: 'success',
      token,
      data: {
        user: {
          id: admin.id,
          email: admin.email,
          role: admin.role,
        },
      },
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

    const admin = await prisma.admin.findUnique({
      where: { email },
    });

    if (!admin) {
      return next(new AppError('No admin found with that email address', 404));
    }

    const resetToken = crypto.randomBytes(32).toString('hex');

    const hashedToken = crypto
      .createHash('sha256')
      .update(resetToken)
      .digest('hex');
    const resetExpires = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    await prisma.admin.update({
      where: { id: admin.id },
      data: {
        passwordResetToken: hashedToken,
        passwordResetExpires: resetExpires,
      },
    });

    // Reuse frontend URL structure but maybe point to admin portal if exists,
    // for now using generic reset-password link.
    const resetURL = `${env.FRONTEND_URL}/admin/reset-password/${resetToken}`;

    try {
      await sendPasswordResetEmail(email, resetURL);
      res.status(200).json({
        status: 'success',
        message: 'Password reset link sent to your email.',
      });
    } catch {
      await prisma.admin.update({
        where: { id: admin.id },
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

    const hashedToken = crypto.createHash('sha256').update(token).digest('hex');

    const admin = await prisma.admin.findFirst({
      where: {
        passwordResetToken: hashedToken,
        passwordResetExpires: { gt: new Date() },
      },
    });

    if (!admin) {
      return next(new AppError('Token is invalid or has expired', 400));
    }

    const hashedPassword = await bcrypt.hash(password, 12);

    await prisma.admin.update({
      where: { id: admin.id },
      data: {
        password: hashedPassword,
        passwordResetToken: null,
        passwordResetExpires: null,
      },
    });

    const jwtToken = jwt.sign(
      { id: admin.id, role: admin.role },
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
