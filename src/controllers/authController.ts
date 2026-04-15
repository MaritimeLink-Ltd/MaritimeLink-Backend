import { Request, Response, NextFunction } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { prisma } from '../config/prisma.js';
import { env } from '../config/env.js';
import { AppError } from '../utils/AppError.js';
import { catchAsync } from '../utils/catchAsync.js';

/**
 * Unified Login for both Professionals and Recruiters
 */
export const unifiedLogin = catchAsync(
  async (req: Request, res: Response, next: NextFunction) => {
    const { email, password } = req.body;

    if (!email || !password) {
      return next(new AppError('Please provide email and password', 400));
    }

    // 1) Check if user exists in Professional table
    const professional = await prisma.professional.findUnique({
      where: { email },
    });

    if (professional) {
      if (!(await bcrypt.compare(password, professional.password))) {
        return next(new AppError('Incorrect email or password', 401));
      }

      if (!professional.isVerified) {
        return next(
          new AppError('Account not verified. Please verify your email.', 401),
        );
      }

      const token = jwt.sign(
        { id: professional.id, role: 'PROFESSIONAL' },
        env.JWT_SECRET,
        {
          expiresIn: '7d',
        },
      );

      return res.status(200).json({
        status: 'success',
        token,
        data: {
          user: {
            id: professional.id,
            fullname: professional.fullname,
            email: professional.email,
            profession: professional.profession,
            role: 'PROFESSIONAL',
          },
        },
      });
    }

    // 2) Check if user exists in Recruiter table
    const recruiter = await prisma.recruiter.findUnique({
      where: { email },
    });

    if (recruiter) {
      if (!(await bcrypt.compare(password, recruiter.password))) {
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

      return res.status(200).json({
        status: 'success',
        token,
        data: {
          user: {
            id: recruiter.id,
            email: recruiter.email,
            role: recruiter.role,
            organizationName: recruiter.organizationName,
            status: recruiter.status,
          },
        },
      });
    }

    // 3) If neither
    return next(new AppError('Incorrect email or password', 401));
  },
);
